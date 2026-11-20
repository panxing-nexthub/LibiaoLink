import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Client } from "pg";
import { expect } from "vitest";

type Asset = { assetId: string; assetVersionId: string; objectVersionId: string };
type Release = { releaseId: string; status: string };
type Fixture = {
  base: string; caseId: string; anotherCaseId: string; projectId: string; authorToken: string; publicToken: string;
  db: Client; publicDb: Client; endpoint: string; bucket: string;
  adminCredentials: { accessKeyId: string; secretAccessKey: string };
};
const original = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3CkAAAAASUVORK5CYII=", "base64");
const replacement = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64");

export async function verifyCaseReleaseRequests(fixture: Fixture) {
  const { base, caseId, anotherCaseId, projectId, authorToken, publicToken, db, publicDb } = fixture;
  const casePath = `/api/v1/cases/${caseId}`;
  const collection = `${casePath}/releases`;
  const authorPath = ({ releaseId }: Release) => `${collection}/${releaseId}`;
  const publicPath = (release: Release) => `/api/v1/public/cases/${caseId}/releases/${release.releaseId}`;
  const mediaPath = (release: Release, asset: Asset) => `${publicPath(release)}/assets/${asset.assetVersionId}/content`;
  let count = 0;
  const write = () => ({ operationId: `0190d2e4-a020-7000-8000-${String(++count).padStart(12, "0")}`,
    operatorUserKey: "release-fixture" });
  const send = (path: string, body?: object, token = authorToken) => fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(7000),
  });
  const sendMethod = (method: string, path: string, body: object) => fetch(base + path, {
    method, headers: { Authorization: `Bearer ${authorToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(7000),
  });
  const publicGet = (path: string) => send(path, undefined, publicToken);
  async function expectCode(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  }
  async function upload(bytes: Buffer, assetId?: string): Promise<Asset> {
    const opened = await send(`${casePath}/uploads`, {
      ...write(), assetId, fileName: "仅内部素材文件名.png", mimeType: "image/png", sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(opened.status).toBe(201);
    const session = await opened.json() as { uploadId: string };
    const targetPath = `/api/v1/uploads/${session.uploadId}`;
    const signed = await send(`${targetPath}/target`);
    expect(signed.status).toBe(200);
    const target = await signed.json() as { url: string; headers: Record<string, string> };
    const stored = await fetch(target.url, {
      method: "PUT", headers: target.headers, body: new Uint8Array(bytes), signal: AbortSignal.timeout(5000),
    });
    expect(stored.status).toBe(200);
    const objectVersionId = stored.headers.get("x-amz-version-id");
    const result = await send(`${targetPath}/complete`, { ...write(), objectVersionId });
    expect(result.status).toBe(200);
    const asset = await result.json() as Asset;
    return { assetId: asset.assetId, assetVersionId: asset.assetVersionId, objectVersionId: asset.objectVersionId };
  }
  const stageInput = (title: string, sourceVersion: number, assets: Asset[]) => ({
    ...write(), externalProjectId: projectId, sourceVersion,
    caseSnapshot: { schemaVersion: 1, title, locale: "zh-CN", sections: [{ heading: "亮点", text: "对外内容" }] }, assets,
  });
  async function stage(body: ReturnType<typeof stageInput>, versionNo: number) {
    const response = await send(collection, body);
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    const release = await response.json() as Release;
    expect(release).toMatchObject({ caseId, status: "staged", versionNo, sourceVersion: body.sourceVersion,
      caseContentHash: expect.stringMatching(/^[a-f0-9]{64}$/), projectSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    return release;
  }
  const activation = (expectedActiveReleaseId: string | null) => ({
    ...write(), expectedActiveReleaseId, approvalRef: "review:opaque-20261119",
  });
  const activate = (release: Release, body: ReturnType<typeof activation>) => send(`${authorPath(release)}/activate`, body);
  async function protect(asset: Asset) {
    await expect(db.query('delete from "case".case_assets where asset_version_id = $1', [asset.assetVersionId]))
      .rejects.toMatchObject({ code: "23001", constraint: "case_release_assets_asset_version_fk" });
  }

  expect((await fetch(base + "/readyz")).status).toBe(200);
  const before = await upload(original);
  await expectCode(await send(collection, stageInput("项目版本不符", 3, [])), 409, "PROJECT_VERSION_CONFLICT");
  await expectCode(await send(`/api/v1/cases/${anotherCaseId}/releases`, stageInput("跨案例素材", 4, [before])),
    409, "RELEASE_ASSET_MISMATCH");
  const wrongReference = { ...before, objectVersionId: "another-version" };
  await expectCode(await send(collection, stageInput("对象版本不匹配", 4, [wrongReference])), 409, "RELEASE_ASSET_MISMATCH");
  const invalidSnapshot = stageInput("公开快照拒绝内部字段", 4, []);
  await expectCode(await send(collection, { ...invalidSnapshot, caseSnapshot: { ...invalidSnapshot.caseSnapshot, approvalRef: "secret" } }),
    422, "VALIDATION_FAILED");
  const firstInput = stageInput("首次公开标题", 4, [before]);
  const first = await stage(firstInput, 1);
  expect(await (await send(collection, firstInput)).json()).toEqual(first);
  await protect(before);
  const protectedDelete = await sendMethod("PATCH", `/api/v1/assets/${before.assetId}`, {
    operationId: write().operationId, operatorUserKey: "release-fixture", expectedVersion: 1, deleted: true,
  });
  expect(protectedDelete.status).toBe(409);
  expect(await protectedDelete.json()).toMatchObject({ code: "ASSET_REFERENCED" });
  expect((await publicGet(publicPath(first))).status).toBe(404);
  expect((await publicGet(mediaPath(first, before))).status).toBe(404);
  await expectCode(await activate(first, activation(null)), 409, "RELEASE_ASSET_NOT_READY");

  // Fixture records the external media worker's future verdict. The gateway role has no such update grant.
  await db.query('update "case".case_assets set scan_status = \'passed\' where asset_version_id = $1', [before.assetVersionId]);
  await db.query("update project_read.project_summary set project_name = '项目新名', source_version = 5 where project_id = $1", [projectId]);
  await db.query('update "case".cases set title = \'新草稿\' where id = $1', [caseId]);
  const firstActivation = activation(null);
  const activated = await activate(first, firstActivation);
  expect(activated.status, JSON.stringify(await activated.clone().json())).toBe(200);
  expect(await activated.json()).toMatchObject({ releaseId: first.releaseId, status: "active", sourceVersion: 4 });
  await protect(before);
  const visible = await publicGet(publicPath(first));
  expect(visible.status).toBe(200);
  expect(visible.headers.get("cache-control")).toBe("no-store");
  const view = await visible.json();
  expect(view).toMatchObject({ caseId, releaseId: first.releaseId, caseSnapshot: { title: "首次公开标题" },
    assets: [{ assetId: before.assetId, assetVersionId: before.assetVersionId, mimeType: "image/png" }] });
  expect(view).not.toHaveProperty("projectSnapshot");
  expect(view).not.toHaveProperty("approvalRef");
  expect(JSON.stringify(view)).not.toMatch(/新草稿|仅内部|objectVersionId|objectKey/);
  expect((await publicGet(authorPath(first))).status).toBe(403);
  expect((await publicGet(casePath)).status).toBe(403);
  expect((await send(collection, firstInput, publicToken)).status).toBe(403);
  const publicBytes = await publicGet(mediaPath(first, before));
  expect(publicBytes.status).toBe(200);
  expect(publicBytes.headers.get("location")).toBeNull();
  expect(publicBytes.headers.get("cache-control")).toBe("no-store");
  expect(Buffer.from(await publicBytes.arrayBuffer())).toEqual(original);
  expect(await (await send(authorPath(first))).json()).toMatchObject({
    approvalRef: firstActivation.approvalRef, projectSnapshot: { projectName: "项目原名", sourceVersion: 4 }, assets: [before],
  });

  const archivedAsset = await sendMethod("PATCH", `/api/v1/assets/${before.assetId}`, {
    operationId: write().operationId, operatorUserKey: "release-fixture", expectedVersion: 1, archived: true,
  });
  expect(archivedAsset.status).toBe(200);
  await expectCode(await send(collection, stageInput("归档素材不可发布", 5, [before])), 409, "RELEASE_ASSET_MISMATCH");
  const unarchivedAsset = await sendMethod("PATCH", `/api/v1/assets/${before.assetId}`, {
    operationId: write().operationId, operatorUserKey: "release-fixture", expectedVersion: 2, archived: false,
  });
  expect(unarchivedAsset.status).toBe(200);

  const { rows: [missingAsset] } = await db.query(`
    with ids as (
      select uuidv7() as asset_id, uuidv7() as asset_version_id
    ), metadata as (
      insert into "case".case_asset_metadata
        (asset_id, project_id, client_id, asset_type, title, created_by)
      select asset_id, $2, 'case-author', 'image', 'missing.png', 'fixture' from ids
      returning asset_id
    ), asset as (
      insert into "case".case_assets
        (id, case_id, client_id, asset_version_id, object_version_id, object_key, asset_kind,
         original_filename, mime_type, size_bytes, sha256, scan_status, transcode_status, created_by,
         project_id, asset_version_no)
      select i.asset_id, $1, 'case-author', i.asset_version_id, gen_random_uuid()::text,
        'projects/' || $2::uuid || '/assets/' || i.asset_id || '/' || i.asset_version_id,
        'image', 'missing.png', 'image/png', 10, repeat('a', 64), 'passed', 'not_required',
        'fixture', $2, 1
      from ids i join metadata m on m.asset_id = i.asset_id
      returning id, asset_version_id, object_version_id
    ), linked as (
      insert into "case".case_asset_links (asset_id, case_id, project_id, created_by)
      select id, $1, $2, 'fixture' from asset
    )
    select id as "assetId", asset_version_id as "assetVersionId", object_version_id as "objectVersionId" from asset
  `, [caseId, projectId]);
  const missing = await stage(stageInput("缺少锁定对象", 5, [missingAsset]), 2);
  await expectCode(await activate(missing, activation(first.releaseId)), 409, "RELEASE_ASSET_NOT_READY");
  expect((await publicGet(publicPath(first))).status).toBe(200);

  const after = await upload(replacement, before.assetId);
  expect(after.assetVersionId).not.toBe(before.assetVersionId);
  expect((await publicGet(mediaPath(first, after))).status).toBe(404);
  await db.query('update "case".case_assets set scan_status = \'passed\' where asset_version_id = $1', [after.assetVersionId]);
  const second = await stage(stageInput("并发候选 A", 5, [after]), 3);
  const third = await stage(stageInput("并发候选 B", 5, [after]), 4);
  const inputs = [activation(first.releaseId), activation(first.releaseId)];
  const responses = await Promise.all([activate(second, inputs[0]!), activate(third, inputs[1]!)]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const winner = responses[0]!.status === 200 ? second : third;
  const loser = winner === second ? third : second;
  const winningInput = inputs[winner === second ? 0 : 1]!;
  const conflict = responses.find((response) => response.status === 409)!;
  expect(["RELEASE_SWITCH_IN_PROGRESS", "ACTIVE_RELEASE_MISMATCH"]).toContain((await conflict.json() as { code: string }).code);
  await expectCode(await activate(loser, activation(first.releaseId)), 409, "ACTIVE_RELEASE_MISMATCH");
  expect((await activate(winner, winningInput)).status).toBe(200);
  const receipt = await send(`/api/v1/operations/${winningInput.operationId}`);
  expect(receipt.status).toBe(200);
  expect(await receipt.json()).toMatchObject({ statusCode: 200, resourceId: winner.releaseId });
  expect((await publicGet(publicPath(first))).status).toBe(404);
  expect((await publicGet(mediaPath(first, before))).status).toBe(404);
  expect((await publicGet(publicPath(loser))).status).toBe(404);
  expect((await publicGet(publicPath(winner))).status).toBe(200);
  expect(await (await send(authorPath(first))).json()).toMatchObject({ status: "superseded", assets: [before] });
  await db.query('revoke select on "case".published_release_v from case_gateway_public_ro');
  try {
    await expectCode(await publicGet(publicPath(winner)), 503, "PUBLIC_RELEASE_UNAVAILABLE");
    expect((await fetch(base + "/readyz")).status).toBe(503);
    expect((await send(authorPath(winner))).status).toBe(200);
  } finally {
    await db.query('grant select on "case".published_release_v to case_gateway_public_ro');
  }
  await protect(before);
  const activeRows = await publicDb.query('select release_id from "case".published_release_v where case_id = $1', [caseId]);
  expect(activeRows.rows).toEqual([{ release_id: winner.releaseId }]);
  for (const table of ["cases", "case_releases", "case_assets", "case_release_assets", "case_idempotency_keys"]) {
    await expect(publicDb.query(`select * from "case".${table} limit 0`)).rejects.toMatchObject({ code: "42501" });
  }
  await expect(publicDb.query('update "case".published_release_v set case_snapshot = \'{}\' where false'))
    .rejects.toMatchObject({ code: "42501" });
  await expect(db.query(`
    insert into "case".case_release_assets (release_id, case_id, asset_id, asset_version_id, object_version_id, sort_order)
    values ($1, $2, $3, $4, $5, 1)
  `, [loser.releaseId, caseId, before.assetId, before.assetVersionId, before.objectVersionId]))
    .rejects.toMatchObject({ code: "23514" });

  const withdrawal = { ...write(), expectedActiveReleaseId: winner.releaseId };
  const deactivate = () => send(`${authorPath(winner)}/deactivate`, withdrawal);
  const withdrawn = await deactivate();
  expect(withdrawn.status).toBe(200);
  expect(await withdrawn.json()).toMatchObject({ status: "withdrawn", withdrawnAt: expect.any(String) });
  expect((await deactivate()).status).toBe(200);
  expect((await publicGet(publicPath(winner))).status).toBe(404);
  expect((await publicGet(mediaPath(winner, after))).status).toBe(404);
  expect(await (await send(authorPath(winner))).json()).toMatchObject({ status: "withdrawn", assets: [after] });
  await expectCode(await activate(winner, activation(null)), 409, "RELEASE_STATE_CONFLICT");
  await protect(after);
  await expect(db.query(`
    update "case".case_releases set status = 'active', withdrawn_at = null where id = $1
  `, [winner.releaseId])).rejects.toMatchObject({ code: "23514" });

  const admin = new S3Client({ endpoint: fixture.endpoint, region: "us-east-1", forcePathStyle: true,
    credentials: fixture.adminCredentials });
  const { rows: [{ objectKey }] } = await db.query(
    'select object_key as "objectKey" from "case".case_assets where asset_version_id = $1', [before.assetVersionId],
  );
  try {
    // Simulate a newer current object at the same stable key in the disposable proof bucket.
    await admin.send(new PutObjectCommand({ Bucket: fixture.bucket, Key: objectKey,
      Body: replacement, ContentType: "image/png" }));
  } finally {
    admin.destroy();
  }
  const oldTicket = await send(`/api/v1/assets/${before.assetId}/versions/${before.assetVersionId}/download-ticket`);
  expect(oldTicket.status).toBe(200);
  const { url } = await oldTicket.json() as { url: string };
  expect(new URL(url).searchParams.get("versionId")).toBe(before.objectVersionId);
  expect(Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(5000) })).arrayBuffer())).toEqual(original);
}
