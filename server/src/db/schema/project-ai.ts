import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { desc, sql } from "drizzle-orm";
import { projects } from "./projects.js";
import { users } from "./identity.js";

/**
 * AI 项目总结缓存（0111）：只存生成成功的结果。
 * 唯一键 = 项目 + 上下文指纹 + prompt 版本；数据变化后 source_hash 改变，自然失效并写入新行。
 */
export const projectAiSummaries = pgTable(
  "project_ai_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    sourceHash: text("source_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    modelId: text("model_id"),
    summaryText: text("summary_text").notNull(),
    summaryJson: jsonb("summary_json").$type<Record<string, unknown>>().notNull(),
    generatedBy: uuid("generated_by").references(() => users.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_project_ai_summaries_source").on(table.projectId, table.sourceHash, table.promptVersion),
    index("ix_project_ai_summaries_project").on(table.projectId, desc(table.generatedAt)),
    check(
      "ck_project_ai_summaries_text",
      sql`char_length(${table.summaryText}) between 1 and 20000`,
    ),
  ],
);

/** project_ai_manual_images（0115 / 0117）：设备布局 / 三维图的人工图片；一项目一类型可多张，按 sort_order 排序。 */
/** project_ai_hidden_agreement_images（0125）：被用户移除的自动抽取图；按 image_id（auto-0…）隐藏。 */
export const projectAiHiddenAgreementImages = pgTable(
  "project_ai_hidden_agreement_images",
  {
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    imageId: text("image_id").notNull(),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "project_ai_hidden_agreement_images_pkey", columns: [table.projectId, table.kind, table.imageId] }),
    check("ck_project_ai_hidden_agreement_images_kind", sql`${table.kind} in ('layout', 'three_d')`),
    check("ck_project_ai_hidden_agreement_images_id", sql`${table.imageId} like 'auto-%'`),
  ],
);

export const projectAiManualImages = pgTable(
  "project_ai_manual_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    objectKey: text("object_key").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_project_ai_manual_images_order").on(table.projectId, table.kind, table.sortOrder),
    check("ck_project_ai_manual_images_kind", sql`${table.kind} in ('layout', 'three_d')`),
    check("ck_project_ai_manual_images_size", sql`${table.sizeBytes} >= 0`),
  ],
);
