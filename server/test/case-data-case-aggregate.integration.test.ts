import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, it } from "vitest";

const migratorUrl = process.env.CASE_DATA_AGGREGATE_TEST_MIGRATOR_URL;
const authoringUrl = process.env.CASE_DATA_AGGREGATE_TEST_AUTHORING_URL;
const repositoryModule = new URL("../case-data/case-aggregate.mjs", import.meta.url).href;

it.skipIf(!migratorUrl || !authoringUrl)("persists a case aggregate and admits only one concurrent change at the same version", async () => {
  const { createCaseAggregate } = await import(repositoryModule);
  for (const connectionString of [migratorUrl!, authoringUrl!]) {
    const url = new URL(connectionString);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/libiaolink_case") {
      throw new Error("Use a disposable loopback case database for this test");
    }
  }

  const owner = new Pool({ connectionString: migratorUrl });
  const authoring = new Pool({ connectionString: authoringUrl });
  const cases = createCaseAggregate(authoring);
  try {
    const { rows: [{ count }] } = await owner.query('select count(*)::int as count from "case".cases');
    expect(count).toBe(0);
    const [projectId, deletedId, missingId] = [randomUUID(), randomUUID(), randomUUID()] as const;
    await owner.query(`
      insert into project_read.project_summary
        (project_id, project_code, project_name, region, project_type, manager_ids, manager_names, status,
         source_version, source_updated_at, deleted_at, source_missing_at, synced_at)
      values ($1, 'ARCHIVED', '归档项目', '华东', '分拣', array[gen_random_uuid()], array[null::text], 'archived', 3, now(), null, null, now()),
             ($2, 'DELETED', '已删除', '华东', '分拣', array[gen_random_uuid()], array[null::text], 'active', 3, now(), now(), null, now()),
             ($3, 'MISSING', '源缺失', '华东', '分拣', array[gen_random_uuid()], array[null::text], 'active', 3, now(), null, now(), now())
    `, [projectId, deletedId, missingId]);
    await owner.query(`insert into "case".project_profiles (project_id, source_version, attributes)
      values ($1, 3, '{"solutionTypes":["airrob"]}')`, [projectId]);

    const caseId = randomUUID();
    const fields = [{ key: "background", fieldType: "text", valueText: "示例背景", classification: "L1",
      customerShareAllowed: true, customerPresentationAllowed: true, aiAllowed: false, sortOrder: 0 }];
    const input = {
      caseId, sourceProjectId: projectId, sourceVersion: 3, operatorUserKey: "example-author",
      locale: "zh-CN", title: "  示例案例  ", summary: "原摘要", changeSummary: null,
      content: { schemaVersion: 1, fields },
      solutionParameters: { schemaVersion: 1, groups: [{ solutionType: "airrob", parameters: { sets: "12" } }] },
      outcomes: { schemaVersion: 1, metrics: [{ label: "效率", value: 40, unit: "%" }] },
      confidentiality: { schemaVersion: 1, mode: "partial", customerIdentity: "internal",
        contentVisibility: "internal", mediaPermission: "secret", internalScope: null },
    };

    for (const sourceProjectId of [deletedId, missingId, randomUUID()]) {
      await expect(cases.create({ ...input, sourceProjectId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(cases.create({ ...input, sourceVersion: 2 })).rejects.toMatchObject({ code: "PROJECT_VERSION_CONFLICT" });
    await expect(cases.create({ ...input, content: { fields: [] } })).rejects.toMatchObject({ code: "23514" });
    await expect(cases.create({ ...input, confidentiality: { ...input.confidentiality, mode: "private" } }))
      .rejects.toMatchObject({ code: "23514" });
    const created = await cases.create(input);
    expect(created).toMatchObject({ caseId, sourceProjectId: projectId, rowVersion: 1, title: "示例案例",
      locale: "zh-CN", summary: "原摘要", createdBy: "example-author" });
    expect(await cases.get(caseId)).toEqual(created);
    await expect(createCaseAggregate(owner).get(caseId)).rejects.toThrow("网关作者角色");
    await expect(cases.create(input)).rejects.toMatchObject({ code: "CASE_ID_CONFLICT" });
    await expect(cases.get(randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await cases.patch(caseId, 1, { title: " 示例案例 ", content: { fields, schemaVersion: 1 } })).toEqual(created);
    const changed = await cases.patch(caseId, 1, { summary: null, content: { schemaVersion: 1, fields: [] } });
    expect(changed).toMatchObject({ rowVersion: 2, summary: null, content: { schemaVersion: 1, fields: [] },
      solutionParameters: input.solutionParameters, outcomes: input.outcomes, confidentiality: input.confidentiality });
    expect(await cases.patch(caseId, 2, { summary: "" })).toEqual(changed);
    expect(await cases.patch(caseId, 2, {})).toEqual(changed);
    await expect(cases.patch(caseId, 2, { content: null })).rejects.toMatchObject({ code: "23514" });
    expect(await cases.get(caseId)).toEqual(changed);
    await expect(cases.patch(caseId, 1, { summary: null })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(cases.patch(caseId, 2, { locale: "en" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(authoring.query('update "case".cases set source_project_id = $2 where id = $1', [caseId, deletedId]))
      .rejects.toMatchObject({ code: "42501" });

    const competing = await Promise.allSettled([
      cases.patch(caseId, 2, { changeSummary: "并发更新甲" }),
      cases.patch(caseId, 2, { changeSummary: "并发更新乙" }),
    ]);
    const written = competing.filter((result) => result.status === "fulfilled");
    const rejected = competing.filter((result) => result.status === "rejected");
    expect(written).toHaveLength(1);
    expect(rejected).toEqual([{ status: "rejected", reason: expect.objectContaining({ code: "VERSION_CONFLICT" }) }]);
    expect(await cases.get(caseId)).toMatchObject({ rowVersion: 3, locale: "zh-CN", sourceProjectId: projectId });
  } finally {
    await Promise.all([owner.end(), authoring.end()]);
  }
}, 20_000);
