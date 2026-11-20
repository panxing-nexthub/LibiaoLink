import { z } from "../zod.ts";
import { caseWriteContext, CaseUuidSchema } from "./case-requests.ts";

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
export const CaseProjectCatalogItemSchema = z.strictObject({
  externalProjectId: z.uuid(), projectCode: z.string(), projectName: z.string(), customerText: z.string().nullable(),
  region: z.string(), projectType: z.string(), managerIds: z.array(z.uuid()), managerNames: z.array(z.string().nullable()),
  status, sourceVersion: z.number().int().min(0), updatedAt: timestamp, archivedAt: timestamp.nullable(),
  deletedAt: z.null(), syncedAt: timestamp,
}).openapi("CaseProjectCatalogItem");

export const CaseProjectCatalogPageSchema = z.strictObject({
  items: z.array(CaseProjectCatalogItemSchema).max(200), nextCursor: cursor.nullable(),
}).openapi("CaseProjectCatalogPage");

const projectCode = z.string().trim().min(1).max(50)
  .refine((value) => !/[\0\ud800-\udfff]/u.test(value), "含不支持的字符")
  .openapi({ description: "项目编号：与核心目录可用项跨来源唯一；软删除或源缺失的历史摘要不占编号，归档项仍占用" });
const projectName = z.string().trim().min(1).max(200)
  .refine((value) => !/[\0\ud800-\udfff]/u.test(value), "含不支持的字符");

export const RegisterLocalCaseProjectBodySchema = z.strictObject({
  ...caseWriteContext,
  externalProjectId: CaseUuidSchema.optional().openapi({
    description: "可选的本地项目 UUID；省略时由案例库生成 UUIDv7，跨核心投影与本地项目全局唯一",
  }),
  projectCode, projectName,
  customerText: z.string().trim().max(200).nullable().default(null)
    .transform((value) => value === "" ? null : value),
  region: z.string().trim().min(1).max(100).default("未分类"),
  projectType: z.string().trim().min(1).max(100).default("未分类"),
  managerIds: z.array(CaseUuidSchema).max(200).default([]),
  managerNames: z.array(z.string().trim().min(1).max(200).nullable()).max(200).default([]),
  status: status.default("active"),
}).superRefine((value, context) => {
  if (value.managerIds.length !== value.managerNames.length) {
    context.addIssue({ code: "custom", path: ["managerNames"], message: "经理姓名数量须与经理 ID 一致" });
  }
}).openapi("RegisterLocalCaseProjectBody");

export const PatchLocalCaseProjectBodySchema = z.strictObject({
  ...caseWriteContext,
  expectedVersion: z.number({ error: "expectedVersion 必须是正整数" }).int().min(1).max(2_147_483_647),
  projectCode: projectCode.optional(),
  projectName: projectName.optional(),
  customerText: z.string().trim().max(200).nullable().optional()
    .transform((value) => value === "" ? null : value),
  region: z.string().trim().min(1).max(100).optional(),
  projectType: z.string().trim().min(1).max(100).optional(),
  managerIds: z.array(CaseUuidSchema).max(200).optional(),
  managerNames: z.array(z.string().trim().min(1).max(200).nullable()).max(200).optional(),
  status: status.optional(),
}).superRefine((value, context) => {
  const mutable = ["projectCode", "projectName", "customerText", "region", "projectType",
    "managerIds", "managerNames", "status"] as const;
  if (!mutable.some((key) => value[key] !== undefined)) {
    context.addIssue({ code: "custom", message: "至少提供一个可更新字段" });
  }
  if ((value.managerIds === undefined) !== (value.managerNames === undefined)) {
    context.addIssue({ code: "custom", path: ["managerNames"], message: "managerIds 与 managerNames 必须同时提供" });
  } else if (value.managerIds && value.managerNames
      && value.managerIds.length !== value.managerNames.length) {
    context.addIssue({ code: "custom", path: ["managerNames"], message: "经理姓名数量须与经理 ID 一致" });
  }
}).openapi("PatchLocalCaseProjectBody");
