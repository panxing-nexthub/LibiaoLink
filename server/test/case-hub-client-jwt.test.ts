import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CaseClientJwtVerifier,
  CaseClientTokenError,
  type CaseClientTokenErrorCode,
} from "../src/modules/case-hub/case-client-jwt.js";

const NOW_MS = Date.UTC(2026, 10, 17, 0, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const ISSUER = "https://idp.example.test";
const AUDIENCE = "case-exchange";
const JWKS_URL = "https://idp.example.test/jwks";

const keyPairA = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyPairB = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwkA = { ...keyPairA.publicKey.export({ format: "jwk" }), kid: "key-a", alg: "RS256", use: "sig" };
const publicJwkB = { ...keyPairB.publicKey.export({ format: "jwk" }), kid: "key-b", alg: "RS256", use: "sig" };

function defaultClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "partner-client-a",
    scope: "cases.read cases.write",
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 3600,
    ...overrides,
  };
}

function signToken(
  claims: Record<string, unknown>,
  options: {
    kid?: string;
    alg?: string;
    privateKey?: KeyObject;
  } = {},
): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header: Record<string, unknown> = { alg: options.alg ?? "RS256", typ: "JWT" };
  if (options.kid !== undefined) {
    header.kid = options.kid;
  }
  const signed = encode(header) + "." + encode(claims);
  const signature = createSign("RSA-SHA256")
    .update(signed)
    .sign(options.privateKey ?? keyPairA.privateKey)
    .toString("base64url");
  return signed + "." + signature;
}

function jwksResponse(keys: unknown[]): Response {
  return new Response(JSON.stringify({ keys }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createVerifier(
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>,
  overrides: Partial<ConstructorParameters<typeof CaseClientJwtVerifier>[0]> = {},
): CaseClientJwtVerifier {
  return new CaseClientJwtVerifier({
    jwksUrl: JWKS_URL,
    issuer: ISSUER,
    audience: AUDIENCE,
    fetch: fetcher,
    now: () => NOW_MS,
    ...overrides,
  });
}

async function expectTokenError(
  promise: Promise<unknown>,
  code: CaseClientTokenErrorCode,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "CaseClientTokenError", code });
  await expect(promise).rejects.toBeInstanceOf(CaseClientTokenError);
}

describe("Case Hub L2a client JWT/JWKS 验签", () => {
  it("验证 RS256 签名与 iss / aud / exp，并原样返回 claims", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jwksResponse([publicJwkA]));
    const verifier = createVerifier(fetcher);
    const claims = await verifier.verify(signToken(defaultClaims({ kid: "key-a" }), { kid: "key-a" }));
    expect(claims.sub).toBe("partner-client-a");
    expect(claims.scope).toBe("cases.read cases.write");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("JWKS 按 TTL 复用，不在每次请求重复拉取", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jwksResponse([publicJwkA]));
    const verifier = createVerifier(fetcher);
    await verifier.verify(signToken(defaultClaims(), { kid: "key-a" }));
    await verifier.verify(signToken(defaultClaims({ exp: NOW_SECONDS + 7200 }), { kid: "key-a" }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("并发验签共享同一次 JWKS 刷新，冷启动不放大 IdP 请求", async () => {
    let resolveJwks: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveJwks = resolve;
        }),
    );
    const verifier = createVerifier(fetcher);
    const token = signToken(defaultClaims(), { kid: "key-a" });
    const first = verifier.verify(token);
    const second = verifier.verify(token);

    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveJwks?.(jwksResponse([publicJwkA]));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("支持 aud 数组，只要包含预期 audience 即通过", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jwksResponse([publicJwkA]));
    const verifier = createVerifier(fetcher);
    await expect(
      verifier.verify(signToken(defaultClaims({ aud: ["another", AUDIENCE] }), { kid: "key-a" })),
    ).resolves.toMatchObject({ aud: ["another", AUDIENCE] });
  });

  it("拒绝错误签发方与错误受众", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jwksResponse([publicJwkA]));
    const verifier = createVerifier(fetcher);
    await expectTokenError(
      verifier.verify(signToken(defaultClaims({ iss: "https://other.example.test" }), { kid: "key-a" })),
      "TOKEN_ISSUER_MISMATCH",
    );
    await expectTokenError(
      verifier.verify(signToken(defaultClaims({ aud: "other-api" }), { kid: "key-a" })),
      "TOKEN_AUDIENCE_MISMATCH",
    );
  });

  it("拒绝过期、缺少 exp 与尚未生效的 Token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jwksResponse([publicJwkA]));
    const verifier = createVerifier(fetcher);
    await expectTokenError(
      verifier.verify(signToken(defaultClaims({ exp: NOW_SECONDS - 31 }), { kid: "key-a" })),
      "TOKEN_EXPIRED",
    );
    await expectTokenError(
      verifier.verify(signToken(defaultClaims({ exp: undefined }), { kid: "key-a" })),
      "TOKEN_CLAIMS_INVALID",
    );
    await expectTokenError(
      verifier.verify(signToken(defaultClaims({ nbf: NOW_SECONDS + 60 }), { kid: "key-a" })),
      "TOKEN_NOT_YET_VALID",
    );
    await expectTokenError(
      verifier.verify(signToken(defaultClaims({ iat: NOW_SECONDS + 60 }), { kid: "key-a" })),
      "TOKEN_NOT_YET_VALID",
    );
  });

  it("只接受 RS256，alg=none / HS256 在拉取 JWKS 前即拒绝", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jwksResponse([publicJwkA]));
    const verifier = createVerifier(fetcher);
    await expectTokenError(
      verifier.verify(signToken(defaultClaims(), { kid: "key-a", alg: "none" })),
      "TOKEN_ALGORITHM_UNSUPPORTED",
    );
    await expectTokenError(
      verifier.verify(signToken(defaultClaims(), { kid: "key-a", alg: "HS256" })),
      "TOKEN_ALGORITHM_UNSUPPORTED",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("拒绝格式非法、签名错误与超大 Token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jwksResponse([publicJwkA]));
    const verifier = createVerifier(fetcher);
    await expectTokenError(verifier.verify("not-a-jwt"), "TOKEN_MALFORMED");
    await expectTokenError(
      verifier.verify(signToken(defaultClaims(), { kid: "key-a", privateKey: keyPairB.privateKey })),
      "TOKEN_SIGNATURE_INVALID",
    );
    await expectTokenError(verifier.verify("x".repeat(16 * 1024 + 1)), "TOKEN_TOO_LARGE");
  });

  it("未知 kid 触发一次 JWKS 刷新，支持密钥轮换", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jwksResponse([publicJwkA]))
      .mockResolvedValueOnce(jwksResponse([publicJwkA, publicJwkB]));
    const verifier = createVerifier(fetcher, { minRefreshIntervalMs: 0 });
    await verifier.verify(signToken(defaultClaims(), { kid: "key-a" }));
    await verifier.verify(signToken(defaultClaims(), { kid: "key-b", privateKey: keyPairB.privateKey }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("刷新后仍找不到 kid 时拒绝，不信任未签名声明", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => jwksResponse([publicJwkA]));
    const verifier = createVerifier(fetcher, { minRefreshIntervalMs: 0 });
    await expectTokenError(
      verifier.verify(signToken(defaultClaims(), { kid: "missing-key" })),
      "TOKEN_KEY_UNKNOWN",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("单密钥可省略 kid；多密钥缺 kid 时拒绝", async () => {
    const singleFetcher = vi.fn<typeof fetch>().mockResolvedValue(jwksResponse([publicJwkA]));
    await expect(createVerifier(singleFetcher).verify(signToken(defaultClaims()))).resolves.toBeTruthy();

    const multipleFetcher = vi.fn<typeof fetch>().mockResolvedValue(jwksResponse([publicJwkA, publicJwkB]));
    await expectTokenError(createVerifier(multipleFetcher).verify(signToken(defaultClaims())), "TOKEN_KEY_ID_REQUIRED");
  });

  it("JWKS 网络失败、非 2xx 或无可用 RSA 密钥时统一报公钥不可用", async () => {
    const rejected = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));
    await expectTokenError(createVerifier(rejected).verify(signToken(defaultClaims(), { kid: "key-a" })), "JWKS_UNAVAILABLE");

    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(new Response("down", { status: 503 }));
    await expectTokenError(createVerifier(unavailable).verify(signToken(defaultClaims(), { kid: "key-a" })), "JWKS_UNAVAILABLE");

    const empty = vi.fn<typeof fetch>().mockResolvedValue(jwksResponse([{ kty: "EC", kid: "key-a" }]));
    await expectTokenError(createVerifier(empty).verify(signToken(defaultClaims(), { kid: "key-a" })), "JWKS_UNAVAILABLE");
  });
});
