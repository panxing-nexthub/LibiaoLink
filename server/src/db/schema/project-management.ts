import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { PROJECT_MANAGEMENT_METHOD_KEYS, sqlValueList } from "./literals.js";

const QUOTE = String.fromCharCode(39);
const EMPTY_UUID_ARRAY = sql.raw(QUOTE + "{}" + QUOTE + "::uuid[]");

/**
 * project_management_records（0102 · 2026-11-17）：项目管理页独立准备记录。
 * 与 projects 无外键、无写入联动；编号 / 名称允许空串，支持表格逐格写入即保存。
 * current_stage / arrival_date / planned_start_date / planned_end_date / implementation_days
 * 为 0102 预留列；2026-11-17 起页面派生值改由 projects / tasks 只读实时查询，不再读写这些列。
 */
export const projectManagementRecords = pgTable(
  "project_management_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().default(""),
    name: text("name").notNull().default(""),
    managerIds: uuid("manager_ids").array().notNull().default(EMPTY_UUID_ARRAY),
    implementationEngineerIds: uuid("implementation_engineer_ids").array().notNull().default(EMPTY_UUID_ARRAY),
    implementationHandedOver: boolean("implementation_handed_over").notNull().default(false),
    implementationMethod: text("implementation_method"),
    riskReminder: text("risk_reminder"),
    region: text("region").notNull().default("未分类"),
    currentStageOverride: text("current_stage_override"),
    startupCompletedAtOverride: date("startup_completed_at_override"),
    arrivalDateOverride: date("arrival_date_override"),
    plannedStartDateOverride: date("planned_start_date_override"),
    plannedEndDateOverride: date("planned_end_date_override"),
    implementationDaysOverride: integer("implementation_days_override"),
    currentStage: text("current_stage"),
    arrivalDate: date("arrival_date"),
    plannedStartDate: date("planned_start_date"),
    plannedEndDate: date("planned_end_date"),
    implementationDays: integer("implementation_days"),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ix_project_management_records_created").on(table.createdAt, table.id),
    check("ck_project_management_records_code_length", sql`char_length(${table.code}) <= 50`),
    check("ck_project_management_records_name_length", sql`char_length(${table.name}) <= 200`),
    check("ck_project_management_records_manager_ids_limit", sql`cardinality(${table.managerIds}) <= 200`),
    check("ck_project_management_records_manager_ids_no_null", sql`array_position(${table.managerIds}, null::uuid) is null`),
    check("ck_project_management_records_engineer_ids_limit", sql`cardinality(${table.implementationEngineerIds}) <= 50`),
    check("ck_project_management_records_engineer_ids_no_null", sql`array_position(${table.implementationEngineerIds}, null::uuid) is null`),
    check(
      "ck_project_management_records_method",
      sql`${table.implementationMethod} is null or ${table.implementationMethod} in ${sql.raw(sqlValueList(PROJECT_MANAGEMENT_METHOD_KEYS))}`,
    ),
    check("ck_project_management_records_risk_length", sql`${table.riskReminder} is null or char_length(${table.riskReminder}) <= 2000`),
    check("ck_project_management_records_region_length", sql`char_length(${table.region}) <= 80`),
    check("ck_project_management_records_stage_length", sql`${table.currentStage} is null or char_length(${table.currentStage}) <= 120`),
    check("ck_project_management_records_stage_override_length", sql`${table.currentStageOverride} is null or char_length(${table.currentStageOverride}) <= 120`),
    check("ck_project_management_records_days", sql`${table.implementationDays} is null or ${table.implementationDays} >= 0`),
    check("ck_project_management_records_days_override", sql`${table.implementationDaysOverride} is null or ${table.implementationDaysOverride} >= 0`),
    check("ck_project_management_records_version", sql`${table.version} >= 0`),
  ],
);

export type ProjectManagementRecordRow = typeof projectManagementRecords.$inferSelect;
export type ProjectManagementRecordInsert = typeof projectManagementRecords.$inferInsert;
