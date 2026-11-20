import { createHash, randomUUID } from "node:crypto";
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
  projectId: string;
  ownerToken: string;
  anotherToken: string;
  unauthorizedToken: string;
  endpoint: string;
  bucket: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
  adminCredentials: { accessKeyId: string; secretAccessKey: string };
  ticketSeconds: number;
  iamEnforced: boolean;
};
const photo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3CkAAAAASUVORK5CYII=", "base64");
const replacement = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64");

export async function verifyCaseAssetRequests(fixture: Fixture) {
  const { db, base, caseId, projectId, ownerToken, anotherToken, unauthorizedToken, endpoint, bucket, credentials,
    adminCredentials, ticketSeconds, iamEnforced } = fixture;
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
  const sendJson = (method: string, path: string, body: object, token = ownerToken) => fetch(base + path, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  const targetPath = (session: Session) => `/api/v1/uploads/${session.uploadId}/target`;
  const completePath = (session: Session) => `/api/v1/uploads/${session.uploadId}/complete`;
  const ticketPath = (session: Session) => `/api/v1/assets/${session.assetId}/versions/${session.assetVersionId}/download-ticket`;
  const previewPath = (session: Session) => `/api/v1/assets/${session.assetId}/versions/${session.assetVersionId}/preview-ticket`;
  const put = (target: Target, bytes: Buffer, headers = target.headers) => fetch(target.url, {
    method: "PUT", headers, body: new Uint8Array(bytes), signal: AbortSignal.timeout(5000),
  });
  const download = (url: string) => fetch(url, { signal: AbortSignal.timeout(5000) });
  async function openSession(body: ReturnType<typeof createInput> & { assetType?: string }, collectionPath = collection) {
    const opened = await send(collectionPath, body);
    expect(opened.status, JSON.stringify(await opened.clone().json())).toBe(201);
    const session = await opened.json() as Session;
    expect(await (await send(collectionPath, body)).json()).toEqual(session);
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

  const assetDetail = await send(`/api/v1/assets/${session.assetId}`);
  expect(assetDetail.status).toBe(200);
  expect(await assetDetail.json()).toMatchObject({
    assetId: session.assetId, projectId, caseIds: [caseId], rowVersion: 2,
    currentVersion: { assetVersionId: second.session.assetVersionId, versionNo: 2, objectVersionId: secondVersion },
  });
  const versions = await send(`/api/v1/assets/${session.assetId}/versions`);
  expect(versions.status).toBe(200);
  expect(await versions.json()).toMatchObject({ assetId: session.assetId, items: [
    { assetVersionId: second.session.assetVersionId, versionNo: 2 },
    { assetVersionId: session.assetVersionId, versionNo: 1 },
  ] });
  const previewResponse = await send(previewPath(session));
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json() as Ticket & { contentType: string };
  expect(preview.objectVersionId).toBe(firstVersion);
  expect(preview.contentType).toBe("image/png");
  const previewBytes = await download(preview.url);
  expect(previewBytes.status).toBe(200);
  expect(previewBytes.headers.get("content-type")).toContain("image/png");
  expect(Buffer.from(await previewBytes.arrayBuffer())).toEqual(photo);

  const secondCaseId = randomUUID();
  await db.query(`insert into "case".cases
    (id, source_project_id, locale, title, created_by, confidentiality)
    values ($1, $2, $3, $4, $5, $6::jsonb)`, [secondCaseId, projectId, "en-US", "Shared asset case", "fixture",
    JSON.stringify({ schemaVersion: 1, mode: "partial", customerIdentity: "internal", contentVisibility: "internal",
      mediaPermission: "secret" })]);
  const projectCollection = `/api/v1/projects/${projectId}/uploads`;
  const logoInput = {
    ...createInput(photo, 20), fileName: "project-logo.png", assetType: "logo" as const,
    title: "项目 Logo", description: "跨案例复用素材", locale: "zh-CN", tags: ["品牌", "共享"],
    classification: "L2" as const, customerVisible: true, customerPresentationAllowed: true, shareAllowed: true,
  };
  const projectAsset = await openSession(logoInput, projectCollection);
  const logoVersion = await upload(projectAsset.target, photo);
  const logoCompletedResponse = await send(completePath(projectAsset.session), {
    operationId: operation(21), operatorUserKey: "asset-fixture", objectVersionId: logoVersion,
  });
  expect(logoCompletedResponse.status, JSON.stringify(await logoCompletedResponse.clone().json())).toBe(200);
  const logoCompleted = await logoCompletedResponse.json() as Session & { projectId: string; caseId: string | null;
    assetType: string; title: string; tags: string[]; rowVersion: number };
  expect(logoCompleted).toMatchObject({ projectId, caseId: null, assetType: "logo", title: "项目 Logo",
    tags: ["品牌", "共享"], classification: "L2", rowVersion: 1 });
  const linkPath = (targetCaseId: string) => `/api/v1/assets/${projectAsset.session.assetId}/cases/${targetCaseId}`;
  const link = (targetCaseId: string, operationId: string) => sendJson("PUT", linkPath(targetCaseId), {
    operationId, operatorUserKey: "asset-fixture",
  });
  expect((await link(caseId, operation(22))).status).toBe(200);
  expect((await link(secondCaseId, operation(23))).status).toBe(200);
  const sharedDetail = await (await send(`/api/v1/assets/${projectAsset.session.assetId}`)).json() as {
    caseIds: string[]; rowVersion: number;
  };
  expect(sharedDetail).toMatchObject({ projectId, rowVersion: 1, caseIds: expect.arrayContaining([caseId, secondCaseId]) });
  for (const targetCaseId of [caseId, secondCaseId]) {
    const listed = await (await send(`/api/v1/cases/${targetCaseId}/assets?limit=200`)).json() as {
      items: Array<Record<string, unknown>>;
    };
    expect(listed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: projectAsset.session.assetId, caseIds: expect.arrayContaining([caseId, secondCaseId]) }),
    ]));
  }
  const unlink = await sendJson("DELETE", linkPath(secondCaseId), {
    operationId: operation(24), operatorUserKey: "asset-fixture",
  });
  expect(unlink.status).toBe(200);
  expect(await unlink.json()).toMatchObject({ assetId: projectAsset.session.assetId, caseId: secondCaseId, linked: false });
  const secondCaseAssets = await (await send(`/api/v1/cases/${secondCaseId}/assets?limit=200`)).json() as {
    items: Array<Record<string, unknown>>;
  };
  expect(secondCaseAssets.items.some(({ assetId }) => assetId === projectAsset.session.assetId)).toBe(false);

  const metadataUpdate = await sendJson("PATCH", `/api/v1/assets/${projectAsset.session.assetId}`, {
    operationId: operation(25), operatorUserKey: "asset-fixture", expectedVersion: 1,
    title: "项目 Logo（更新）", tags: ["品牌", "共享", "更新"], customerPresentationAllowed: false,
  });
  expect(metadataUpdate.status).toBe(200);
  expect(await metadataUpdate.json()).toMatchObject({ rowVersion: 2, title: "项目 Logo（更新）",
    tags: ["品牌", "共享", "更新"], customerPresentationAllowed: false });

  const logoSecond = await openSession({ ...logoInput, ...createInput(replacement, 26, projectAsset.session.assetId),
    fileName: "project-logo.png", assetType: "logo" }, projectCollection);
  const logoSecondVersion = await upload(logoSecond.target, replacement);
  expect((await send(completePath(logoSecond.session), {
    operationId: operation(27), operatorUserKey: "asset-fixture", objectVersionId: logoSecondVersion,
  })).status).toBe(200);
  const logoAfterVersion = await (await send(`/api/v1/assets/${projectAsset.session.assetId}`)).json() as Record<string, unknown>;
  expect(logoAfterVersion).toMatchObject({ rowVersion: 3,
    currentVersion: { assetVersionId: logoSecond.session.assetVersionId, versionNo: 2, objectVersionId: logoSecondVersion } });
  const logoVersions = await (await send(`/api/v1/assets/${projectAsset.session.assetId}/versions`)).json() as {
    items: Array<Record<string, unknown>>;
  };
  expect(logoVersions.items.map(({ versionNo }) => versionNo)).toEqual([2, 1]);

  const deleteLogo = await sendJson("PATCH", `/api/v1/assets/${projectAsset.session.assetId}`, {
    operationId: operation(28), operatorUserKey: "asset-fixture", expectedVersion: 3, deleted: true,
  });
  expect(deleteLogo.status).toBe(200);
  expect(await deleteLogo.json()).toMatchObject({ rowVersion: 4, deletedAt: expect.any(String) });
  const visibleAfterDelete = await (await send(`/api/v1/projects/${projectId}/assets?limit=200`)).json() as {
    items: Array<Record<string, unknown>>;
  };
  expect(visibleAfterDelete.items.some(({ assetId }) => assetId === projectAsset.session.assetId)).toBe(false);
  const restoreLogo = await sendJson("PATCH", `/api/v1/assets/${projectAsset.session.assetId}`, {
    operationId: operation(29), operatorUserKey: "asset-fixture", expectedVersion: 4, deleted: false,
  });
  expect(restoreLogo.status).toBe(200);
  expect(await restoreLogo.json()).toMatchObject({ rowVersion: 5, deletedAt: null });

  const avif = Buffer.alloc(24);
  avif.writeUInt32BE(24, 0);
  avif.write("ftyp", 4, "ascii");
  avif.write("mif1", 8, "ascii");
  avif.writeUInt32BE(0, 12);
  avif.write("avif", 16, "ascii");
  avif.write("mif1", 20, "ascii");
  const avifInput = { ...createInput(avif, 30), fileName: "现场.avif", mimeType: "image/avif" as const };
  const avifAsset = await openSession(avifInput, projectCollection);
  const avifVersion = await upload(avifAsset.target, avif);
  const avifCompletedResponse = await send(completePath(avifAsset.session), {
    operationId: operation(31), operatorUserKey: "asset-fixture", objectVersionId: avifVersion,
  });
  expect(avifCompletedResponse.status, JSON.stringify(await avifCompletedResponse.clone().json())).toBe(200);
  expect(await avifCompletedResponse.json()).toMatchObject({ mimeType: "image/avif", previewStatus: "pending" });
  const avifPreviewResponse = await send(previewPath(avifAsset.session));
  expect(avifPreviewResponse.status).toBe(200);
  const avifPreview = await avifPreviewResponse.json() as Ticket & { contentType: string };
  expect(avifPreview.contentType).toBe("image/avif");
  const avifBytes = await download(avifPreview.url);
  expect(avifBytes.status).toBe(200);
  expect(Buffer.from(await avifBytes.arrayBuffer())).toEqual(avif);
  const archiveAvif = await sendJson("PATCH", `/api/v1/assets/${avifAsset.session.assetId}`, {
    operationId: operation(32), operatorUserKey: "asset-fixture", expectedVersion: 1, archived: true,
  });
  expect(archiveAvif.status).toBe(200);
  expect(await archiveAvif.json()).toMatchObject({ rowVersion: 2, archivedAt: expect.any(String) });
  const archivedList = await (await send(`/api/v1/projects/${projectId}/assets?limit=200&includeArchived=true`)).json() as {
    items: Array<Record<string, unknown>>;
  };
  expect(archivedList.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ assetId: avifAsset.session.assetId, archivedAt: expect.any(String) }),
  ]));
  const restoreAvif = await sendJson("PATCH", `/api/v1/assets/${avifAsset.session.assetId}`, {
    operationId: operation(33), operatorUserKey: "asset-fixture", expectedVersion: 2, archived: false,
  });
  expect(restoreAvif.status).toBe(200);
  expect(await restoreAvif.json()).toMatchObject({ rowVersion: 3, archivedAt: null });

  const admin = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: adminCredentials });
  const restricted = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials });
  const key = (await db.query(
    'select object_key as "objectKey" from "case".case_asset_uploads where id = $1', [session.uploadId],
  )).rows[0].objectKey;
  const httpStatus = (call: Promise<{ $metadata: { httpStatusCode?: number } }>) =>
    call.then((output) => output.$metadata.httpStatusCode, (error) => error.$metadata?.httpStatusCode);
  try {
    if (iamEnforced) {
      expect(await httpStatus(restricted.send(new PutObjectCommand({ Bucket: "libiaolink-case-local", Key: key, Body: photo })))).toBe(403);
      const unpinned = restricted.send(new GetObjectCommand({ Bucket: bucket, Key: key })).then(async (output) => {
        await output.Body?.transformToByteArray();
        return output;
      });
      expect(await httpStatus(unpinned)).toBe(403);
      expect(await httpStatus(restricted.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: firstVersion })))).toBe(403);
    }
    const wrongSha = await openSession(createInput(photo, 7));
    const wrongObject = await admin.send(new PutObjectCommand({
      Bucket: bucket,
      Key: (await db.query('select object_key as "objectKey" from "case".case_asset_uploads where id = $1',
        [wrongSha.session.uploadId])).rows[0].objectKey,
      ContentType: "image/png", Body: corrupt,
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
