import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbClient, DbTransaction } from "../../db/db-client.js";
import { users } from "../../db/schema/identity.js";
import {
  projectManagementRecords,
  type ProjectManagementRecordInsert,
  type ProjectManagementRecordRow,
} from "../../db/schema/project-management.js";

export type ProjectManagementRecordPatch = Partial<
  Pick<
    ProjectManagementRecordInsert,
    | "code"
    | "name"
    | "managerIds"
    | "implementationEngineerIds"
    | "implementationHandedOver"
    | "implementationMethod"
    | "riskReminder"
    | "region"
    | "currentStageOverride"
    | "startupCompletedAtOverride"
    | "arrivalDateOverride"
    | "plannedStartDateOverride"
    | "plannedEndDateOverride"
    | "implementationDaysOverride"
  >
>;

export type ProjectManagementBlankFields = {
  code: string;
  name: string;
  managerIds: readonly string[];
  implementationEngineerIds: readonly string[];
  implementationHandedOver: boolean;
  implementationMethod: string | null;
  riskReminder: string | null;
  region: string;
  currentStageOverride: string | null;
  startupCompletedAtOverride: string | null;
  arrivalDateOverride: string | null;
  plannedStartDateOverride: string | null;
  plannedEndDateOverride: string | null;
  implementationDaysOverride: number | null;
};

/** 全空记录 = 用户在表格里输入后又清空；创建拒绝、列表隐藏，不进入项目空间。 */
export function isBlankProjectManagementFields(fields: ProjectManagementBlankFields): boolean {
  return (
    fields.code.trim() === "" &&
    fields.name.trim() === "" &&
    fields.managerIds.length === 0 &&
    fields.implementationEngineerIds.length === 0 &&
    !fields.implementationHandedOver &&
    fields.implementationMethod === null &&
    (fields.riskReminder === null || fields.riskReminder.trim() === "") &&
    (fields.region.trim() === "" || fields.region.trim() === "未分类") &&
    fields.currentStageOverride === null &&
    fields.startupCompletedAtOverride === null &&
    fields.arrivalDateOverride === null &&
    fields.plannedStartDateOverride === null &&
    fields.plannedEndDateOverride === null &&
    fields.implementationDaysOverride === null
  );
}

export interface ProjectManagementUserSnapshot {
  userId: string;
  username: string;
  displayName: string;
  status: string;
  removedAt: Date | null;
}

/** 项目管理独立记录的数据访问：只碰 project_management_records 与 users，不访问 projects。 */
@Injectable()
export class ProjectManagementRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(client: DbClient = this.database.db): Promise<ProjectManagementRecordRow[]> {
    const rows = await client
      .select()
      .from(projectManagementRecords)
      .orderBy(asc(projectManagementRecords.sortOrder), asc(projectManagementRecords.createdAt), asc(projectManagementRecords.id));
    return rows.filter((row) => !isBlankProjectManagementFields(row));
  }

  async lockOrder(client: DbTransaction): Promise<void> {
    // Serialize ordering against other placements and against ordinary inserts, updates and deletes.
    await client.execute(sql`lock table ${projectManagementRecords} in share row exclusive mode`);
  }

  async writeOrder(ids: readonly string[], client: DbTransaction): Promise<void> {
    await client.execute(sql`
      update ${projectManagementRecords} as record
      set sort_order = placement.position
      from unnest(${sql.param(ids)}::uuid[]) with ordinality as placement(id, position)
      where record.id = placement.id and record.sort_order is distinct from placement.position
    `);
  }

  async findById(id: string): Promise<ProjectManagementRecordRow | null> {
    const rows = await this.database.db
      .select()
      .from(projectManagementRecords)
      .where(eq(projectManagementRecords.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async insert(values: ProjectManagementRecordInsert, at: Date, client: DbClient = this.database.db): Promise<ProjectManagementRecordRow> {
    const rows = await client
      .insert(projectManagementRecords)
      .values({ ...values, createdAt: at, updatedAt: at })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("project_management_records insert 未返回记录");
    }
    return row;
  }

  async updateIfVersion(
    id: string,
    version: number,
    patch: ProjectManagementRecordPatch,
    at: Date,
    client: DbClient = this.database.db,
  ): Promise<ProjectManagementRecordRow | null> {
    const rows = await client
      .update(projectManagementRecords)
      .set({
        ...patch,
        updatedAt: at,
        version: sql`${projectManagementRecords.version} + 1`,
      })
      .where(and(eq(projectManagementRecords.id, id), eq(projectManagementRecords.version, version)))
      .returning();
    return rows[0] ?? null;
  }

  async deleteIfVersion(id: string, version: number, client: DbClient = this.database.db): Promise<string | null> {
    const rows = await client
      .delete(projectManagementRecords)
      .where(and(eq(projectManagementRecords.id, id), eq(projectManagementRecords.version, version)))
      .returning({ id: projectManagementRecords.id });
    return rows[0]?.id ?? null;
  }

  /** 姓名解析包含已停用 / 已移除账号：记录保留历史姓名展示。 */
  async listUsersByIds(ids: readonly string[]): Promise<ProjectManagementUserSnapshot[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.database.db
      .select({
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        status: users.status,
        removedAt: users.removedAt,
      })
      .from(users)
      .where(inArray(users.id, Array.from(new Set(ids))));
    return rows;
  }

}
