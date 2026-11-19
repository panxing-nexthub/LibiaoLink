import { z } from "../zod.ts";
import { CaseLocaleSchema, CaseSolutionTypeSchema, CaseUuidSchema, caseWriteContext } from "./case-requests.ts";

const text = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\0\ud800-\udfff]/u.test(value), "含不支持的字符");
const optionalText = text(256).nullable().default(null);
const timestamp = z.iso.datetime({ offset: true });
const expectedVersion = z.number().int().min(0).max(2_147_483_647);
const sourceVersion = expectedVersion;
const subjectType = z.enum(["customer", "partner", "three_pl"]);
const subjectFields = {
  subjectType, stableKey: text(128), displayName: text(256),
  status: z.enum(["active", "inactive"]).default("active"),
  sourceSystem: text(64).default("case_library"), sourceRef: optionalText,
};
const alias = z.strictObject({ alias: text(256), locale: CaseLocaleSchema.default("zh-CN"), source: optionalText });
const relation = z.strictObject({ subjectId: CaseUuidSchema, subjectType, isPrimary: z.boolean().default(false) });
const member = z.strictObject({
  operatorUserKey: text(128), roleCode: text(64), source: optionalText, isPrimary: z.boolean().default(false),
  leftAt: timestamp.nullable().default(null).transform((value) => value === null ? null : new Date(value).toISOString()),
});
const attributes = z.strictObject({
  regions: distinct(z.array(text(100)).max(50), (region) => region).optional(),
  country: text(100).optional(), industry: text(100).optional(), businessScenario: text(200).optional(),
  solutionTypes: distinct(z.array(CaseSolutionTypeSchema).max(7), (type) => type).optional(),
  canVisit: z.boolean().optional(),
});

function distinct<T extends z.ZodType>(schema: z.ZodArray<T>, identity: (item: z.output<T>) => string) {
  return schema.superRefine((items, context) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      const key = identity(item);
      if (seen.has(key)) context.addIssue({ code: "custom", path: [index], message: "条目不可重复" });
      seen.add(key);
    }
  });
}

const aliases = distinct(z.array(alias).max(100), (item) => JSON.stringify([item.alias, item.locale]));
const subjects = distinct(z.array(relation).max(200), (item) => JSON.stringify([item.subjectId, item.subjectType]));
const members = distinct(z.array(member).max(500), (item) => JSON.stringify([item.operatorUserKey, item.roleCode]));

export const SaveCaseSubjectBodySchema = z.strictObject({
  ...caseWriteContext, expectedVersion, ...subjectFields, aliases,
}).openapi("SaveCaseSubjectBody");
export const CaseSubjectViewSchema = z.strictObject({
  subjectId: CaseUuidSchema, ...subjectFields, aliases, rowVersion: z.number().int().positive(), updatedAt: timestamp,
}).openapi("CaseSubjectView");

export const SaveCaseProjectProfileBodySchema = z.strictObject({
  ...caseWriteContext, expectedVersion, sourceVersion, attributes, subjects, members,
}).openapi("SaveCaseProjectProfileBody");
export const CaseProjectProfileViewSchema = z.strictObject({
  externalProjectId: CaseUuidSchema, sourceVersion, rowVersion: z.number().int().positive(), updatedAt: timestamp,
  attributes: z.record(z.string(), z.unknown()), subjects, members,
}).openapi("CaseProjectProfileView");
