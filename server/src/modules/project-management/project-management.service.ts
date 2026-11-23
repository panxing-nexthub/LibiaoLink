import { Injectable } from "@nestjs/common";
import {
  type ProjectManagementRecord,
  type ProjectManagementRecordCreateBody,
  type ProjectManagementRecordList,
  type ProjectManagementRecordUpdateBody,
  type ProjectManagementRecordDeleteResponse,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import type { AuditChangeEntry } from "../../db/schema/admin.js";
import type { ProjectManagementRecordRow } from "../../db/schema/project-management.js";
import { DatabaseService } from "../../db/database.service.js";
import { AuditService } from "../audit/index.js";
import { ProjectManagerEligibilityService } from "../permission/index.js";
import {
  isBlankProjectManagementFields,
  ProjectManagementRepository,
  type ProjectManagementRecordPatch,
  type ProjectManagementUserSnapshot,
} from "./project-management.repository.js";
import {
  EMPTY_PROJECT_MANAGEMENT_PROJECT_SNAPSHOT,
  ProjectManagementSnapshotRepository,
  type ProjectManagementProjectSnapshot,
} from "./project-management-snapshot.repository.js";

const DEFAULT_REGION = "未分类";

/**
 * 项目管理接口：独立准备记录，不调用 ProjectService / ProjectRepository，
 * 也不写 projects / project_members / 工作台。读取时按 code 只读关联项目空间，
 * 派生当前阶段与实施日期；项目经理资格校验复用现有名单，实施工程师校验启用账号目录。
 */
@Injectable()
export class ProjectManagementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly records: ProjectManagementRepository,
    private readonly managerEligibility: ProjectManagerEligibilityService,
    private readonly projectSnapshots: ProjectManagementSnapshotRepository,
    private readonly audits: AuditService,
  ) {}

  async list(): Promise<ProjectManagementRecordList> {
    const rows = await this.records.list();
    const [names, snapshots] = await Promise.all([
      this.namesOf(rows.flatMap((row) => [...row.managerIds, ...row.implementationEngineerIds])),
      this.projectSnapshots.loadByCodes(rows.map((row) => row.code)),
    ]);
    return { items: rows.map((row) => this.toContract(row, names, snapshotOf(snapshots, row.code))) };
  }

  async create(body: ProjectManagementRecordCreateBody, actorId: string | null = null): Promise<ProjectManagementRecord> {
    const managerIds = uniqueIds(body.managerIds ?? []);
    const implementationHandedOver = body.implementationHandedOver ?? false;
    const implementationEngineerIds = implementationHandedOver ? [] : uniqueIds(body.implementationEngineerIds ?? []);
    if (managerIds.length > 0) {
      await this.managerEligibility.assertAssignable(managerIds);
    }
    await this.assertEngineersActive(implementationEngineerIds);

    const values = {
      code: normalizeText(body.code ?? ""),
      name: normalizeText(body.name ?? ""),
      managerIds,
      implementationEngineerIds,
      implementationHandedOver,
      implementationMethod: body.implementationMethod ?? null,
      riskReminder: normalizeOptionalText(body.riskReminder),
      region: normalizeRegion(body.region),
      currentStageOverride: body.currentStageOverride ?? null,
      startupCompletedAtOverride: body.startupCompletedAtOverride ?? null,
      arrivalDateOverride: body.arrivalDateOverride ?? null,
      plannedStartDateOverride: body.plannedStartDateOverride ?? null,
      plannedEndDateOverride: body.plannedEndDateOverride ?? null,
      implementationDaysOverride: body.implementationDaysOverride ?? null,
    };
    if (isBlankProjectManagementFields(values)) {
      throw new AppError("VALIDATION_FAILED", "空记录不创建；请至少填写一项项目准备信息");
    }

    const at = new Date();
    const row = await this.database.db.transaction(async (tx) => {
      const inserted = await this.records.insert(values, at, tx);
      await this.audits.record(tx, {
        actorId,
        action: "create",
        objectType: "project_management_record",
        objectId: inserted.id,
        projectCode: auditProjectCodeOf(inserted),
        projectName: auditProjectNameOf(inserted),
        summary: "新建项目管理记录" + auditRecordSuffix(inserted),
        changes: null,
        metadata: { source: "project_management", versionAfter: inserted.version },
      });
      return inserted;
    });
    const [names, snapshots] = await Promise.all([
      this.namesOf([...managerIds, ...implementationEngineerIds]),
      this.projectSnapshots.loadByCodes([row.code]),
    ]);
    return this.toContract(row, names, snapshotOf(snapshots, row.code));
  }

  async update(id: string, body: ProjectManagementRecordUpdateBody, actorId: string | null = null): Promise<ProjectManagementRecord> {
    const current = await this.records.findById(id);
    if (current === null) {
      throw new AppError("NOT_FOUND", "项目管理记录不存在：" + id);
    }

    const patch: ProjectManagementRecordPatch = {};
    if (body.code !== undefined) patch.code = normalizeText(body.code);
    if (body.name !== undefined) patch.name = normalizeText(body.name);
    if (body.region !== undefined) patch.region = normalizeRegion(body.region);
    if (body.implementationMethod !== undefined) patch.implementationMethod = body.implementationMethod;
    if (body.riskReminder !== undefined) patch.riskReminder = normalizeOptionalText(body.riskReminder);

    if (body.managerIds !== undefined) {
      const next = uniqueIds(body.managerIds);
      if (!sameIds(current.managerIds, next)) {
        await this.managerEligibility.assertAssignable(next, { existingUserIds: current.managerIds });
      }
      patch.managerIds = next;
    }
    const nextEngineerIds =
      body.implementationHandedOver === true
        ? []
        : body.implementationEngineerIds !== undefined
          ? uniqueIds(body.implementationEngineerIds)
          : current.implementationEngineerIds;
    const nextHandedOver =
      body.implementationHandedOver === true
        ? true
        : body.implementationEngineerIds !== undefined && nextEngineerIds.length > 0
          ? false
          : body.implementationHandedOver ?? current.implementationHandedOver;
    if (body.implementationEngineerIds !== undefined || body.implementationHandedOver !== undefined) {
      if (!sameIds(current.implementationEngineerIds, nextEngineerIds)) {
        await this.assertEngineersActive(nextEngineerIds);
      }
      patch.implementationEngineerIds = nextEngineerIds;
      patch.implementationHandedOver = nextHandedOver;
    }
    if (body.currentStageOverride !== undefined) patch.currentStageOverride = body.currentStageOverride;
    if (body.startupCompletedAtOverride !== undefined) patch.startupCompletedAtOverride = body.startupCompletedAtOverride;
    if (body.arrivalDateOverride !== undefined) patch.arrivalDateOverride = body.arrivalDateOverride;
    if (body.plannedStartDateOverride !== undefined) patch.plannedStartDateOverride = body.plannedStartDateOverride;
    if (body.plannedEndDateOverride !== undefined) patch.plannedEndDateOverride = body.plannedEndDateOverride;
    if (body.implementationDaysOverride !== undefined) patch.implementationDaysOverride = body.implementationDaysOverride;

    if (isBlankProjectManagementFields({ ...current, ...patch })) {
      throw new AppError("VALIDATION_FAILED", "清空后的空记录请使用 DELETE 删除，不能保存为空记录");
    }

    const auditNames = await this.namesOf(
      uniqueIds([
        ...current.managerIds,
        ...current.implementationEngineerIds,
        ...(patch.managerIds ?? []),
        ...(patch.implementationEngineerIds ?? []),
      ]),
    );
    const beforeAudit = auditSnapshotOf(current, auditNames);
    const at = new Date();
    const row = await this.database.db.transaction(async (tx) => {
      const updated = await this.records.updateIfVersion(id, body.version, patch, at, tx);
      if (updated === null) {
        return null;
      }
      const changes = auditChangesOf(beforeAudit, auditSnapshotOf(updated, auditNames));
      if (changes.length > 0) {
        await this.audits.record(tx, {
          actorId,
          action: "update",
          objectType: "project_management_record",
          objectId: updated.id,
          projectCode: auditProjectCodeOf(updated),
          projectName: auditProjectNameOf(updated),
          summary: "修改项目管理记录" + auditRecordSuffix(updated),
          changes,
          metadata: {
            source: "project_management",
            versionBefore: current.version,
            versionAfter: updated.version,
          },
        });
      }
      return updated;
    });
    if (row === null) {
      throw new AppError("VERSION_CONFLICT", "记录已被其他账号更新，请刷新后重试");
    }
    const [names, snapshots] = await Promise.all([
      this.namesOf([...row.managerIds, ...row.implementationEngineerIds]),
      this.projectSnapshots.loadByCodes([row.code]),
    ]);
    return this.toContract(row, names, snapshotOf(snapshots, row.code));
  }

  async remove(id: string, version: number, actorId: string | null = null): Promise<ProjectManagementRecordDeleteResponse> {
    const current = await this.records.findById(id);
    if (current === null) {
      throw new AppError("NOT_FOUND", "项目管理记录不存在：" + id);
    }
    const deleted = await this.database.db.transaction(async (tx) => {
      const deletedId = await this.records.deleteIfVersion(id, version, tx);
      if (deletedId === null) {
        return null;
      }
      await this.audits.record(tx, {
        actorId,
        action: "delete",
        objectType: "project_management_record",
        objectId: current.id,
        projectCode: auditProjectCodeOf(current),
        projectName: auditProjectNameOf(current),
        summary: "删除项目管理记录" + auditRecordSuffix(current),
        changes: null,
        metadata: { source: "project_management", versionBefore: current.version },
      });
      return deletedId;
    });
    if (deleted !== null) {
      return { id: deleted, deleted: true };
    }
    throw new AppError("VERSION_CONFLICT", "记录已被其他账号更新，请刷新后重试");
  }

  private async assertEngineersActive(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const active = await this.records.listActiveUsersByIds(ids);
    const activeIds = new Set(active.map((user) => user.userId));
    const invalid = ids.filter((userId) => !activeIds.has(userId));
    if (invalid.length === 0) return;
    throw new AppError("VALIDATION_FAILED", "实施工程师只能选择启用账号；不符合条件：" + invalid.join("、"), [
      {
        code: "IMPLEMENTATION_ENGINEER_INACTIVE",
        message: "实施工程师只能选择启用账号",
        path: "implementationEngineerIds",
        meta: { userIds: invalid },
      },
    ]);
  }

  private async namesOf(ids: readonly string[]): Promise<Map<string, string>> {
    const users = await this.records.listUsersByIds(uniqueIds(ids));
    return new Map(users.map((user) => [user.userId, user.displayName]));
  }

  private toContract(
    row: ProjectManagementRecordRow,
    names: ReadonlyMap<string, string>,
    snapshot: ProjectManagementProjectSnapshot,
  ): ProjectManagementRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      projectId: snapshot.projectId,
      managerIds: row.managerIds,
      managerNames: row.managerIds.map((id) => names.get(id) ?? null),
      implementationEngineerIds: row.implementationEngineerIds,
      implementationEngineerNames: row.implementationEngineerIds.map((id) => names.get(id) ?? null),
      implementationHandedOver: row.implementationHandedOver,
      implementationMethod: row.implementationMethod as ProjectManagementRecord["implementationMethod"],
      riskReminder: row.riskReminder,
      region: row.region,
      currentStageOverride: row.currentStageOverride as ProjectManagementRecord["currentStageOverride"],
      startupCompletedAtOverride: row.startupCompletedAtOverride,
      arrivalDateOverride: row.arrivalDateOverride,
      plannedStartDateOverride: row.plannedStartDateOverride,
      plannedEndDateOverride: row.plannedEndDateOverride,
      implementationDaysOverride: row.implementationDaysOverride,
      currentStage: snapshot.currentStage as ProjectManagementRecord["currentStage"],
      startupCompletedAt: snapshot.startupCompletedAt,
      arrivalDate: snapshot.arrivalDate,
      plannedStartDate: snapshot.plannedStartDate,
      plannedEndDate: snapshot.plannedEndDate,
      implementationDays: snapshot.implementationDays,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value.trim() === "" ? null : value;
}

function normalizeRegion(value: string | undefined): string {
  const region = value?.trim() ?? "";
  return region === "" ? DEFAULT_REGION : region;
}

function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

function snapshotOf(
  snapshots: ReadonlyMap<string, ProjectManagementProjectSnapshot>,
  code: string,
): ProjectManagementProjectSnapshot {
  return snapshots.get(code.trim()) ?? EMPTY_PROJECT_MANAGEMENT_PROJECT_SNAPSHOT;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

const auditProjectCodeOf = (row: ProjectManagementRecordRow): string | null =>
  row.code.trim() === "" ? null : row.code.trim();

const auditProjectNameOf = (row: ProjectManagementRecordRow): string | null =>
  row.name.trim() === "" ? null : row.name.trim();

const auditRecordSuffix = (row: ProjectManagementRecordRow): string => {
  const parts = [row.code.trim(), row.name.trim()].filter((part) => part !== "");
  return parts.length === 0 ? "" : "「" + parts.join(" / ") + "」";
};

const auditSnapshotOf = (
  row: ProjectManagementRecordRow,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> => ({
  code: row.code,
  name: row.name,
  managerIds: row.managerIds.map((id) => names.get(id) ?? id),
  implementationEngineerIds: row.implementationEngineerIds.map((id) => names.get(id) ?? id),
  implementationHandedOver: row.implementationHandedOver,
  implementationMethod: row.implementationMethod,
  riskReminder: row.riskReminder,
  region: row.region,
  currentStageOverride: row.currentStageOverride,
  startupCompletedAtOverride: row.startupCompletedAtOverride,
  arrivalDateOverride: row.arrivalDateOverride,
  plannedStartDateOverride: row.plannedStartDateOverride,
  plannedEndDateOverride: row.plannedEndDateOverride,
  implementationDaysOverride: row.implementationDaysOverride,
});

const auditChangesOf = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditChangeEntry[] => {
  const changes: AuditChangeEntry[] = [];
  for (const field of Object.keys(before)) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      changes.push({ field, from: before[field], to: after[field] });
    }
  }
  return changes;
};

export type { ProjectManagementUserSnapshot };
