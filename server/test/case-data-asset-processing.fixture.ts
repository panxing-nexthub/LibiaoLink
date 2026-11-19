import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import type { Client } from "pg";
import { expect } from "vitest";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3CkAAAAASUVORK5CYII=", "base64");

function multiPartPng() {
  const text = Buffer.alloc(33 * 1024 * 1024, "a");
  text.write("Comment\0");
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32BE(text.length);
  chunk.write("tEXt", 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(text, crc32("tEXt")));
  return Buffer.concat([png.subarray(0, 33), chunk, text, crc, png.subarray(33)]);
}

export async function verifyAssetProcessing({ db, base, caseId, owner, other, processor }: {
  db: Client; base: string; caseId: string; owner: string; other: string; processor: string;
}) {
  let counter = 0;
  const write = () => ({ operationId: `0190d2e4-b011-7000-8000-${String(++counter).padStart(12, "0")}`, operatorUserKey: "media-fixture" });
  const send = (method: string, path: string, body?: object, token = owner) => fetch(base + path, {
    method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(25_000),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
  });
  async function json<T>(method: string, path: string, status: number, body?: object, token?: string) {
    const response = await send(method, path, body, token);
    expect(response.status, response.ok ? "" : JSON.stringify(await response.clone().json())).toBe(status);
    return await response.json() as T;
  }
  const bytes = multiPartPng();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const collection = `/api/v1/cases/${caseId}/uploads`;
  const request = { ...write(), fileName: "multipart.png", sizeBytes: bytes.length, mimeType: "image/png", sha256 };
  const created = await json<{ uploadId: string; assetId: string; assetVersionId: string;
    multipart: { partSize: number; partCount: number } }>("POST", collection, 201, request);
  expect(await json("POST", collection, 201, request)).toEqual(created);
  const root = `/api/v1/uploads/${created.uploadId}`;
  const { partSize, partCount } = created.multipart;
  expect(partSize).toBe(8 * 1024 * 1024);
  expect(partCount).toBe(5);
  await json("GET", `${root}/target`, 422);
  await json("GET", `${root}/parts`, 404, undefined, other);
  await json("GET", `${root}/parts/6/target`, 422);
  async function uploadPart(number: number) {
    const target = await json<{ url: string; headers: Record<string, string> }>("GET", `${root}/parts/${number}/target`, 200);
    expect(new URL(target.url).searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    const start = (number - 1) * partSize;
    const chunk = bytes.subarray(start, Math.min(start + partSize, bytes.length));
    expect(target.headers["content-length"]).toBe(String(chunk.length));
    const uploaded = await fetch(target.url, { method: "PUT", headers: target.headers, body: new Uint8Array(chunk),
      signal: AbortSignal.timeout(6000) });
    expect(uploaded.status).toBe(200);
  }
  await uploadPart(2);
  expect(await json("GET", `${root}/parts`, 200)).toEqual({
    partSize, partCount, uploadedParts: [{ partNumber: 2, sizeBytes: partSize }], merged: false,
  });
  const finish = write();
  expect(await json("POST", `${root}/complete`, 409, finish)).toMatchObject({ code: "UPLOAD_PARTS_INCOMPLETE" });
  for (const number of [1, 3, 4, 5]) await uploadPart(number);

  // The real merge succeeds in S3, then hosted metadata insertion fails and rolls back.
  await db.query('revoke insert (mime_type) on "case".case_assets from case_gateway_authoring_rw');
  try {
    await json("POST", `${root}/complete`, 500, finish);
    expect((await db.query('select 1 from "case".case_assets where asset_version_id = $1', [created.assetVersionId])).rowCount).toBe(0);
  } finally {
    await db.query('grant insert (mime_type) on "case".case_assets to case_gateway_authoring_rw');
  }
  expect(await json("GET", `${root}/parts`, 200)).toMatchObject({ merged: true });
  const completed = await json<{ objectVersionId: string }>("POST", `${root}/complete`, 200, finish);
  expect(completed).toMatchObject({ assetId: created.assetId, assetVersionId: created.assetVersionId,
    objectVersionId: expect.any(String), sizeBytes: bytes.length, sha256, scanStatus: "pending" });
  expect(await json("POST", `${root}/complete`, 200, finish)).toEqual(completed);

  const media = `/api/v1/assets/${created.assetId}/versions/${created.assetVersionId}`;
  const input = { ...write(), expectedVersion: 1, objectVersionId: completed.objectVersionId, sha256,
    result: { scanStatus: "passed", previewStatus: "ready", dimensions: { width: 1, height: 1 } } };
  await json("PUT", `${media}/media-state`, 403, input);
  await json("GET", `${media}/media-input`, 403);
  expect(await json("GET", `${media}/media-state`, 200, undefined, processor))
    .toMatchObject({ mediaVersion: 1, scanStatus: "pending", previewStatus: "pending" });
  const file = await json<{ url: string }>("GET", `${media}/media-input`, 200, undefined, processor);
  expect(new URL(file.url).searchParams.get("versionId")).toBe(completed.objectVersionId);
  const body = await fetch(file.url, { signal: AbortSignal.timeout(6000) });
  expect(body.status).toBe(200);
  expect(createHash("sha256").update(Buffer.from(await body.arrayBuffer())).digest("hex")).toBe(sha256);
  await json("PUT", `${media}/media-state`, 422, { ...input, ...write(), objectVersionId: "different" }, processor);
  await json("PUT", `${media}/media-state`, 422, { ...input, ...write(), sha256: "a".repeat(64) }, processor);
  const reported = await json("PUT", `${media}/media-state`, 200, input, processor);
  expect(reported).toMatchObject({ mediaVersion: 2, scanStatus: "passed", previewStatus: "ready", dimensions: { width: 1, height: 1 } });
  expect(await json("PUT", `${media}/media-state`, 200, input, processor)).toEqual(reported);
  await json("PUT", `${media}/media-state`, 409, { ...input, ...write() }, processor);
  expect(await json("PUT", `${media}/media-state`, 409, {
    ...input, ...write(), expectedVersion: 2, result: { scanStatus: "failed" },
  }, processor)).toMatchObject({ code: "MEDIA_STATE_CONFLICT" });
}
