import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
