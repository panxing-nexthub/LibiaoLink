import { constants, createPublicKey, verify } from "node:crypto";
import { CaseDataError } from "./database-credentials.mjs";

const utf8 = new TextDecoder("utf-8", { fatal: true });

function parseObject(segment) {
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.toString("base64url") !== segment) return null;
  const value = JSON.parse(utf8.decode(bytes));
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function loadKeys(jwks) {
  try {
    const { keys } = JSON.parse(jwks);
    if (!Array.isArray(keys) || keys.length === 0) throw new Error();
    const byId = new Map();
    for (const jwk of keys) {
      if (!jwk || jwk.kty !== "RSA" || typeof jwk.kid !== "string" || !jwk.kid
          || byId.has(jwk.kid) || jwk.d !== undefined
          || (jwk.alg !== undefined && jwk.alg !== "RS256")
          || (jwk.use !== undefined && jwk.use !== "sig")) throw new Error();
      const key = createPublicKey({ key: jwk, format: "jwk" });
      if (key.asymmetricKeyDetails.modulusLength < 2048) throw new Error();
      byId.set(jwk.kid, key);
    }
    return byId;
  } catch {
    throw new CaseDataError("case_gateway_public_jwks 必须包含有效的 RS256 公钥和唯一 kid");
  }
}

export function createServiceAuthenticator(jwks, issuer, audience) {
  const keys = loadKeys(jwks);
  return function authenticate(authorization) {
    const bearer = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/i.exec(authorization ?? "");
    if (!bearer) return null;
    const [, protectedHeader, payload, signature] = bearer;
    try {
      const header = parseObject(protectedHeader);
      const type = typeof header?.typ === "string" ? header.typ.toLowerCase() : null;
      if (header?.alg !== "RS256" || !["at+jwt", "application/at+jwt"].includes(type)
          || header.crit !== undefined || header.b64 !== undefined) return null;
      const key = keys.get(header.kid);
      const signatureBytes = Buffer.from(signature, "base64url");
      if (!key || signatureBytes.toString("base64url") !== signature
          || !verify("RSA-SHA256", Buffer.from(`${protectedHeader}.${payload}`),
            { key, padding: constants.RSA_PKCS1_PADDING }, signatureBytes)) return null;

      const claims = parseObject(payload);
      if (!claims || claims.iss !== issuer) return null;
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audiences.every((item) => typeof item === "string") || !audiences.includes(audience)) return null;
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isSafeInteger(claims.exp) || claims.exp <= now
          || !Number.isSafeInteger(claims.iat) || claims.iat > now
          || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now))) return null;
      if (typeof claims.client_id !== "string" || !claims.client_id || claims.client_id.length > 256
          || claims.sub !== claims.client_id || typeof claims.jti !== "string" || !claims.jti
          || (claims.scope !== undefined && typeof claims.scope !== "string")) return null;

      return { clientId: claims.client_id, scopes: new Set((claims.scope ?? "").split(" ")) };
    } catch {
      // 客户端提供的 token 解析、编码和验签失败都按同一认证错误处理。
      return null;
    }
  };
}
