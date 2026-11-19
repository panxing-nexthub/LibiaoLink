import { z } from "../zod.ts";

const schemaVersion = z.literal(1);
const textKeys = z.enum([
  "pain_points", "automation_reason", "background", "before_process", "after_process", "timeline",
  "solution_description_zh", "solution_description_en",
]);
const fieldSettings = {
  classification: z.enum(["L1", "L2", "L3"]).default("L1"),
  customerShareAllowed: z.boolean(),
  customerPresentationAllowed: z.boolean(),
  aiAllowed: z.literal(false),
  sortOrder: z.number().int().min(0).max(100_000),
};
const valueText = z.string().trim().min(1).max(20_000).refine(
  (value) => !/<(?:\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?\/?>|!--|!DOCTYPE\b)/i.test(value), "正文仅接受纯文本",
);
const field = z.discriminatedUnion("fieldType", [
  z.strictObject({ ...fieldSettings, key: textKeys, fieldType: z.literal("text"), valueText }),
  z.strictObject({ ...fieldSettings, key: z.literal("highlights"), fieldType: z.literal("highlights"),
    highlights: z.array(z.string().trim().min(1).max(1000)).min(1).max(100) }),
]);

function addDuplicateIssues(values: string[], fieldName: string, context: z.RefinementCtx) {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) context.addIssue({ code: "custom", path: [index, fieldName], message: "字段值不可重复" });
    seen.add(value);
  }
}

const content = z.strictObject({ schemaVersion, fields: z.array(field).max(200).superRefine((items, context) => {
  addDuplicateIssues(items.map(({ key }) => key), "key", context);
}) });

const airrobParams = ["sets", "flyboxes", "bin_positions", "rack_height", "rack_height_unit", "floor_robots",
  "workstations", "capacity", "capacity_unit", "fire_suppression", "fire_suppression_other"];
const footprintParams = ["capacity", "capacity_unit", "footprint", "footprint_unit"];
const compactParams = ["summary", "workstations", ...footprintParams, "mode"];
const parameterNames = {
  airrob: airrobParams,
  airrob_pro: airrobParams,
  airrob_plus: airrobParams,
  t_sort: ["platforms", "desktop_robots", "carrier", "carrier_other", "chutes", ...footprintParams],
  t_carry: ["sets", "robots", "carrier", "carrier_other", "stations", ...footprintParams],
  "3d": compactParams,
  grabot: compactParams,
};
export const CaseSolutionTypeSchema = z.enum(Object.keys(parameterNames) as [keyof typeof parameterNames, ...(keyof typeof parameterNames)[]]);
const parameters = z.record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]));
const group = z.strictObject({ solutionType: CaseSolutionTypeSchema, parameters }).superRefine((value, context) => {
  const allowed = parameterNames[value.solutionType];
  for (const name of Object.keys(value.parameters)) {
    if (!allowed.includes(name)) context.addIssue({ code: "custom", path: ["parameters"], message: "存在未登记的方案参数" });
  }
});
const solutionParameters = z.strictObject({ schemaVersion, groups: z.array(group).max(20).superRefine((items, context) => {
  addDuplicateIssues(items.map((item) => item.solutionType), "solutionType", context);
}) }).openapi({ description: "方案组按 solutionType 去重。每组参数名须在对应方案字典内，非空方案组须属于该案例来源项目。" });

const metric = z.strictObject({
  label: z.string().trim().min(1).max(200),
  value: z.union([z.string().max(200), z.number()]),
  unit: z.string().max(40).nullable().optional().transform((value) => value === "" ? null : value),
});
const outcomes = z.strictObject({ schemaVersion, metrics: z.array(metric).max(100) });

const visibility = z.enum(["secret", "internal", "public"]);
const confidentiality = z.strictObject({
  schemaVersion, mode: z.enum(["public", "partial", "private"]), customerIdentity: visibility,
  contentVisibility: visibility, mediaPermission: visibility,
  internalScope: z.string().trim().max(2000).nullable().optional().transform((value) => value || null),
}).superRefine((value, context) => {
  if (value.mode === "private" && value.internalScope === null) {
    context.addIssue({ code: "custom", path: ["internalScope"], message: "private 必须提供内部可见范围" });
  }
});

export const CaseOperationIdSchema = z.uuidv7();
export const caseWriteContext = {
  operationId: CaseOperationIdSchema,
  traceId: z.string().min(1).max(256).optional(),
  operatorUserKey: z.string().min(1).max(128).refine((value) => value.trim().length > 0),
};
export const CaseUuidSchema = z.uuid().transform((value) => value.toLowerCase());
const title = z.string().trim().min(1).max(300);
const summary = z.string().max(5000).nullable().transform((value) => value?.trim() ? value : null);
const changeSummary = z.string().min(1).max(1000).refine((value) => value.trim().length > 0).nullable();
export const CaseLocaleSchema = z.string().min(2).max(20).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).refine((value) => {
  try { new Intl.Locale(value); return true; } catch { return false; }
}, "须为有效语言标签");

export const CaseCreateBodySchema = z.strictObject({
  ...caseWriteContext, caseId: CaseUuidSchema.optional(), externalProjectId: CaseUuidSchema,
  sourceVersion: z.number().int().min(0).max(2_147_483_647), locale: CaseLocaleSchema, title, summary: summary.optional(),
  changeSummary: changeSummary.optional(),
  content: content.default({ schemaVersion: 1, fields: [] }),
  solutionParameters: solutionParameters.default({ schemaVersion: 1, groups: [] }),
  outcomes: outcomes.default({ schemaVersion: 1, metrics: [] }),
  confidentiality,
}).openapi("CaseCreateBody");

export const CasePatchBodySchema = z.strictObject({
  ...caseWriteContext, expectedVersion: z.number().int().min(1).max(2_147_483_647), title: title.optional(),
  summary: summary.optional(), changeSummary: changeSummary.optional(), content: content.optional(),
  solutionParameters: solutionParameters.optional(), outcomes: outcomes.optional(), confidentiality: confidentiality.optional(),
}).openapi("CasePatchBody");

// 读面保留既有 JSON 内容，包含早期只读的正文键。
const storedObject = z.record(z.string(), z.unknown());
export const CaseAuthoringViewSchema = z.strictObject({
  caseId: z.uuid(), sourceProjectId: z.uuid(), locale: z.string(), title: z.string(), summary: z.string().nullable(),
  changeSummary: z.string().nullable(), content: storedObject, solutionParameters: storedObject, outcomes: storedObject,
  confidentiality: storedObject, createdBy: z.string(), createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }), rowVersion: z.number().int().min(1),
}).openapi("CaseAuthoringView");

export const CaseOperationResultSchema = z.strictObject({
  operationId: CaseOperationIdSchema, statusCode: z.number().int().min(200).max(599),
  response: storedObject, resourceId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
}).openapi("CaseOperationResult");
