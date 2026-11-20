#!/usr/bin/env node
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const issuer = process.env.CASE_GATEWAY_TOKEN_ISSUER ?? "https://test-pm.libiaorobot.com/case-data/issuer";
const audience = process.env.CASE_GATEWAY_TOKEN_AUDIENCE ?? "case-data-gateway";
const authDir = process.env.CASE_AUTH_DIR ?? "/opt/libiaolink-case/secrets/auth";
const identities = {
  "case-authoring-test": [
    "case-data:projects:read",
    "case-data:projects:write",
    "case-data:project-data:read",
    "case-data:project-data:write",
    "case-data:cases:read",
    "case-data:cases:write",
    "case-data:operations:read",
    "case-data:assets:read",
    "case-data:assets:write",
    "case-data:releases:read",
    "case-data:releases:write",
    "case-data:releases:history:read"
  ],
  "case-public-test": ["case-data:releases:read"],
  "case-media-test": ["case-data:assets:process"]
};

const clientId = process.argv[2];
const days = Number(process.argv[3] ?? 30);
if (!identities[clientId]) throw new Error("unknown service identity");
if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("days must be 1..90");
const keyId = readFileSync(join(authDir, "case_gateway_key_id"), "utf8").trim();
const privateKey = createPrivateKey(readFileSync(join(authDir, "case_gateway_jwt_private_key.pem")));
const now = Math.floor(Date.now() / 1000);
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const header = encode({ alg: "RS256", typ: "at+jwt", kid: keyId });
const payload = encode({
  iss: issuer,
  aud: audience,
  sub: clientId,
  client_id: clientId,
  scope: identities[clientId].join(" "),
  iat: now,
  nbf: now,
  exp: now + days * 86400,
  jti: randomUUID()
});
const signature = sign("RSA-SHA256", Buffer.from(header + "." + payload), privateKey).toString("base64url");
process.stdout.write(header + "." + payload + "." + signature + "\n");
