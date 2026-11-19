import { z } from "../zod.ts";

const status = z.enum(["active", "paused", "done", "archived"], { error: "项目状态无效" });
export const caseCatalogCursorPattern = /^([A-Za-z0-9_-]{1,2048})\.([A-Za-z0-9_-]{43})$/;
const cursor = z.string().regex(caseCatalogCursorPattern, "游标无效");
const filter = z.string().refine(
  (value) => value.trim().length > 0 && !value.includes("\0") && [...value].length <= 100,
  "筛选值应为最多 100 字符的非空字符串",
).openapi({ minLength: 1, maxLength: 100 });

export const CaseProjectCatalogQuerySchema = z.strictObject({
  limit: z.number({ error: "limit 必须是 1–200 的整数" }).int().min(1).max(200).default(50),
  cursor: cursor.optional(), status: status.optional(), region: filter.optional(), projectType: filter.optional(),
});

const timestamp = z.iso.datetime({ offset: true });
const project = z.strictObject({
  externalProjectId: z.uuid(), projectCode: z.string(), projectName: z.string(), customerText: z.string().nullable(),
  region: z.string(), projectType: z.string(), managerIds: z.array(z.uuid()), managerNames: z.array(z.string().nullable()),
  status, sourceVersion: z.number().int().min(0), updatedAt: timestamp, archivedAt: timestamp.nullable(),
  deletedAt: z.null(), syncedAt: timestamp,
}).openapi("CaseProjectCatalogItem");

export const CaseProjectCatalogPageSchema = z.strictObject({
  items: z.array(project).max(200), nextCursor: cursor.nullable(),
}).openapi("CaseProjectCatalogPage");
