import {
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";

const DEFAULT_JWKS_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;
const DEFAULT_MIN_REFRESH_INTERVAL_MS = 30_000;
const JWKS_REQUEST_TIMEOUT_MS = 5_000;
const MAX_TOKEN_BYTES = 16 * 1024;

export const CASE_CLIENT_TOKEN_ERROR_CODES = [
  "TOKEN_TOO_LARGE",
  "TOKEN_MALFORMED",
  "TOKEN_ALGORITHM_UNSUPPORTED",
  "TOKEN_KEY_ID_INVALID",
  "TOKEN_KEY_ID_REQUIRED",
  "TOKEN_KEY_UNKNOWN",
  "TOKEN_SIGNATURE_INVALID",
  "TOKEN_EXPIRED",
  "TOKEN_NOT_YET_VALID",
  "TOKEN_ISSUER_MISMATCH",
  "TOKEN_AUDIENCE_MISMATCH",
  "TOKEN_CLAIMS_INVALID",
  "JWKS_UNAVAILABLE",
] as const;

export type CaseClientTokenErrorCode = (typeof CASE_CLIENT_TOKEN_ERROR_CODES)[number];

/** Case Hub 内部认证错误；HTTP 映射由后续 CaseClientGuard 统一处理，不进入 shared 契约。 */
export class CaseClientTokenError extends Error {
  constructor(
    readonly code: CaseClientTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CaseClientTokenError";
  }
}

export interface CaseClientJwtVerifierOptions {
  jwksUrl: string;
  issuer: string;
  audience: string;
  fetch?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  clockToleranceSeconds?: number;
  minRefreshIntervalMs?: number;
}

interface CachedSigningKey {
  kid: string | undefined;
  key: KeyObject;
}

interface JwksCache {
  keys: CachedSigningKey[];
  expiresAt: number;
  fetchedAt: number;
}

/**
 * 外部 client 的 JWT/JWKS 验签内核（L2a）。
 *
 * 只验证标准 JWT 安全属性并返回原始 claims；clientId / scopes 映射属 D04，不在本文件定义。
 * 支持 RS256、kid 选择、JWKS 缓存与未知 kid 单次刷新；不读取任意 X-Client-Id 请求头。
 */
export class CaseClientJwtVerifier {
  private readonly jwksUrl: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly clockToleranceSeconds: number;
  private readonly minRefreshIntervalMs: number;
  private cache: JwksCache | null = null;
  private refreshInFlight: Promise<JwksCache> | null = null;

  constructor(options: CaseClientJwtVerifierOptions) {
    this.jwksUrl = requireHttpUrl(options.jwksUrl, "CASE_CLIENT_JWKS_URL");
    this.issuer = requireNonEmpty(options.issuer, "CASE_CLIENT_ISSUER");
    this.audience = requireNonEmpty(options.audience, "CASE_CLIENT_AUDIENCE");
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = requireNonNegative(options.cacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS, "cacheTtlMs");
    this.clockToleranceSeconds = requireNonNegative(
      options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS,
      "clockToleranceSeconds",
    );
    this.minRefreshIntervalMs = requireNonNegative(
      options.minRefreshIntervalMs ?? DEFAULT_MIN_REFRESH_INTERVAL_MS,
      "minRefreshIntervalMs",
    );
  }

  async verify(token: string): Promise<Readonly<Record<string, unknown>>> {
    if (Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) {
      throw new CaseClientTokenError("TOKEN_TOO_LARGE", "Bearer Token 超过大小上限");
    }
    const segments = token.split(".");
    if (segments.length !== 3 || segments.some((segment) => segment === "")) {
      throw new CaseClientTokenError("TOKEN_MALFORMED", "Bearer Token 格式非法");
    }
    const header = decodeObject(segments[0]);
    const claims = decodeObject(segments[1]);
    if (header === null || claims === null) {
      throw new CaseClientTokenError("TOKEN_MALFORMED", "Bearer Token 头部或载荷无法解析");
    }
    if (header.alg !== "RS256") {
      throw new CaseClientTokenError("TOKEN_ALGORITHM_UNSUPPORTED", "Bearer Token 签名算法不受支持");
    }
    const kid = readKid(header.kid);
    const key = await this.resolveSigningKey(kid);
    const signed = segments[0] + "." + segments[1];
    const signature = Buffer.from(segments[2] ?? "", "base64url");
    let signatureValid = false;
    try {
      signatureValid = verifySignature("RSA-SHA256", Buffer.from(signed), key, signature);
    } catch {
      // 非法签名编码交给上层统一按认证失败处理，不向调用方泄露底层 OpenSSL 错误。
    }
    if (!signatureValid) {
      throw new CaseClientTokenError("TOKEN_SIGNATURE_INVALID", "Bearer Token 验签失败");
    }
    this.assertClaims(claims);
    return claims;
  }

  private async resolveSigningKey(kid: string | undefined): Promise<KeyObject> {
    let cache = await this.currentKeys();
    const matched = this.lookupKey(cache, kid);
    if (matched !== null) {
      return matched;
    }
    if (this.now() - cache.fetchedAt >= this.minRefreshIntervalMs) {
      cache = await this.refreshKeys();
      const refreshed = this.lookupKey(cache, kid);
      if (refreshed !== null) {
        return refreshed;
      }
    }
    throw new CaseClientTokenError("TOKEN_KEY_UNKNOWN", "Bearer Token 签名密钥不可用");
  }

  private lookupKey(cache: JwksCache, kid: string | undefined): KeyObject | null {
    if (kid !== undefined) {
      return cache.keys.find((item) => item.kid === kid)?.key ?? null;
    }
    if (cache.keys.length === 1) {
      return cache.keys[0]?.key ?? null;
    }
    throw new CaseClientTokenError("TOKEN_KEY_ID_REQUIRED", "Bearer Token 缺少 kid，且 JWKS 存在多个候选密钥");
  }

  private async currentKeys(): Promise<JwksCache> {
    if (this.cache === null || this.cache.expiresAt <= this.now()) {
      return this.refreshKeys();
    }
    return this.cache;
  }

  private async refreshKeys(): Promise<JwksCache> {
    if (this.refreshInFlight !== null) {
      return this.refreshInFlight;
    }
    const pending = this.loadJwks();
    this.refreshInFlight = pending;
    try {
      const cache = await pending;
      this.cache = cache;
      return cache;
    } finally {
      if (this.refreshInFlight === pending) {
        this.refreshInFlight = null;
      }
    }
  }

  private async loadJwks(): Promise<JwksCache> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.jwksUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(JWKS_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new CaseClientTokenError("JWKS_UNAVAILABLE", "client 验签公钥暂时不可用");
    }
    if (!response.ok) {
      throw new CaseClientTokenError("JWKS_UNAVAILABLE", "client 验签公钥服务响应异常");
    }
    let document: unknown;
    try {
      document = await response.json();
    } catch {
      throw new CaseClientTokenError("JWKS_UNAVAILABLE", "client 验签公钥文档无法解析");
    }
    if (typeof document !== "object" || document === null || Array.isArray(document)) {
      throw new CaseClientTokenError("JWKS_UNAVAILABLE", "client 验签公钥文档格式非法");
    }
    const rawKeys = (document as { keys?: unknown }).keys;
    if (!Array.isArray(rawKeys)) {
      throw new CaseClientTokenError("JWKS_UNAVAILABLE", "client 验签公钥文档缺少 keys");
    }
    const keys: CachedSigningKey[] = [];
    for (const raw of rawKeys) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        continue;
      }
      const item = raw as Record<string, unknown>;
      if (item.kty !== "RSA" || typeof item.n !== "string" || typeof item.e !== "string") {
        continue;
      }
      if (item.use !== undefined && item.use !== "sig") {
        continue;
      }
      if (item.alg !== undefined && item.alg !== "RS256") {
        continue;
      }
      let key: KeyObject;
      try {
        key = createPublicKey({ key: item as unknown as JsonWebKey, format: "jwk" });
      } catch {
        continue;
      }
      const keyId = typeof item.kid === "string" && item.kid !== "" ? item.kid : undefined;
      keys.push({ kid: keyId, key });
    }
    if (keys.length === 0) {
      throw new CaseClientTokenError("JWKS_UNAVAILABLE", "client 验签公钥文档没有可用 RSA 密钥");
    }
    const fetchedAt = this.now();
    return { keys, fetchedAt, expiresAt: fetchedAt + this.cacheTtlMs };
  }

  private assertClaims(claims: Readonly<Record<string, unknown>>): void {
    if (typeof claims.iss !== "string" || claims.iss !== this.issuer) {
      throw new CaseClientTokenError("TOKEN_ISSUER_MISMATCH", "Bearer Token 签发方不匹配");
    }
    const audience = claims.aud;
    const audiences =
      typeof audience === "string"
        ? [audience]
        : Array.isArray(audience) && audience.every((item) => typeof item === "string")
          ? audience
          : null;
    if (audiences === null || !audiences.includes(this.audience)) {
      throw new CaseClientTokenError("TOKEN_AUDIENCE_MISMATCH", "Bearer Token 受众不匹配");
    }
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) {
      throw new CaseClientTokenError("TOKEN_CLAIMS_INVALID", "Bearer Token 缺少有效 exp");
    }
    const nowSeconds = Math.floor(this.now() / 1000);
    if (claims.exp + this.clockToleranceSeconds <= nowSeconds) {
      throw new CaseClientTokenError("TOKEN_EXPIRED", "Bearer Token 已过期");
    }
    this.assertOptionalNumericDate(claims, "nbf", (value) => value > nowSeconds + this.clockToleranceSeconds);
    this.assertOptionalNumericDate(claims, "iat", (value) => value > nowSeconds + this.clockToleranceSeconds);
  }

  private assertOptionalNumericDate(
    claims: Readonly<Record<string, unknown>>,
    key: "nbf" | "iat",
    isFuture: (value: number) => boolean,
  ): void {
    const value = claims[key];
    if (value === undefined) {
      return;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new CaseClientTokenError("TOKEN_CLAIMS_INVALID", "Bearer Token 的 " + key + " 非法");
    }
    if (isFuture(value)) {
      throw new CaseClientTokenError("TOKEN_NOT_YET_VALID", "Bearer Token 尚未生效");
    }
  }
}

function readKid(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value === "") {
    throw new CaseClientTokenError("TOKEN_KEY_ID_INVALID", "Bearer Token 的 kid 非法");
  }
  return value;
}

function decodeObject(segment: string | undefined): Record<string, unknown> | null {
  if (segment === undefined || segment === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function requireNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(name + " 未配置");
  }
  return trimmed;
}

function requireHttpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(name + " 不是合法 URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(name + " 只允许 http / https");
  }
  return url.toString();
}

function requireNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(name + " 必须是非负数");
  }
  return value;
}
