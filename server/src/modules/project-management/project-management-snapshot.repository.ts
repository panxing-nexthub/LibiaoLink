import { Injectable } from "@nestjs/common";
import { and, inArray, isNull } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import { STAGE_KEYS } from "../../db/schema/literals.js";
import { projects } from "../../db/schema/projects.js";
import { tasks } from "../../db/schema/tasks.js";

/** 项目空间只读快照：项目管理记录按 code 精确匹配 projects.code 后派生展示，不写回任何项目表。 */
export type ProjectManagementProjectSnapshot = {
  projectId: string | null;
  currentStage: string | null;
  startupCompletedAt: string | null;
  arrivalDate: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  implementationDays: number | null;
};

export type ProjectManagementSnapshotProjectRow = {
  id: string;
  code: string;
};

export type ProjectManagementSnapshotTaskRow = {
  projectId: string;
  stageKey: string | null;
  title: string;
  titleEn: string | null;
  status: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualEnd: string | null;
};

export const EMPTY_PROJECT_MANAGEMENT_PROJECT_SNAPSHOT: ProjectManagementProjectSnapshot = Object.freeze({
  projectId: null,
  currentStage: null,
  startupCompletedAt: null,
  arrivalDate: null,
  plannedStartDate: null,
  plannedEndDate: null,
  implementationDays: null,
});

type SnapshotAccumulator = ProjectManagementProjectSnapshot & {
  startedStageKeys: Set<string>;
};

const STAGE_KEY_SET = new Set<string>(STAGE_KEYS);

/**
 * 由项目行与未删除任务行计算项目空间派生字段：
 * - 当前阶段 = 汇总卡「最新阶段」：已动工（active / done）任务里阶段序最靠后的阶段；
 * - 启动时间 = 「项目启动 / Project Startup」任务的实际完成日期（多条取最晚）；
 * - 到货日期 = 组装发货阶段任务的最晚实际完成日期；
 * - 计划实施开始 / 完成 = 硬件实施阶段任务的最早计划开始 / 最晚预计完成；
 * - 实施天数 = 两个计划日期的含首尾天数（与任务表「预计所需天数」同口径）。
 */
export function buildProjectManagementSnapshots(
  projectRows: readonly ProjectManagementSnapshotProjectRow[],
  taskRows: readonly ProjectManagementSnapshotTaskRow[],
): Map<string, ProjectManagementProjectSnapshot> {
  const byProjectId = new Map<string, SnapshotAccumulator>();
  for (const project of projectRows) {
    byProjectId.set(project.id, {
      ...EMPTY_PROJECT_MANAGEMENT_PROJECT_SNAPSHOT,
      startedStageKeys: new Set<string>(),
    });
  }

  for (const task of taskRows) {
    const snapshot = byProjectId.get(task.projectId);
    if (snapshot === undefined) {
      continue;
    }

    if (task.stageKey !== null && STAGE_KEY_SET.has(task.stageKey) && (task.status === "active" || task.status === "done")) {
      snapshot.startedStageKeys.add(task.stageKey);
    }

    if (isStartupTask(task.title, task.titleEn) && task.actualEnd !== null) {
      snapshot.startupCompletedAt = maxDate(snapshot.startupCompletedAt, task.actualEnd);
    }

    if (task.stageKey === "assembly" && task.actualEnd !== null) {
      snapshot.arrivalDate = maxDate(snapshot.arrivalDate, task.actualEnd);
    }

    if (task.stageKey === "install") {
      if (task.plannedStart !== null) {
        snapshot.plannedStartDate = minDate(snapshot.plannedStartDate, task.plannedStart);
      }
      if (task.plannedEnd !== null) {
        snapshot.plannedEndDate = maxDate(snapshot.plannedEndDate, task.plannedEnd);
      }
    }
  }

  const result = new Map<string, ProjectManagementProjectSnapshot>();
  for (const project of projectRows) {
    const snapshot = byProjectId.get(project.id);
    if (snapshot === undefined) {
      continue;
    }
    const currentStage = [...STAGE_KEYS].reverse().find((key) => snapshot.startedStageKeys.has(key)) ?? null;
    result.set(project.code, {
      projectId: project.id,
      currentStage,
      startupCompletedAt: snapshot.startupCompletedAt,
      arrivalDate: snapshot.arrivalDate,
      plannedStartDate: snapshot.plannedStartDate,
      plannedEndDate: snapshot.plannedEndDate,
      implementationDays:
        snapshot.plannedStartDate !== null && snapshot.plannedEndDate !== null
          ? daysBetweenInclusive(snapshot.plannedStartDate, snapshot.plannedEndDate)
          : null,
    });
  }
  return result;
}

/** 含首尾天数：2026-12-31 -> 2027-01-01 = 2。反向 / 非法日期返回 0（与任务表现行口径一致）。 */
export function daysBetweenInclusive(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso + "T00:00:00Z");
  const to = Date.parse(toIso + "T00:00:00Z");
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
    return 0;
  }
  return Math.round((to - from) / 86_400_000) + 1;
}

function isStartupTask(title: string, titleEn: string | null): boolean {
  const chineseTitle = title.trim();
  const englishTitle = (titleEn ?? "").trim().toLowerCase();
  return chineseTitle === "项目启动" || englishTitle === "project startup";
}

function maxDate(current: string | null, candidate: string): string {
  return current === null || candidate > current ? candidate : current;
}

function minDate(current: string | null, candidate: string): string {
  return current === null || candidate < current ? candidate : current;
}

/** 读面快照仓库：只读 projects / tasks，不经过项目 / 任务领域服务，不产生业务副作用。 */
@Injectable()
export class ProjectManagementSnapshotRepository {
  constructor(private readonly database: DatabaseService) {}

  async loadByCodes(codes: readonly string[]): Promise<Map<string, ProjectManagementProjectSnapshot>> {
    const normalizedCodes = Array.from(
      new Set(codes.map((code) => code.trim()).filter((code) => code !== "")),
    );
    if (normalizedCodes.length === 0) {
      return new Map<string, ProjectManagementProjectSnapshot>();
    }

    const projectRows = await this.database.db
      .select({ id: projects.id, code: projects.code })
      .from(projects)
      .where(and(inArray(projects.code, normalizedCodes), isNull(projects.deletedAt)));
    if (projectRows.length === 0) {
      return new Map<string, ProjectManagementProjectSnapshot>();
    }

    const taskRows = await this.database.db
      .select({
        projectId: tasks.projectId,
        stageKey: tasks.stageKey,
        title: tasks.title,
        titleEn: tasks.titleEn,
        status: tasks.status,
        plannedStart: tasks.plannedStart,
        plannedEnd: tasks.plannedEnd,
        actualEnd: tasks.actualEnd,
      })
      .from(tasks)
      .where(and(inArray(tasks.projectId, projectRows.map((project) => project.id)), isNull(tasks.deletedAt)));

    return buildProjectManagementSnapshots(projectRows, taskRows);
  }
}
