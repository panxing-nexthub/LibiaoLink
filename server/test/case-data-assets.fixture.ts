import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Client } from "pg";
import { expect } from "vitest";

type Session = { uploadId: string; assetId: string; assetVersionId: string };
type Target = { url: string; expiresAt: string; headers: Record<string, string> };
type Ticket = { url: string; expiresAt: string; objectVersionId: string };
type Fixture = {
  db: Client;
  base: string;
  caseId: string;
  ownerToken: string;
  anotherToken: string;
  unauthorizedToken: string;
  endpoint: string;
  bucket: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
  adminCredentials: { accessKeyId: string; secretAccessKey: string };
  ticketSeconds: number;
};
const photo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3CkAAAAASUVORK5CYII=", "base64");
const replacement = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64");

export async function verifyCaseAssetRequests(fixture: Fixture) {
  const { db, base, caseId, ownerToken, anotherToken, unauthorizedToken, endpoint, bucket, credentials, adminCredentials,
    ticketSeconds } = fixture;
  const collection = `/api/v1/cases/${caseId}/uploads`;
  const operation = (id: number) => `0190d2e4-a006-7000-8000-${id.toString().padStart(12, "0")}`;
  const createInput = (bytes: Buffer, id: number, assetId?: string) => ({
    operationId: operation(id), operatorUserKey: "asset-fixture", fileName: "现场.png", mimeType: "image/png",
    sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), assetId,
  });
  const send = (path: string, body?: object, token = ownerToken) => fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  const targetPath = (session: Session) => `/api/v1/uploads/${session.uploadId}/target`;
  const completePath = (session: Session) => `/api/v1/uploads/${session.uploadId}/complete`;
  const ticketPath = (session: Session) => `/api/v1/assets/${session.assetId}/versions/${session.assetVersionId}/download-ticket`;
  const put = (target: Target, bytes: Buffer, headers = target.headers) => fetch(target.url, {
    method: "PUT", headers, body: new Uint8Array(bytes), signal: AbortSignal.timeout(5000),
  });
  const download = (url: string) => fetch(url, { signal: AbortSignal.timeout(5000) });
  async function openSession(body: ReturnType<typeof createInput>) {
    const opened = await send(collection, body);
    expect(opened.status, JSON.stringify(await opened.clone().json())).toBe(201);
    const session = await opened.json() as Session;
    expect(await (await send(collection, body)).json()).toEqual(session);
    const targetResponse = await send(targetPath(session));
    expect(targetResponse.status).toBe(200);
    return { session, target: await targetResponse.json() as Target };
  }
  async function upload(target: Target, bytes: Buffer) {
    const transferred = await put(target, bytes);
    expect(transferred.status, transferred.ok ? "" : (await transferred.text()).match(/<Code>([^<]+)<\/Code>/)?.[1]).toBe(200);
    const version = transferred.headers.get("x-amz-version-id");
    expect(version).toBeTruthy();
    expect(version).not.toBe("null");
    return version!;
  }
  async function getTicket(session: Session, version: string) {
    const response = await send(ticketPath(session));
    expect(response.status, response.ok ? "" : JSON.stringify(await response.clone().json())).toBe(200);
    const ticket = await response.json() as Ticket;
    expect(ticket.objectVersionId).toBe(version);
    const url = new URL(ticket.url);
    expect(url.searchParams.get("versionId")).toBe(version);
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(ticketSeconds));
    expect(Date.parse(ticket.expiresAt) - Date.now()).toBeLessThanOrEqual(ticketSeconds * 1000);
    return ticket;
  }

  expect((await fetch(base + "/readyz")).status).toBe(200);
  expect((await send(collection, { ...createInput(photo, 1), sizeBytes: 256 * 1024 * 1024 + 1 })).status).toBe(422);
  expect((await send(collection, createInput(photo, 1), unauthorizedToken)).status).toBe(403);
  const { session, target } = await openSession(createInput(photo, 1));
  const parameters = new URL(target.url).searchParams;
  expect(parameters.get("X-Amz-Expires")).toBe("120");
  for (const header of ["content-length", "content-type", "if-none-match", "x-amz-checksum-sha256"]) {
    expect(parameters.get("X-Amz-SignedHeaders")?.split(";")).toContain(header);
  }
  expect((await send(targetPath(session), undefined, anotherToken)).status).toBe(404);
  expect((await send(ticketPath(session))).status).toBe(404);
  const receipt = await send(`/api/v1/operations/${operation(1)}`);
  expect(receipt.status).toBe(200);
  expect(await receipt.json()).toMatchObject({ statusCode: 201, resourceId: session.uploadId, response: session });
  expect((await put(target, photo, { ...target.headers, "content-type": "application/octet-stream" })).status).toBe(403);
  const corrupt = Buffer.from(photo);
  corrupt[corrupt.length - 1] = corrupt.at(-1)! ^ 1;
  expect((await put(target, corrupt)).status).toBe(400);
  const firstVersion = await upload(target, photo);
  expect((await put(target, photo)).status).toBe(412);
  const complete = { operationId: operation(2), operatorUserKey: "asset-fixture", objectVersionId: firstVersion };
  const missingVersion = (await db.query("select gen_random_uuid() as id")).rows[0].id;
  const missing = await send(completePath(session), { ...complete, objectVersionId: missingVersion });
  expect(missing.status, JSON.stringify(await missing.clone().json())).toBe(409);
  expect((await send(completePath(session), complete, anotherToken)).status).toBe(404);
  const finalized = await send(completePath(session), complete);
  expect(finalized.status, JSON.stringify(await finalized.clone().json())).toBe(200);
  const asset = await finalized.json();
  expect(asset).toMatchObject({ assetId: session.assetId, assetVersionId: session.assetVersionId, caseId,
    objectVersionId: firstVersion, scanStatus: "pending", sha256: createInput(photo, 1).sha256 });
  expect(await (await send(completePath(session), complete)).json()).toEqual(asset);
  expect((await send(targetPath(session))).status).toBe(409);
  expect((await send(ticketPath(session), undefined, anotherToken)).status).toBe(404);
  expect((await send(ticketPath(session), undefined, unauthorizedToken)).status).toBe(403);

  const second = await openSession(createInput(replacement, 3, session.assetId));
  expect(second.session.assetId).toBe(session.assetId);
  expect(second.session.assetVersionId).not.toBe(session.assetVersionId);
  const secondVersion = await upload(second.target, replacement);
  expect((await send(completePath(second.session), { ...complete, operationId: operation(4), objectVersionId: secondVersion })).status).toBe(200);
  const newerTicket = await getTicket(second.session, secondVersion);
  expect(Buffer.from(await (await download(newerTicket.url)).arrayBuffer())).toEqual(replacement);

  const admin = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: adminCredentials });
  const restricted = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials });
  const key = `cases/${caseId}/${session.assetVersionId}`;
  const httpStatus = (call: Promise<{ $metadata: { httpStatusCode?: number } }>) =>
    call.then((output) => output.$metadata.httpStatusCode, (error) => error.$metadata?.httpStatusCode);
  try {
    expect(await httpStatus(restricted.send(new PutObjectCommand({ Bucket: "libiaolink-case-local", Key: key, Body: photo })))).toBe(403);
    const unpinned = restricted.send(new GetObjectCommand({ Bucket: bucket, Key: key })).then(async (output) => {
      await output.Body?.transformToByteArray();
      return output;
    });
    expect(await httpStatus(unpinned)).toBe(403);
    expect(await httpStatus(restricted.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: firstVersion })))).toBe(403);
    const wrongSha = await openSession(createInput(photo, 7));
    const wrongObject = await admin.send(new PutObjectCommand({
      Bucket: bucket, Key: `cases/${caseId}/${wrongSha.session.assetVersionId}`, ContentType: "image/png", Body: corrupt,
    }));
    const wrongHash = await send(completePath(wrongSha.session), {
      ...complete, operationId: operation(8), objectVersionId: wrongObject.VersionId,
    });
    expect(wrongHash.status).toBe(422);
    expect(await wrongHash.json()).toMatchObject({ code: "ASSET_OBJECT_MISMATCH" });
    // The isolated fixture administrator simulates another object becoming the latest version.
    await admin.send(new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "image/png", Body: replacement }));
    const oldTicket = await getTicket(session, firstVersion);
    const oldDownload = await download(oldTicket.url);
    expect(oldDownload.status).toBe(200);
    expect(oldDownload.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await oldDownload.arrayBuffer())).toEqual(photo);
    await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: firstVersion }));
    expect((await send(ticketPath(session))).status).toBe(404);
  } finally {
    admin.destroy();
    restricted.destroy();
  }

  const bogusBytes = Buffer.from("not PNG data");
  const bogus = await openSession(createInput(bogusBytes, 5));
  const bogusVersion = await upload(bogus.target, bogusBytes);
  const denied = await send(completePath(bogus.session), { ...complete, operationId: operation(6), objectVersionId: bogusVersion });
  expect(denied.status).toBe(422);
  expect(await denied.json()).toMatchObject({ code: "ASSET_OBJECT_MISMATCH" });
  await db.query('update "case".case_asset_uploads set expires_at = now() where id = $1', [bogus.session.uploadId]);
  expect((await send(targetPath(bogus.session))).status).toBe(410);
  expect((await send(completePath(bogus.session), { ...complete, operationId: operation(6), objectVersionId: bogusVersion })).status).toBe(410);
  const single = await openSession(createInput(photo, 9));
  const recovery = { operationId: operation(10), operatorUserKey: "asset-fixture" };
  const noObject = await send(completePath(single.session), recovery);
  expect(noObject.status).toBe(409);
  expect(await noObject.json()).toMatchObject({ code: "UPLOAD_OBJECT_MISSING" });
  const originalVersion = await upload(single.target, photo);
  const recovered = await send(completePath(single.session), recovery);
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toMatchObject({ assetVersionId: single.session.assetVersionId, objectVersionId: originalVersion });
  expect((await send(completePath(single.session), recovery)).status).toBe(200);
  const stored = await db.query('select count(*)::int as count from "case".case_assets where case_id = $1', [caseId]);
  expect(stored.rows).toEqual([{ count: 3 }]);
  await setTimeout(Math.max(0, Date.parse(newerTicket.expiresAt) - Date.now() + 1250));
  const expiredTicket = await download(newerTicket.url);
  expect(expiredTicket.status).toBe(403);
  expect(await expiredTicket.text()).toContain("Request has expired");
}
