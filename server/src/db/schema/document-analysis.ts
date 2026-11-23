import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { projects } from "./projects.js";
import { files, fileVersions } from "./files.js";

/** project_document_analysis_runs（0113）：项目级 AI 文件分析 run。 */
export const projectDocumentAnalysisRuns = pgTable(
  "project_document_analysis_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    promptVersion: text("prompt_version").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id),
    fileCount: integer("file_count").notNull().default(0),
    succeededCount: integer("succeeded_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ck_project_document_analysis_runs_status", sql`${table.status} in ('queued', 'running', 'succeeded', 'failed')`),
    check(
      "ck_project_document_analysis_runs_counts",
      sql`${table.fileCount} >= 0 and ${table.succeededCount} >= 0 and ${table.failedCount} >= 0 and ${table.skippedCount} >= 0`,
    ),
    index("ix_project_document_analysis_runs_status").on(table.status, table.createdAt),
    uniqueIndex("uq_project_document_analysis_runs_active")
      .on(table.projectId)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
);

/** project_file_analyses（0113）：按 file_version_id + prompt_version 缓存文件摘要。 */
export const projectFileAnalyses = pgTable(
  "project_file_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    fileVersionId: uuid("file_version_id").notNull().references(() => fileVersions.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    fileName: text("file_name").notNull(),
    fileKind: text("file_kind").notNull(),
    status: text("status").notNull().default("succeeded"),
    summaryJson: jsonb("summary_json").$type<Record<string, unknown> | null>(),
    modelId: text("model_id"),
    promptVersion: text("prompt_version").notNull(),
    error: text("error"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ck_project_file_analyses_kind", sql`${table.fileKind} in ('pdf', 'image', 'word', 'excel')`),
    check("ck_project_file_analyses_status", sql`${table.status} in ('succeeded', 'failed', 'skipped')`),
    unique("uq_project_file_analyses_version_prompt").on(table.fileVersionId, table.promptVersion),
    index("ix_project_file_analyses_project").on(table.projectId, table.generatedAt),
    index("ix_project_file_analyses_file").on(table.fileId, table.fileVersionId),
  ],
);
