import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { expect } from "vitest";

export async function verifyProjectData({ db, base, token, catalogToken }: {
  db: Client; base: string; token: string; catalogToken: string;
}) {
  const projectId = randomUUID();
  await db.query(`
    insert into project_read.project_summary (project_id, project_code, project_name, region, project_type,
      manager_ids, manager_names, status, source_version, source_updated_at, synced_at)
    values ($1, 'P-PROFILE', '独立项目侧数据', 'project-data', '分拣', array[$2::uuid], array[null::text], 'active', 12, now(), now())
  `, [projectId, randomUUID()]);
  const profile = `/api/v1/projects/${projectId}/profile`;
  let counter = 0;
  const write = () => ({ operationId: `0190d2e4-b010-7000-8000-${String(++counter).padStart(12, "0")}`, operatorUserKey: "project-fixture" });
  const send = (method: string, path: string, body?: object, bearer = token) => fetch(base + path, {
    method, signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body && JSON.stringify(body),
  });
  async function json<T>(method: string, path: string, status: number, body?: object, bearer?: string) {
    const response = await send(method, path, body, bearer);
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(status);
    return await response.json() as T;
  }
  const customerWrite = {
    ...write(), expectedVersion: 0, subjectType: "customer", stableKey: "C-A",
    displayName: "客户 A", aliases: [{ alias: "旧简称" }, { alias: "客户甲" }],
  };
  await json("POST", "/api/v1/subjects", 403, customerWrite, catalogToken);
  const customer = await json<{ subjectId: string }>("POST", "/api/v1/subjects", 201, customerWrite);
  expect(await json("POST", "/api/v1/subjects", 201, customerWrite)).toEqual(customer);
  expect(await json("POST", "/api/v1/subjects", 409, { ...customerWrite, displayName: "改同键" }))
    .toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const subjectPath = `/api/v1/subjects/${customer.subjectId}`;
  expect(await json("GET", subjectPath, 200)).toEqual(customer);
  const subjectV2 = await json("POST", "/api/v1/subjects", 200, {
    ...customerWrite, ...write(), expectedVersion: 1, aliases: [{ alias: "客户甲" }],
  });
  expect(subjectV2).toMatchObject({ subjectId: customer.subjectId, rowVersion: 2, aliases: [{ alias: "客户甲", locale: "zh-CN" }] });
  expect(await json("POST", "/api/v1/subjects", 409, { ...customerWrite, ...write(), expectedVersion: 1 }))
    .toMatchObject({ code: "VERSION_CONFLICT" });
  const otherSubjects = await Promise.all(["partner", "three_pl"].map(async (subjectType) => {
    const { subjectId } = await json<{ subjectId: string }>("POST", "/api/v1/subjects", 201, {
      ...write(), expectedVersion: 0, subjectType, stableKey: "same-stable-key", displayName: subjectType, aliases: [],
    });
    return { subjectId, subjectType };
  }));
  const input = {
    ...write(), expectedVersion: 0, sourceVersion: 12, attributes: { solutionTypes: ["airrob"], canVisit: false },
    subjects: [{ subjectId: customer.subjectId, subjectType: "customer", isPrimary: true }, ...otherSubjects],
    members: [{ operatorUserKey: "member-main", roleCode: "lead", isPrimary: true, leftAt: "2026-11-19T12:00:00+08:00" }],
  };
  await json("GET", profile, 403, undefined, catalogToken);
  await json("GET", profile, 404);
  await json("PUT", profile, 422, { ...input, attributes: { projectCode: "禁止写核心字段" } });
  expect(await json("PUT", profile, 409, { ...input, ...write(), sourceVersion: 11 })).toMatchObject({ code: "PROJECT_VERSION_CONFLICT" });
  await json("PUT", profile, 422, { ...input, ...write(), subjects: [{ subjectId: customer.subjectId, subjectType: "partner" }] });
  await json("GET", profile, 404);
  const saved = await json("PUT", profile, 201, input);
  expect(saved).toMatchObject({ externalProjectId: projectId, rowVersion: 1,
    attributes: input.attributes, subjects: expect.arrayContaining(input.subjects.map((subject) => expect.objectContaining(subject))),
    members: [{ operatorUserKey: "member-main", roleCode: "lead", isPrimary: true, leftAt: "2026-11-19T04:00:00.000Z" }] });
  expect(await json("PUT", profile, 201, input)).toEqual(saved);
  expect(await json("PUT", profile, 200, { ...input, ...write(), expectedVersion: 1, subjects: [...input.subjects].reverse() })).toEqual(saved);
  expect(await json("GET", profile, 200)).toEqual(saved);
  expect(await json("PUT", profile, 200, { ...input, ...write(), expectedVersion: 1, subjects: [input.subjects[0]], members: [] }))
    .toMatchObject({ rowVersion: 2, subjects: [input.subjects[0]], members: [] });
  expect(await json("PUT", profile, 409, { ...input, ...write(), expectedVersion: 1 })).toMatchObject({ code: "VERSION_CONFLICT" });
  expect((await db.query("select region, source_version from project_read.project_summary where project_id = $1", [projectId])).rows)
    .toEqual([{ region: "project-data", source_version: 12 }]);
  await json("POST", `/api/v1/projects/${projectId}/cases`, 201, {
    ...write(), externalProjectId: projectId, sourceVersion: 12, locale: "zh-CN", title: "通过案例侧方案配置创建",
    solutionParameters: { schemaVersion: 1, groups: [{ solutionType: "airrob", parameters: {} }] },
    confidentiality: { schemaVersion: 1, mode: "public", customerIdentity: "public", contentVisibility: "public", mediaPermission: "public" },
  });
}
