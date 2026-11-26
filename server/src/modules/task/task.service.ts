import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  DOC_TYPES,
  DateOnlySchema,
  DeliverableTypeSchema,
  PRIORITY_VALUES,
  STAGE_KEYS,
  STAGE_NAMES,
  ProjectSummarySchema,
  TaskBatchBodySchema,
  TaskBatchFailureSchema,
  TaskBatchResponseSchema,
  TaskCanCompleteResponseSchema,
  TaskCompleteBodySchema,
  TaskCompleteResponseSchema,
  TaskCreateBodySchema,
  TaskCreateFromTemplateBodySchema,
  TaskCreateFromTemplateResponseSchema,
  TaskDeleteResponseSchema,
  TaskDetailSchema,
  TaskFinalizeBodySchema,
  TaskUnfinalizeBodySchema,
  TaskGateMissingSchema,
  TaskGateWarningSchema,
  TaskListItemSchema,
  TaskListResponseSchema,
  TaskLockedFieldsAdjustBodySchema,
  TaskProgressSchema,
  TaskProgressUpdateBodySchema,
  TaskSchema,
  TaskUpdateBodySchema,
  z,
  type AdditionalProjectStage,
  type StageKey,
  type ErrorDetail,
  type TaskCapabilities,
} from "@libiaolink/contracts";
import type { OutboxTopic } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import type { DbClient } from "../../db/db-client.js";
import { DatabaseService } from "../../db/database.service.js";
import { appendOutbox, appendOutboxIfAbsent } from "../../db/outbox.js";
import { hasUnfinishedTemporaryTask, isTemporaryTask } from "../../db/task-scope.js";
import { AuditService, diffRecords } from "../admin/index.js";
import { addDays } from "../calendar/index.js";
import { PermissionService, ProjectManagerEligibilityService, projectManagerIdsChanged, taskCapabilitiesOf, type ProjectAccessContext } from "../permission/index.js";
import { TaskNodeRepository, TemplateService } from "../template/index.js";
import { clampSortIndex } from "./task.order.js";
import { parseTaskListFilter, parseTaskSort, type TaskListQueryInput } from "./task.query.js";
import {
  applyProgressWrite,
  applyStatusWrite,
  deriveDisplayStatus,
  deriveOnTime,
  isUnfinalizeLockedByPlannedEnd,
  shanghaiToday,
} from "./task.rules.js";
import {
  TaskRepository,
  type TaskChangeLinkRow,
  type TaskCompletionTargetRow,
  type TaskEventInput,
  type TaskFileSummaryCounts,
  type TaskListRow,
  type TaskProjectRow,
  type TaskRow,
  type TaskUpdatePatch,
} from "./task.repository.js";
import {
  TaskGateRepository,
  mergeDeliveryRequirements,
  missingDeliveryRequirements,
  type TaskGateDocCountRow,
} from "./task.gate.repository.js";

type Task = z.infer<typeof TaskSchema>;
type TaskDetail = z.infer<typeof TaskDetailSchema>;
type TaskFinalizeBody = z.infer<typeof TaskFinalizeBodySchema>;
type TaskUnfinalizeBody = z.infer<typeof TaskUnfinalizeBodySchema>;
type TaskListItem = z.infer<typeof TaskListItemSchema>;
type TaskListResponse = z.infer<typeof TaskListResponseSchema>;
type TaskCreateBody = z.infer<typeof TaskCreateBodySchema>;

/** 任务模板板块里只有九阶段可实例化为项目任务；入库审核等特殊分组只用于模板库。 */
function isProjectStageKey(value: string): boolean {
  return (STAGE_KEYS as readonly string[]).includes(value);
}
type TaskUpdateBody = z.infer<typeof TaskUpdateBodySchema>;
type TaskProgressUpdateBody = z.infer<typeof TaskProgressUpdateBodySchema>;
type TaskProgress = z.infer<typeof TaskProgressSchema>;
type TaskCompleteBody = z.infer<typeof TaskCompleteBodySchema>;
type TaskCompleteResponse = z.infer<typeof TaskCompleteResponseSchema>;
type TaskCanCompleteResponse = z.infer<typeof TaskCanCompleteResponseSchema>;
type TaskGateMissing = z.infer<typeof TaskGateMissingSchema>;
type TaskGateWarning = z.infer<typeof TaskGateWarningSchema>;
type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
type TaskBatchBody = z.infer<typeof TaskBatchBodySchema>;
type TaskCreateFromTemplateBody = z.infer<typeof TaskCreateFromTemplateBodySchema>;
type TaskCreateFromTemplateResponse = z.infer<typeof TaskCreateFromTemplateResponseSchema>;
type TaskBatchFailure = z.infer<typeof TaskBatchFailureSchema>;
type TaskBatchResponse = z.infer<typeof TaskBatchResponseSchema>;
type TaskDeleteResponse = z.infer<typeof TaskDeleteResponseSchema>;
type TaskLockedFieldsAdjustBody = z.infer<typeof TaskLockedFieldsAdjustBodySchema>;

/**
 * 单条写入内核的输入（编辑 / 批量共用）：expectedVersion = null 表示批量语义（按当前行覆盖，不做逐行乐观锁）；
 * sortIndex 仅单条编辑使用（批量白名单不含顺序调整 —— 顺序调整是「插入位置」的逐条语义）。
 */
type TaskWriteRequest = Pick<
  TaskUpdateBody,
  "title" | "titleEn" | "ownerIds" | "managerIds" | "status" | "plannedStart" | "plannedEnd" | "estimatedDays" | "headcount" | "priority" | "deliverableTypes" | "note" | "sortIndex" | "shiftFollowing" | "shiftTaskIds"
> & { expectedVersion: number | null };

const EMPTY_FILE_SUMMARY: TaskFileSummaryCounts = { total: 0, draft: 0, final: 0 };
/** 群消息里的姓名清单：缺失用户跳过；无可展示姓名时回退指定文案。 */
function groupNames(names: readonly (string | null)[] | null | undefined, fallback: string): string {
  const text = (names ?? [])
    .filter((name): name is string => name !== null && name.trim() !== "")
    .join("、");
  return text === "" ? fallback : text;
}

const CHANGE_SUMMARY_MAX = 40;

/** 门禁拒绝的内部信号（事务回滚后补写留痕，再转 422 契约错误）—— 与 FlowService 同模式。 */
class GateRejectedSignal extends Error {
  constructor(
    readonly appError: AppError,
    readonly outbox: { topic: OutboxTopic; dedupeKey: string; payload: Record<string, unknown> },
  ) {
    super("gate_rejected");
  }
}

/**
 * 任务用例（h4 · S6·task：M3-01 列表 / 详情 + M3-02 进度与状态 + 项目总览四格）。
 * 五态派生与按时交付读时计算（A1-06 / A14），状态与进度写入在同一事务内联动（A12 / A13），字段级留痕写 task_events（A1-10）。
 * 权限（h6 前口径）：读登录即可；任务编辑 / 进度为成员平权；手工创建非标准任务仅管理员（系统功能书 A1-13）；
 * 归档项目写保护 409 PROJECT_ARCHIVED（ADR-027）；任务变更写项目触点（ADR-022 ④）。
 */
@Injectable()
export class TaskService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: TaskRepository,
    private readonly gate: TaskGateRepository,
    private readonly permission: PermissionService,
    private readonly audit: AuditService,
    private readonly nodes: TaskNodeRepository,
    private readonly templates: TemplateService,
    private readonly managerEligibility: ProjectManagerEligibilityService,
  ) {}

  /**
   * GET /projects/{id}/summary：汇总卡（最慢阶段 / 最新阶段 / 逾期 / 已完成 / 总数）。
   * 2026-09-24 定案：`currentStage`（= projects.stage_key）下线，改两个任务派生阶段字段 ——
   * 最慢 = 按九阶段顺序第一个「存在未完成任务」的阶段；最新 = 已动工任务（基础态 active / done，即进度 ≥ 1 格）里阶段序最靠后者；
   * 「未分组」任务（stage_key 为空）不是阶段，只进三个计数。
   */
  async summary(projectId: string): Promise<ProjectSummary> {
    const project = await this.loadProjectOrFail(projectId);
    const today = shanghaiToday(new Date());
    const counts = await this.repository.summaryCounts(projectId, today);
    const perStage = await this.repository.taskCountsByStage(this.database.db, projectId);
    const unfinished = new Set<string>();
    const started = new Set<string>();
    for (const row of perStage) {
      if (row.stageKey === null) continue;
      if (row.status === "done") {
        started.add(row.stageKey);
      } else {
        unfinished.add(row.stageKey);
        if (row.status === "active") started.add(row.stageKey);
      }
    }
    const slowestStage = STAGE_KEYS.find((key) => unfinished.has(key)) ?? null;
    const latestStage = [...STAGE_KEYS].reverse().find((key) => started.has(key)) ?? null;
    return {
      projectId,
      additionalStages: await this.repository.listAdditionalStages(projectId),
      slowestStage,
      latestStage,
      overdue: counts.overdue,
      done: counts.done,
      total: counts.total,
      ...(project.status === "archived" ? {
        hasUnfinishedTemporaryTask: await hasUnfinishedTemporaryTask(this.database.db, projectId),
      } : {}),
    };
  }

  async createAdditionalStage(projectId: string, stageKey: StageKey, actorId: string): Promise<AdditionalProjectStage> {
    return this.database.db.transaction(async (tx) => {
      const project = await this.loadProjectForWrite(projectId, false, tx);
      await this.permission.assertCanManageProjectManagers(actorId, project, tx, "新增阶段");
      const stage = await this.repository.insertAdditionalStage(tx, projectId, stageKey);
      await this.repository.touchProject(projectId, new Date(), tx);
      await this.audit.record(tx, {
        actorId, projectId, action: "create", objectType: "stage", objectId: stage.id,
        summary: "新增阶段：" + STAGE_NAMES[stage.stageKey] + stage.number,
      });
      return stage;
    });
  }

  async removeAdditionalStage(projectId: string, stageId: string, actorId: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const stage = await this.requireAdditionalStage(tx, projectId, stageId);
      // 阶段行锁阻止并发添加；与重排一致，先锁本组任务，再锁项目。
      const group = await this.repository.lockStageTasks(tx, projectId, stage.stageKey, stage.number);
      const project = await this.loadProjectForWrite(projectId, false, tx);
      await this.permission.assertCanManageProjectManagers(actorId, project, tx, "删除阶段");
      const at = new Date();
      for (const task of group) await this.assertTaskDeletable(tx, task);
      for (const task of group) await this.softDeleteTask(tx, task, actorId, at, stage.id);
      await this.repository.removeAdditionalStage(tx, stage.id, at);
      await this.repository.touchProject(projectId, at, tx);
      await this.audit.record(tx, {
        actorId, projectId, action: "delete", objectType: "stage", objectId: stage.id,
        summary: "删除阶段：" + STAGE_NAMES[stage.stageKey] + stage.number,
      });
    });
  }

  private async requireAdditionalStage(tx: DbClient, projectId: string, stageId: string): Promise<AdditionalProjectStage> {
    const stage = await this.repository.lockAdditionalStage(tx, projectId, stageId);
    if (stage === null) throw new AppError("NOT_FOUND", "新增阶段不存在");
    return stage;
  }

  /** GET /projects/{id}/tasks：分页 + 阶段 / 负责人 / 展示态筛选 + 关键字 + 白名单排序；items 为 TaskListItem。 */
  async list(projectId: string, query: TaskListQueryInput, actorId?: string): Promise<TaskListResponse> {
    await this.loadProjectOrFail(projectId);
    const access = actorId === undefined ? null : await this.permission.assertProjectVisible(actorId, projectId);
    const filter = parseTaskListFilter(query);
    const sorts = parseTaskSort(query.sort);
    const today = shanghaiToday(new Date());
    const offset = (query.page - 1) * query.limit;
    const { items, total } = await this.repository.listPage(projectId, filter, sorts, query.limit, offset, today);
    const summaries = await this.repository.fileSummaries(items.map((row) => row.task.id));
    const ownedTaskIds = actorId === undefined ? [] : items.filter((row) => row.task.ownerIds.includes(actorId)).map((row) => row.task.id);
    const createdByActor = ownedTaskIds.length === 0 ? new Set<string>() : await this.repository.taskIdsCreatedBy(projectId, ownedTaskIds, actorId!);
    return {
      items: items.map((row) => {
        const item = toListItem(row, summaries.get(row.task.id) ?? EMPTY_FILE_SUMMARY, today);
        if (actorId === undefined) return item;
        const capabilities = taskCapabilitiesOf(actorId, access, row.task.ownerIds);
        return { ...item, capabilities: capabilities.source === "task_owner" ? { ...capabilities, canDelete: createdByActor.has(row.task.id) } : capabilities };
      }),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  /** 项目导出专用总数：只查任务总数，不加载任务行或附件摘要。 */
  async countForExport(projectId: string): Promise<number> {
    await this.loadProjectOrFail(projectId);
    const today = shanghaiToday(new Date());
    return this.repository.countForExport(projectId, parseTaskListFilter({ page: 1, limit: 1 }), today);
  }

  /**
   * 项目导出专用行读取：保持公共列表的筛选 / 排序与字段口径，但不查 total、不补附件摘要。
   * 导出的「文件」列来自项目文件清单，不依赖列表 fileSummary。
   */
  async listForExport(
    projectId: string,
    query: Pick<TaskListQueryInput, "page" | "limit">,
  ): Promise<TaskListItem[]> {
    await this.loadProjectOrFail(projectId);
    const filter = parseTaskListFilter(query);
    const sorts = parseTaskSort(undefined);
    const today = shanghaiToday(new Date());
    const offset = (query.page - 1) * query.limit;
    const rows = await this.repository.listPageForExport(projectId, filter, sorts, query.limit, offset, today);
    return rows.map((row) => toListItem(row, EMPTY_FILE_SUMMARY, today));
  }

  /** GET /projects/{id}/tasks/{taskId}：抽屉全字段 + 文件清单（A7：列表不再补第二次请求）。 */
  async detail(projectId: string, taskId: string, actorId?: string): Promise<TaskDetail> {
    await this.loadProjectOrFail(projectId);
    const access = actorId === undefined ? null : await this.permission.assertProjectVisible(actorId, projectId);
    const row = await this.repository.findListRowById(taskId, projectId);
    if (row === null) throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
    const files = await this.repository.listFiles(taskId);
    const today = shanghaiToday(new Date());
    let capabilities: TaskCapabilities | undefined;
    if (actorId !== undefined) {
      const base = taskCapabilitiesOf(actorId, access, row.task.ownerIds);
      capabilities = base.source === "task_owner"
        ? { ...base, canDelete: await this.repository.wasTaskCreatedBy(projectId, taskId, actorId) }
        : base;
    }
    return {
      ...toTaskView(row.task, today, toChangeLinks(row.changeLinks)),
      ownerNames: row.ownerNames ?? [],
      managerNames: row.managerNames ?? [],
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        status: file.status as TaskDetail["files"][number]["status"],
        docType: normalizeDocType(file.docType),
      })),
      ...(capabilities === undefined ? {} : { capabilities }),
    };
  }

  /**
   * POST /projects/{id}/tasks：按节点判重，临时任务可由系统管理员或当前项目经理手工创建。
   * w2 · Push 124 / A23 · Push 136：stageKey 可选（缺省 / null = 「未分组」；带节点时缺省取节点阶段）、ownerIds 显式 [] = 「待分配」、
   * sortIndex = 插入位次（越界 / 缺省 = 组尾），组内其余任务位次顺延。
   */
  async create(projectId: string, body: TaskCreateBody, actorId: string): Promise<Task> {
    const nodeId = body.taskNodeId ?? null;
    const sourceNodeId = body.sourceNodeId ?? null;
    const additionalStageId = body.additionalStageId ?? null;
    if (additionalStageId !== null && nodeId !== null) {
      throw new AppError("VALIDATION_FAILED", "新增阶段不能使用项目流程节点");
    }
    const temporary = additionalStageId === null && isTemporaryTask({ stageKey: body.stageKey ?? null, nodeId, taskNodeId: sourceNodeId });
    if (body.syncToGroup === true && !temporary) {
      throw new AppError("VALIDATION_FAILED", "只有临时任务可在创建时同步到项目群");
    }
    const syncToGroup = body.syncToGroup === true;
    await this.loadProjectForWrite(projectId, temporary);
    const selectedManagers = body.managerIds?.map((id) => id.toLowerCase());
    if (temporary) {
      if (selectedManagers === undefined || selectedManagers.length === 0) {
        throw new AppError("VALIDATION_FAILED", "请选择至少一位项目经理");
      }
      await this.managerEligibility.assertAssignable(selectedManagers);
    } else if (selectedManagers !== undefined) {
      throw new AppError("VALIDATION_FAILED", "只有临时任务可在创建时单独指定项目经理");
    }
    if (nodeId !== null && sourceNodeId !== null) {
      throw new AppError("VALIDATION_FAILED", "taskNodeId（项目流程节点）与 sourceNodeId（节点库节点）二选一");
    }
    const requestedStage = body.stageKey ?? null;
    let sourceStage: string | null = null;
    let title = body.title;
    let titleEn = body.titleEn ?? null;
    if (sourceNodeId !== null) {
      // 节点库来源（M3-07 刀 3 · A1-16）：描述 / 英文名 / 阶段取节点库现值（A1-17 锁定字段），节点必须存在
      const node = await this.nodes.findById(sourceNodeId);
      if (node === null) {
        throw new AppError("VALIDATION_FAILED", "sourceNodeId 不存在或节点已从节点库删除");
      }
      if (!isProjectStageKey(node.stageKey)) {
        throw new AppError("VALIDATION_FAILED", "该任务节点属于模板专区分组，不能直接生成项目任务");
      }
      sourceStage = node.stageKey;
      title = node.title;
      titleEn = node.titleEn;
    } else if (nodeId === null && !temporary && additionalStageId === null) {
      await this.assertAdmin(actorId, "手工创建非标准任务");
    }
    // 负责人缺省 = 「待分配」空数组（2026-09-24 业务口径：任务添加后负责人默认为空 —— 不再兜底项目经理；A23 的兜底口径据此修订）
    const ownerIds = body.ownerIds !== undefined ? body.ownerIds : [];
    const row = await this.database.db.transaction(async (tx) => {
      let nodeStage = sourceStage;
      if (nodeId !== null) {
        const node = await this.repository.lockProjectNodeForCreate(projectId, nodeId, tx);
        if (node === null || node.status === "deleted") {
          throw new AppError("VALIDATION_FAILED", "taskNodeId 不属于该项目或节点已删除");
        }
        nodeStage = node.stageKey;
      }
      if (nodeStage !== null && requestedStage !== null && nodeStage !== requestedStage) {
        throw new AppError("VALIDATION_FAILED", "stageKey 与来源节点所属阶段不一致（节点阶段：" + nodeStage + "）");
      }
      const additionalStage = additionalStageId === null ? null : await this.requireAdditionalStage(tx, projectId, additionalStageId);
      if (additionalStage !== null && [nodeStage, requestedStage].some((key) => key !== null && key !== additionalStage.stageKey)) {
        throw new AppError("VALIDATION_FAILED", "请选择新增阶段对应原阶段的任务节点");
      }
      const additionalStageNumber = additionalStage?.number ?? null;
      const stageKey = additionalStage?.stageKey ?? nodeStage ?? requestedStage;
      // 指定位次时先锁任务分组，与单条重排保持相同的加锁顺序。
      if (body.sortIndex !== undefined) await this.repository.listGroupOrder(projectId, stageKey, tx, true, additionalStageNumber);
      const project = await this.loadProjectForWrite(projectId, temporary, tx);
      if (temporary) await this.permission.assertCanManageProjectManagers(actorId, project, tx);
      if (additionalStage !== null && sourceNodeId === null) await this.permission.assertCanManageProjectManagers(actorId, project, tx, "为新增阶段手工添加任务");
      if (syncToGroup) {
        const group = await this.repository.findGroupBinding(projectId, tx);
        if (group === null) {
          throw new AppError("VALIDATION_FAILED", "项目群未绑定，无法同步临时任务到群聊");
        }
        if (group.activatedAt === null) {
          throw new AppError("VALIDATION_FAILED", "项目群机器人尚未激活，无法同步临时任务到群聊");
        }
      }
      if (nodeId !== null) {
        const existing = await this.repository.findTaskIdByNode(projectId, nodeId, tx);
        if (existing !== null) {
          throw new AppError("TASK_ALREADY_EXISTS", "该项目已存在该节点生成的任务：" + existing);
        }
      }
      if (sourceNodeId !== null) {
        const existing = await this.repository.findTaskIdsBySourceNodes(projectId, [sourceNodeId], tx, additionalStage);
        const hit = existing.get(sourceNodeId);
        if (hit !== undefined) {
          throw new AppError("TASK_ALREADY_EXISTS", "该项目已添加过该节点（任务：" + hit + "）");
        }
      }
      const groupSize = await this.repository.countGroup(projectId, stageKey, tx, additionalStageNumber);
      const sortIndex = clampSortIndex(body.sortIndex ?? groupSize, groupSize);
      if (sortIndex < groupSize) {
        await this.repository.shiftGroupIndexes(projectId, stageKey, sortIndex, null, 1, tx, additionalStageNumber);
      }
      assertEndOnOrAfterStart(title, body.plannedStart ?? null, body.plannedEnd ?? null, "预计完成日期");
      const created = await this.repository.insert(
        {
          projectId,
          stageKey,
          ...(additionalStage === null ? {} : { additionalStage }),
          nodeId,
          sourceNodeId,
          title,
          titleEn,
          ownerIds,
          managerIds: selectedManagers ?? project.managerIds,
          sortIndex,
          plannedStart: body.plannedStart ?? null,
          plannedEnd: body.plannedEnd ?? null,
          estimatedDays: body.estimatedDays ?? null,
          headcount: body.headcount ?? null,
          priority: body.priority ?? null,
          deliverableTypes: await this.resolveDeliverableTypes(tx, nodeId, body.deliverableTypes),
          note: body.note ?? null,
        },
        tx,
      );
      await appendOutbox(tx, {
        topic: "task.created",
        dedupeKey: "task.created:" + created.id,
        payload: {
          projectId,
          taskId: created.id,
          stageKey,
          nodeId,
          status: created.status,
          progress: Number(created.progress),
          actorId,
          at: created.createdAt.toISOString(),
        },
      });
      if (syncToGroup) {
        const identity = await this.repository.findListRowById(created.id, projectId, tx);
        const projectNotice = await this.repository.findProjectNotificationContext(projectId, tx);
        const ownerText = created.ownerIds.length === 0 ? "待定" : groupNames(identity?.ownerNames, "—");
        const bodyText = [
          "任务名称：" + created.title,
          "项目编号：" + (projectNotice?.code ?? "—"),
          "项目名称：" + (projectNotice?.name ?? "—"),
          "原项目经理：" + groupNames(projectNotice?.managerNames, "—"),
          "当前项目经理：" + groupNames(identity?.managerNames, "—"),
          "任务负责人：" + ownerText,
        ].join("\n");
        await appendOutbox(tx, {
          topic: "notify.group",
          dedupeKey: "temp-task.created:" + created.id,
          payload: {
            projectId,
            title: "新建临时任务",
            body: bodyText.length > 4000 ? bodyText.slice(0, 3999) + "…" : bodyText,
            refType: "task",
            refId: created.id,
            templateCode: "TEMP_TASK_CREATED_GROUP",
          },
        });
      }
      await this.repository.touchProject(projectId, created.createdAt, tx);
      await this.audit.record(tx, {
        actorId,
        action: "create",
        objectType: "task",
        objectId: created.id,
        projectId,
        summary: "创建任务：" + created.title,
        changes: [
          { field: "stageKey", from: null, to: created.stageKey },
          { field: "additionalStageNumber", from: null, to: additionalStageNumber },
          { field: "title", from: null, to: created.title },
          { field: "ownerIds", from: null, to: created.ownerIds },
          { field: "managerIds", from: null, to: created.managerIds },
          { field: "plannedEnd", from: null, to: created.plannedEnd },
        ].filter((change) => change.to !== null),
        metadata: sourceNodeId === null ? undefined : { sourceNodeId, source: "task_node" },
      });
      return created;
    });
    return toTaskView(row, shanghaiToday(row.createdAt), []);
  }

  /**
   * POST /projects/{id}/tasks/from-template（A1-16「批量生成节点任务」· M3-07 刀 3）：整批按模板内顺序生成 ——
   * 阶段取模板阶段、任务描述 / 英文名取节点库现值（A1-17 锁定字段）、负责人缺省 = 「待分配」空数组（Push 184 修订：不再兜底项目经理，A23 的兜底口径下线）。
   * 原阶段按项目判重，新增阶段分别判重。已存在的节点进 skipped；skipExisting=false 时 409。
   * 整批**同事务**（要么全落、要么不落）；位次按模板内顺序依次落位（sortIndex 起，缺省 = 组尾，同组顺延）。
   * 留痕：逐条审计（action=create，metadata 记 templateId / sourceNodeId）+ outbox task.created；不写 task_events（非字段级变更）。
   */
  async createFromTemplate(
    projectId: string,
    body: TaskCreateFromTemplateBody,
    actorId: string,
  ): Promise<TaskCreateFromTemplateResponse> {
    await this.loadProjectForWrite(projectId);
    const template = await this.templates.getTemplate(body.templateId, actorId);
    if (!isProjectStageKey(template.stageKey)) {
      throw new AppError("VALIDATION_FAILED", "「入库审核」是模板专区分组，不能生成项目任务");
    }
    /**
     * 项目编辑者仍按 task.create 正常建任务；
     * 当前阶段的任务负责人只允许从「本人私有个人模版」向本人负责的阶段补任务，且新任务强制归属本人。
     */
    const projectAccess = await this.permission.assertProjectVisible(actorId, projectId);
    const canCreateTask = await this.permission.can(actorId, "task.create", {
      member: projectAccess.member,
      projectManager: projectAccess.projectManager,
      taskOwner: projectAccess.taskOwner,
      groupAccessLevel: projectAccess.groupAccessLevel,
      accessLevel: projectAccess.accessLevel,
    });
    if (!canCreateTask) {
      if (template.visibility !== "private" || template.createdBy !== actorId) {
        throw new AppError("FORBIDDEN", "任务负责人只能从本人的个人模版向本人负责的阶段添加任务");
      }
    }
    const ordered = template.nodes;
    let picked = ordered;
    if (body.nodeIds !== undefined) {
      const wanted = new Set(body.nodeIds);
      const unknown = [...wanted].filter((id) => !ordered.some((node) => node.nodeId === id));
      if (unknown.length > 0) {
        throw new AppError("VALIDATION_FAILED", "nodeIds 不属于该模板：" + unknown.join("、"));
      }
      picked = ordered.filter((node) => wanted.has(node.nodeId));
    }
    const stageKey = template.stageKey;
    // 任务负责人通过个人模版补任务时，新任务必须归属本人。
    const ownerIds = canCreateTask ? body.ownerIds ?? [] : [actorId];
    const at = new Date();
    const today = shanghaiToday(at);
    return this.database.db.transaction(async (tx) => {
      const additionalStage = body.additionalStageId === undefined ? null : await this.requireAdditionalStage(tx, projectId, body.additionalStageId);
      if (additionalStage !== null && additionalStage.stageKey !== stageKey) {
        throw new AppError("VALIDATION_FAILED", "请选择新增阶段对应原阶段的任务模板");
      }
      const additionalStageNumber = additionalStage?.number ?? null;
      if (!canCreateTask && !(await this.repository.isStageTaskOwner(projectId, stageKey, actorId, tx, additionalStageNumber))) {
        throw new AppError("FORBIDDEN", "任务负责人只能向本人负责的阶段添加任务");
      }
      if (picked.length === 0) return { created: [], skipped: [] };
      if (body.sortIndex !== undefined) await this.repository.listGroupOrder(projectId, stageKey, tx, true, additionalStageNumber);
      const { managerIds } = await this.loadProjectForWrite(projectId, false, tx);
      const existing = await this.repository.findTaskIdsBySourceNodes(projectId, picked.map((node) => node.nodeId), tx, additionalStage);
      const skipped: { nodeId: string; taskId: string }[] = [];
      const toCreate = picked.filter((node) => {
        const hit = existing.get(node.nodeId);
        if (hit === undefined) return true;
        if (!body.skipExisting) {
          throw new AppError("TASK_ALREADY_EXISTS", "该项目已添加过该节点（任务：" + hit + "）");
        }
        skipped.push({ nodeId: node.nodeId, taskId: hit });
        return false;
      });
      const groupSize = await this.repository.countGroup(projectId, stageKey, tx, additionalStageNumber);
      const base = clampSortIndex(body.sortIndex ?? groupSize, groupSize);
      if (toCreate.length > 0 && base < groupSize) {
        await this.repository.shiftGroupIndexes(projectId, stageKey, base, null, toCreate.length, tx, additionalStageNumber);
      }
      const created: Task[] = [];
      for (let index = 0; index < toCreate.length; index += 1) {
        const node = toCreate[index]!;
        const row = await this.repository.insert(
          {
            projectId,
            stageKey,
            ...(additionalStage === null ? {} : { additionalStage }),
            nodeId: null,
            sourceNodeId: node.nodeId,
            title: node.title,
            titleEn: node.titleEn,
            ownerIds,
            managerIds,
            sortIndex: base + index,
            plannedStart: null,
            plannedEnd: null,
            estimatedDays: null,
            headcount: null,
            priority: body.priority ?? null,
            deliverableTypes: [],
            note: null,
          },
          tx,
        );
        await appendOutbox(tx, {
          topic: "task.created",
          dedupeKey: "task.created:" + row.id,
          payload: {
            projectId,
            taskId: row.id,
            stageKey,
            nodeId: null,
            status: row.status,
            progress: Number(row.progress),
            actorId,
            at: at.toISOString(),
          },
        });
        await this.audit.record(tx, {
          actorId,
          action: "create",
          objectType: "task",
          objectId: row.id,
          projectId,
          summary: "从模板创建任务：" + row.title,
          changes: [
            { field: "stageKey", from: null, to: row.stageKey },
            { field: "additionalStageNumber", from: null, to: additionalStageNumber },
            { field: "title", from: null, to: row.title },
            { field: "ownerIds", from: null, to: row.ownerIds },
            { field: "managerIds", from: null, to: row.managerIds },
          ].filter((change) => change.to !== null),
          metadata: { sourceNodeId: node.nodeId, templateId: template.id, templateName: template.name, kind: "from_template" },
        });
        created.push(toTaskView(row, today, []));
      }
      if (created.length > 0) {
        await this.repository.touchProject(projectId, at, tx);
      }
      return { created, skipped };
    });
  }
  /**
   * PATCH /projects/{id}/tasks/{taskId}：字段编辑 +（可选）基础三态写入联动（A12）+ 组内重排（A19 / A20，Push 124）；
   * 乐观锁 + 字段留痕。ownerIds 显式 [] = 「待分配」；sortIndex = 移到该组第 N 位（越界 = 组尾）。
   */
  async update(projectId: string, taskId: string, body: TaskUpdateBody, actorId: string): Promise<Task> {
    await this.loadProjectOrFail(projectId);
    const access = await this.permission.assertProjectVisible(actorId, projectId);
    const at = new Date();
    const today = shanghaiToday(at);
    const row = await this.runCompletionGuarded(actorId, taskId, () =>
      this.database.db.transaction((tx) => this.applyUpdate(
        tx,
        projectId,
        taskId,
        {
          expectedVersion: body.version,
          title: body.title,
          titleEn: body.titleEn,
          sortIndex: body.sortIndex,
          ownerIds: body.ownerIds,
          managerIds: body.managerIds,
          status: body.status,
          plannedStart: body.plannedStart,
          plannedEnd: body.plannedEnd,
          shiftFollowing: body.shiftFollowing,
          shiftTaskIds: body.shiftTaskIds,
          estimatedDays: body.estimatedDays,
          headcount: body.headcount,
          priority: body.priority,
          deliverableTypes: body.deliverableTypes,
          note: body.note,
        },
        actorId,
        at,
        today,
        null,
        access,
        true,
      )),
    );
    return toTaskView(row, today, await this.changeLinksOf(row));
  }

  /**
   * PATCH /projects/{id}/tasks/batch：批量操作（M3-04 · 系统功能书 A1-08）。
   * 口径：同一组变更（白名单）逐条应用到 ids —— 逐条独立事务（避免长事务）、逐条校验 + 部分失败清单；
   * 成功项照常生效（整体 200），条目级错误（不存在 / 门禁缺件 / 已完成 / 并发冲突）降级为 failures[]，非预期错误照旧抛出；
   * 批量完成 = changes.status=done，与单条编辑 / /complete 同一门禁（缺件项进 failures 的 gate_not_passed 并留痕）。
   * 留痕（C7-01 / A1-08 / A1-10）：批次一条（project 域，metadata 记 batchId / 计数 / 失败清单，「批量操作整体写审计日志」）+ 逐条字段级一条（entry=batch + 同批 batchId，每条任务的修改历史可查「批量」入口）。
   */
  async batch(projectId: string, body: TaskBatchBody, actorId: string): Promise<TaskBatchResponse> {
    await this.loadProjectForWrite(projectId);
    const access = await this.permission.assertProjectVisible(actorId, projectId);
    if (Object.values(body.changes).every((value) => value === undefined)) {
      throw new AppError("VALIDATION_FAILED", "批量操作至少给出一个变更字段（changes）");
    }
    const at = new Date();
    const today = shanghaiToday(at);
    const batchId = randomUUID();
    const ids = [...new Set(body.ids)];
    const request: TaskWriteRequest = { expectedVersion: null, ...body.changes };
    const succeeded: Task[] = [];
    const failures: TaskBatchFailure[] = [];
    for (const taskId of ids) {
      try {
        const row = await this.runCompletionGuarded(
          actorId,
          taskId,
          () => this.database.db.transaction((tx) => this.applyUpdate(tx, projectId, taskId, request, actorId, at, today, batchId, access, false)),
          batchId,
        );
        succeeded.push(toTaskView(row, today, await this.changeLinksOf(row)));
      } catch (error) {
        const failure = toBatchFailure(taskId, error);
        if (failure === null) throw error;
        failures.push(failure);
      }
    }
    // 批次审计（系统功能书 A1-08「批量操作整体写审计日志」）：一次请求一条（project 域），
    // 与逐条字段级审计（entry=batch + 同批 batchId）并存 —— 前者可查「谁在什么时候批了什么」，后者可查每条任务的修改历史。
    await this.audit.record(this.database.db, {
      actorId,
      action: "update",
      objectType: "project",
      objectId: projectId,
      projectId,
      summary: "批量操作任务：" + ids.length + " 条（成功 " + succeeded.length + "，失败 " + failures.length + "）",
      changes: null,
      metadata: {
        entry: "batch",
        batchId,
        taskIds: ids,
        changedFields: Object.entries(body.changes)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key),
        succeededCount: succeeded.length,
        failedCount: failures.length,
        failures: failures.map((failure) => ({ id: failure.id, code: failure.code })),
      },
    });
    return { total: ids.length, succeededCount: succeeded.length, failedCount: failures.length, succeeded, failures };
  }

  /**
   * DELETE /projects/{id}/tasks/{taskId}（M3-05 · A25 · 系统功能书 A1-01 修订）：软删 —— 不物理删行，历史与留痕保留。
   * 口径：① 列表 / 看板 / 甘特图 / 详情 / 完成门禁一律不可见（读面统一过滤 deleted_at is null）；
   * ② 重复删除 = 统一 404（记录级 404 语义，与已删任务上的任何写路径一致 —— 不新增错误码）；
   * ③ 组内位次同事务压缩，保持「0 起、密集」不变式（A19 / A20）；
   * ④ 来源节点约束随软删释放（节点回到「可添加」，A10 / A11 口径不变 —— 判重走 findTaskIdByNode 已过滤软删）；
   * ⑤ 沿用任务删除权限。归档项目仅允许删除未完成的手工临时任务。
   * ⑥ 已有引用（问题 / 变更记录）的任务不允许删除 = 409 TASK_HAS_REFERENCES（系统功能书 A2-01「已产生日报 / 问题 / 变更的任务不允许删除，只能关闭或标记」；
   *   Push 215 起日报「关联任务」改「关联阶段」，日报一侧引用守卫随批删除：details[].code = change_ref / issue_ref）；
   * 留痕：审计 action=delete（objectType=task，changes = 删除前快照）+ outbox task.deleted；
   * 不写 task_events —— 其类型为四值闭集（status_change / date_change / progress_change / note_change），删除不属于字段级变更。
   */
  async remove(projectId: string, taskId: string, actorId: string): Promise<TaskDeleteResponse> {
    const at = new Date();
    await this.database.db.transaction(async (tx) => {
      const before = await this.requireActiveTask(tx, projectId, taskId);
      await this.loadProjectForWrite(projectId, isOpenTemporaryTask(before), tx);
      const projectAccess = await this.permission.assertProjectVisible(actorId, projectId);
      const canUpdate = await this.permission.can(actorId, "task.update", {
        member: projectAccess.member,
        projectManager: projectAccess.projectManager,
        taskOwner: projectAccess.taskOwner,
        groupAccessLevel: projectAccess.groupAccessLevel,
        accessLevel: projectAccess.accessLevel,
      });
      if (!canUpdate) {
        const ownTask = before.ownerIds.includes(actorId);
        if (!ownTask || !(await this.repository.wasTaskCreatedBy(projectId, taskId, actorId, tx))) {
          throw new AppError("FORBIDDEN", "任务负责人只能删除自己添加的任务");
        }
      }
      await this.assertTaskDeletable(tx, before);
      await this.softDeleteTask(tx, before, actorId, at);
      await this.repository.shiftGroupIndexes(projectId, before.stageKey, before.sortIndex + 1, null, -1, tx, before.additionalStageNumber);
      await this.repository.touchProject(projectId, at, tx);
    });
    return { id: taskId, deleted: true };
  }

  private async assertTaskDeletable(tx: DbClient, task: TaskRow): Promise<void> {
    this.assertTaskMutable(task);
    const references = await this.referencesOf(tx, task);
    if (references.length > 0) {
      throw new AppError(
        "TASK_HAS_REFERENCES",
        "任务已产生问题 / 变更，不允许删除（系统功能书 A2-01）；只能关闭或标记",
        references,
      );
    }
  }

  private async softDeleteTask(tx: DbClient, task: TaskRow, actorId: string, at: Date, additionalStageId?: string): Promise<void> {
    const { id: taskId, projectId, stageKey, nodeId } = task;
    const deleted = await this.repository.softDelete(tx, taskId, actorId, at);
    if (!deleted) throw new AppError("NOT_FOUND", "任务不存在或已删除：" + taskId);
    await appendOutbox(tx, {
      topic: "task.deleted",
      dedupeKey: "task.deleted:" + taskId + ":" + task.version,
      payload: { projectId, taskId, stageKey, nodeId, actorId, at: at.toISOString() },
    });
    await this.audit.record(tx, {
      actorId,
      action: "delete",
      objectType: "task",
      objectId: taskId,
      projectId,
      summary: "删除任务：" + task.title,
      changes: diffRecords(taskAuditSnapshot(task), null),
      metadata: { softDelete: true, stageKey, nodeId, ...(additionalStageId === undefined ? {} : { additionalStageId }) },
    });
  }

  /**
   * PATCH /projects/{id}/tasks/{taskId}/locked-fields（M3-05 · A1-17 / C9-07 · Push 153）：锁定字段例外调整。
   * 任务描述 / 输出成果文件按流程节点模板生成后锁定（常规编辑不可达）；确需修正时 **仅系统管理员** 可执行，
   * 原因必填并留痕（模板本身由管理员修正，C9-07）；「阶段性里程」一期任务无对应列，不开放。
   * 口径：至少一个实际变化（否则 400 —— 防止空调整刷留痕）；乐观锁 409；归档项目 409；不存在 / 已删 404。
   * 留痕：审计（changes = 锁定字段 before → after；metadata 记原因与 kind）+ outbox `task.locked_fields_adjusted` + touch 项目；
   * 不写 `task_events`（四值闭集不含锁定字段）。成果文件类型修正后即刻成为无节点任务的完成门禁依据。
   */
  async adjustLockedFields(
    projectId: string,
    taskId: string,
    body: TaskLockedFieldsAdjustBody,
    actorId: string,
  ): Promise<Task> {
    await this.loadProjectForWrite(projectId);
    await this.assertAdmin(actorId, "例外调整锁定字段（A1-17 / C9-07）");
    const at = new Date();
    const today = shanghaiToday(at);
    const row = await this.database.db.transaction(async (tx) => {
      const before = await this.requireActiveTask(tx, projectId, taskId);
      this.assertTaskMutable(before);
      if (before.version !== body.version) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      const patch: TaskUpdatePatch = {};
      if (body.title !== undefined && body.title !== before.title) patch.title = body.title;
      if (body.titleEn !== undefined && body.titleEn !== before.titleEn) patch.titleEn = body.titleEn;
      if (body.deliverableTypes !== undefined) {
        const next = normalizeDocTypes(body.deliverableTypes);
        if (next.join(",") !== normalizeDocTypes(before.deliverableTypes).join(",")) patch.deliverableTypes = next;
      }
      if (Object.keys(patch).length === 0) {
        throw new AppError("VALIDATION_FAILED", "锁定字段没有实际变化，无需例外调整");
      }
      const updated = await this.repository.updateWithVersion(taskId, body.version, patch, at, tx);
      if (updated === null) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      const changes = diffRecords(lockedFieldsSnapshot(before), lockedFieldsSnapshot(updated));
      await appendOutbox(tx, {
        topic: "task.locked_fields_adjusted",
        dedupeKey: "task.locked_fields_adjusted:" + taskId + ":" + updated.version,
        payload: {
          projectId,
          taskId,
          fields: changes.map((change) => change.field),
          reason: body.reason,
          actorId,
          at: at.toISOString(),
        },
      });
      await this.repository.touchProject(projectId, at, tx);
      await this.audit.record(tx, {
        actorId,
        action: "update",
        objectType: "task",
        objectId: taskId,
        projectId,
        summary: "例外调整任务锁定字段：" + updated.title + "（原因：" + body.reason + "）",
        changes,
        metadata: {
          reason: body.reason,
          kind: "locked_field_exception",
          adminOnly: true,
          fields: changes.map((change) => change.field),
        },
      });
      return updated;
    });
    return toTaskView(row, today, await this.changeLinksOf(row));
  }

  /** 写路径统一前置（M3-05）：锁行 + 校验归属本项目 + 未软删；已删任务 = 404（与读面不可见同口径）。 */
  /**
   * 删除引用守卫明细（A2-01；Push 152 登记「问题随 M5 加判定」；Push 215 删日报一侧）：
   * ① 变更记录（tasks.change_refs）逐条明细；② 问题（issues.task_id）。
   * 任一非空即 409 TASK_HAS_REFERENCES —— 拒绝时不软删 / 不压缩位次 / 不写留痕（抛在事务内，整体回滚）。
   */
  private async referencesOf(tx: DbClient, task: TaskRow): Promise<ErrorDetail[]> {
    const details: ErrorDetail[] = task.changeRefs.map((changeId) => ({
      code: "change_ref",
      message: "关联变更：" + changeId,
      path: "changeRefs",
      meta: { changeRequestId: changeId },
    }));
    const issueRefs = await this.repository.countIssueRefs(task.id, tx);
    if (issueRefs > 0) {
      details.push({ code: "issue_ref", message: "关联问题：" + issueRefs + " 条", path: "issues", meta: { count: issueRefs } });
    }
    return details;
  }

  private async requireActiveTask(tx: DbClient, projectId: string, taskId: string): Promise<TaskRow> {
    const row = await this.repository.lockTask(tx, taskId);
    if (row === null || row.projectId !== projectId || row.deletedAt !== null) {
      throw new AppError("NOT_FOUND", "任务不存在或已删除：" + taskId);
    }
    return row;
  }
  /** 任务写权限：项目编辑者拥有整项目；任务负责人只拥有本人任务；其余一律只读。 */
  private assertTaskWriteAllowed(
    actorId: string,
    projectAccess: ProjectAccessContext,
    task: TaskRow,
    allowTaskOwner: boolean,
  ): TaskCapabilities {
    const capabilities = taskCapabilitiesOf(actorId, projectAccess, task.ownerIds);
    if (capabilities.source === "project_edit" || (allowTaskOwner && capabilities.source === "task_owner")) {
      return capabilities;
    }
    throw new AppError("FORBIDDEN", "仅项目编辑者或当前任务负责人可修改该任务");
  }

  /**
   * 定档 / 取消定档的角色闸（Pro 逐人权限）：仅任务当前负责人或项目编辑者。
   * 必须在幂等短路之前判定，避免无权用户通过重复操作探测或维持已定档状态。
   * 返回能力来源：取消定档时间闸只约束 task_owner；project_edit（含项目经理）不受该时间闸限制。
   */
  private assertCanManageTaskFinalization(
    actorId: string,
    task: TaskRow,
    projectAccess: ProjectAccessContext,
  ): TaskCapabilities {
    const capabilities = taskCapabilitiesOf(actorId, projectAccess, task.ownerIds);
    if (capabilities.canFinalize) return capabilities;
    throw new AppError("FORBIDDEN", "仅任务负责人或项目编辑者可定档或取消定档");
  }

  /**
   * 任务定档写口闸（Push 249 · 业务口径「添加和替换文件要提示是否为定档文件，若是则上传文件后该任务定档不支持任何修改」）：
   * 定档后的任务不支持任何修改 —— 编辑 / 批量 / 进度 / 完成提交 / 删除 / 锁定字段例外调整一律 409 TASK_FINALIZED。
   * 唯一保留的修改通道 = 对已定档文件的变更（A2-10「定档后修改须走变更管理」，A4-13 申请即通过）。
   */
  private assertTaskMutable(task: TaskRow): void {
    if (task.finalizedAt !== null) {
      throw new AppError("TASK_FINALIZED", "任务已定档，不支持任何修改（文件修改走变更）", [
        { code: "task_finalized", message: "任务定档时间：" + task.finalizedAt.toISOString(), path: "finalizedAt" },
      ]);
    }
  }

  /**
   * 单条写入内核（编辑 / 批量共用）：锁行 → 校验 → 状态联动 → 门禁 → 落库 + 事件 + outbox + 审计。
   * expectedVersion = null 表示批量（按当前行覆盖：批量是「把选中行统一改成同一值」，不带逐行乐观锁）；
   * batchId 非空时审计 metadata 标注「批量」入口（entry=batch）并共享批次号。
   */
  private async applyUpdate(
    tx: DbClient,
    projectId: string,
    taskId: string,
    request: TaskWriteRequest,
    actorId: string,
    at: Date,
    today: string,
    batchId: string | null,
    projectAccess: ProjectAccessContext | null = null,
    allowTaskOwner = false,
  ): Promise<TaskRow> {
    let stageTasks: TaskRow[] = [];
    const requestedShiftIds = request.shiftTaskIds ?? [];
    const shiftRequested = request.shiftFollowing === true || requestedShiftIds.length > 0;
    if (request.sortIndex !== undefined || shiftRequested) {
      const brief = await this.repository.findTaskBrief(taskId, tx);
      if (brief === null || brief.projectId !== projectId) {
        throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
      }
      if (shiftRequested && brief.stageKey !== null) {
        stageTasks = await this.repository.lockStageTasks(tx, projectId, brief.stageKey, brief.additionalStageNumber);
      } else if (request.sortIndex !== undefined) {
        await this.repository.listGroupOrder(projectId, brief.stageKey, tx, true, brief.additionalStageNumber);
      }
    }
    const anchorIndex = stageTasks.findIndex((task) => task.id === taskId);
    const before = stageTasks[anchorIndex] ?? await this.repository.lockTask(tx, taskId);
    if (before === null || before.projectId !== projectId) {
      throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
    }
    const temporary = isTemporaryTask(before);
    const project = await this.loadProjectForWrite(projectId, batchId === null && temporary && before.status !== "done", tx);
    const currentManagerIds = temporary ? before.managerIds : project.managerIds;
    const nextManagers = request.managerIds !== undefined && projectManagerIdsChanged(currentManagerIds, request.managerIds)
      ? request.managerIds.map((id) => id.toLowerCase())
      : undefined;
    if (projectAccess !== null) {
      const capabilities = this.assertTaskWriteAllowed(actorId, projectAccess, before, allowTaskOwner);
      if (shiftRequested && capabilities.source !== "project_edit") {
        throw new AppError("FORBIDDEN", "仅项目编辑者可顺延阶段后续任务");
      }
      const ownersChanged =
        request.ownerIds !== undefined && request.ownerIds.join("\u0000") !== before.ownerIds.join("\u0000");
      const sortChanged = request.sortIndex !== undefined && request.sortIndex !== before.sortIndex;
      if (capabilities.source === "task_owner" && (ownersChanged || nextManagers !== undefined || sortChanged)) {
        throw new AppError("FORBIDDEN", "任务负责人不能修改负责人、项目经理或任务排序");
      }
    }
    if (nextManagers !== undefined) {
      await this.permission.assertCanManageProjectManagers(actorId, project, tx);
      await this.managerEligibility.assertAssignable(nextManagers, { existingUserIds: currentManagerIds });
    }
    this.assertTaskMutable(before);
    if (request.expectedVersion !== null && before.version !== request.expectedVersion) {
      throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
    }
    if (request.title !== undefined || request.titleEn !== undefined) {
      // Push 196：任务描述（title / titleEn）只对**临时任务**开放（看板「添加 → 临时任务」手工创建、未归入阶段）；
      // Push 197 收窄（业务口径「这个不是临时任务 不能修改」）：归入阶段的任务即便没有来源节点也锁定 ——
      // 阶段任务与节点 / 模板生成的任务仍按 A1-17 走常规编辑不可达，修正走管理员「例外调整」（PATCH …/locked-fields）。
      if (!temporary) {
        throw new AppError("VALIDATION_FAILED", "只有未归入阶段的「临时任务」可改任务描述（阶段任务 / 节点 / 模板生成的任务按 A1-17 锁定），修正请走管理员「例外调整」");
      }
    }
    if (batchId !== null && request.status === "done" && before.status === "done") {
      throw new AppError("TASK_ALREADY_DONE", "任务已完成，无需重复提交");
    }
    const sortIndex =
      request.sortIndex === undefined ? before.sortIndex : await this.moveWithinGroup(tx, projectId, before, request.sortIndex);
    const current = {
      status: before.status,
      progress: Number(before.progress),
      actualEnd: before.actualEnd,
      statusOverride: before.statusOverride,
    };
    const linked = request.status === undefined ? null : applyStatusWrite(current, request.status, today);
    if (shiftRequested && before.stageKey === null) {
      throw new AppError("VALIDATION_FAILED", "只有归入阶段的任务可顺延后续任务");
    }
    const plannedStart = request.plannedStart === undefined ? before.plannedStart : request.plannedStart;
    const plannedEnd = request.plannedEnd === undefined ? before.plannedEnd : request.plannedEnd;
    const actualEnd = linked === null ? before.actualEnd : linked.actualEnd;
    if (plannedStart !== before.plannedStart || plannedEnd !== before.plannedEnd) {
      assertEndOnOrAfterStart(before.title, plannedStart, plannedEnd, "预计完成日期");
    }
    if (actualEnd !== before.actualEnd) {
      assertActualEnd(before.title, plannedStart, actualEnd, today);
    } else if (plannedStart !== before.plannedStart) {
      assertEndOnOrAfterStart(before.title, plannedStart, actualEnd, "实际完成日期");
    }
    const shiftDays = shiftRequested ? scheduleShiftDays(before, plannedStart, plannedEnd) : 0;
    const shiftCandidates = stageTasks.slice(anchorIndex + 1)
      .filter((task) => task.plannedStart !== null || task.plannedEnd !== null);
    if (requestedShiftIds.length > 0) {
      const known = new Set(shiftCandidates.map((task) => task.id));
      const unknown = requestedShiftIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new AppError("VALIDATION_FAILED", "只能同步本阶段位次在当前任务之后、且已填计划日期的任务", [
          { code: "invalid_shift_target", message: "无效任务：" + unknown.join("、"), path: "shiftTaskIds" },
        ]);
      }
    }
    const wantedShiftIds = new Set(requestedShiftIds);
    const shiftedTasks = shiftDays === 0 ? [] : shiftCandidates
      .filter((task) => requestedShiftIds.length === 0 || wantedShiftIds.has(task.id))
      .map((task) => {
        const start = shiftedPlanDate(task.title, task.plannedStart, shiftDays);
        const end = shiftedPlanDate(task.title, task.plannedEnd, shiftDays);
        assertEndOnOrAfterStart(task.title, start, end, "预计完成日期");
        assertEndOnOrAfterStart(task.title, start, task.actualEnd, "实际完成日期");
        this.assertTaskMutable(task);
        return { task, dates: { plannedStart: start, plannedEnd: end } };
      });
    const completionWarnings =
      linked !== null && linked.status === "done" && before.status !== "done"
        ? await this.assertCompletionGate(tx, before, at, actorId)
        : null;
    const patch: TaskUpdatePatch = {
      title: request.title !== undefined ? request.title : before.title,
      titleEn: request.titleEn !== undefined ? request.titleEn : before.titleEn,
      ownerIds: request.ownerIds !== undefined ? request.ownerIds : before.ownerIds,
      managerIds: nextManagers ?? before.managerIds,
      status: linked === null ? before.status : linked.status,
      statusOverride: linked === null ? before.statusOverride : linked.statusOverride,
      progress: String(linked === null ? current.progress : linked.progress),
      sortIndex,
      plannedStart,
      plannedEnd,
      actualEnd,
      estimatedDays: request.estimatedDays !== undefined ? request.estimatedDays : before.estimatedDays,
      headcount: request.headcount !== undefined ? request.headcount : before.headcount,
      priority: request.priority !== undefined ? request.priority : before.priority,
      // 2026-10-08（业务口径「文件输出成果也要可以选择」）：输出成果文件常规编辑开放（去重保序；[] = 不要求）
      deliverableTypes: request.deliverableTypes !== undefined ? normalizeDocTypes(request.deliverableTypes) : before.deliverableTypes,
      note: request.note !== undefined ? request.note : before.note,
    };
    const updated = await this.persistTaskUpdate(tx, before, patch, actorId, at, batchId);
    for (const { task, dates } of shiftedTasks) {
      await this.persistTaskUpdate(tx, task, dates, actorId, at, null);
    }
    if (completionWarnings !== null) {
      await this.appendCompletionOutbox(tx, { projectId, task: updated, warnings: completionWarnings, actorId, at });
    }
    await this.repository.touchProject(projectId, at, tx);
    if (!temporary && nextManagers !== undefined) {
      await this.repository.replaceProjectManagersExceptTask(projectId, taskId, nextManagers, at, tx);
      await this.audit.record(tx, {
        actorId,
        action: "update",
        objectType: "project",
        objectId: projectId,
        projectId,
        summary: "修改项目级项目经理（任务表入口）",
        changes: [{ field: "managerIds", from: project.managerIds, to: nextManagers }],
        metadata: { entry: "task_managers", scope: "project" },
      });
    }
    return updated;
  }

  private async persistTaskUpdate(
    tx: DbClient,
    before: TaskRow,
    patch: TaskUpdatePatch,
    actorId: string,
    at: Date,
    batchId: string | null,
  ): Promise<TaskRow> {
    const { id: taskId, projectId } = before;
    const updated = await this.repository.updateWithVersion(taskId, before.version, patch, at, tx);
    if (updated === null) {
      throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
    }
    await this.repository.insertEvents(tx, buildEvents(before, patch), actorId, at);
    await appendOutbox(tx, {
      topic: "task.updated",
      dedupeKey: "task.updated:" + taskId + ":" + updated.version,
      payload: {
        projectId,
        taskId,
        status: updated.status,
        progress: Number(updated.progress),
        plannedEnd: updated.plannedEnd,
        actualEnd: updated.actualEnd,
        actorId,
        at: at.toISOString(),
      },
    });
    const changes = diffRecords(taskAuditSnapshot(before), taskAuditSnapshot(updated));
    await this.audit.record(tx, {
      actorId,
      action: "update",
      objectType: "task",
      objectId: taskId,
      projectId,
      summary: (batchId === null ? "" : "批量") + "修改任务：" + updated.title,
      changes: changes.length > 0 ? changes : null,
      metadata: batchId === null ? undefined : { entry: "batch", batchId },
    });
    return updated;
  }

  /** PATCH /projects/{id}/tasks/{taskId}/progress：四格进度 + 完成日期（A12 / A13）；响应为 TaskListItem 同形。 */
  async updateProgress(
    projectId: string,
    taskId: string,
    body: TaskProgressUpdateBody,
    actorId: string,
  ): Promise<TaskListItem> {
    await this.loadProjectOrFail(projectId);
    const access = await this.permission.assertProjectVisible(actorId, projectId);
    const at = new Date();
    const today = shanghaiToday(at);
    const row = await this.runCompletionGuarded(actorId, taskId, () =>
      this.database.db.transaction(async (tx) => {
      const before = await this.repository.lockTask(tx, taskId);
      if (before === null || before.projectId !== projectId) {
        throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
      }
      await this.loadProjectForWrite(projectId, isOpenTemporaryTask(before), tx);
      this.assertTaskWriteAllowed(actorId, access, before, true);
      this.assertTaskMutable(before);
      if (before.version !== body.version) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      const linked = applyProgressWrite(body.progress, body.actualEnd ?? null, today);
      assertActualEnd(before.title, before.plannedStart, linked.actualEnd, today);
      const completionWarnings =
        linked.status === "done" && before.status !== "done"
          ? await this.assertCompletionGate(tx, before, at, actorId)
          : null;
      const patch: TaskUpdatePatch = {
        status: linked.status,
        statusOverride: linked.statusOverride,
        progress: String(linked.progress),
        actualEnd: linked.actualEnd,
        note: body.note !== undefined ? body.note : before.note,
      };
      const updated = await this.repository.updateWithVersion(taskId, body.version, patch, at, tx);
      if (updated === null) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      await this.repository.insertEvents(tx, buildEvents(before, patch), actorId, at);
      await appendOutbox(tx, {
        topic: "task.progress_changed",
        dedupeKey: "task.progress_changed:" + taskId + ":" + updated.version,
        payload: {
          projectId,
          taskId,
          status: updated.status,
          progress: Number(updated.progress),
          actualEnd: updated.actualEnd,
          actorId,
          at: at.toISOString(),
        },
      });
      if (completionWarnings !== null) {
        await this.appendCompletionOutbox(tx, { projectId, task: updated, warnings: completionWarnings, actorId, at });
      }
      await this.repository.touchProject(projectId, at, tx);
      const changes = diffRecords(taskAuditSnapshot(before), taskAuditSnapshot(updated));
      await this.audit.record(tx, {
        actorId,
        action: "progress",
        objectType: "task",
        objectId: taskId,
        projectId,
        summary: "更新任务进度：" + updated.title + "（进度 " + Number(updated.progress) + "）",
        changes: changes.length > 0 ? changes : null,
      });
      return updated;
      }),
    );
    const listRow = await this.repository.findListRowById(row.id, projectId);
    if (listRow === null) throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
    const summaries = await this.repository.fileSummaries([row.id]);
    return {
      ...toListItem(listRow, summaries.get(row.id) ?? EMPTY_FILE_SUMMARY, today),
      capabilities: taskCapabilitiesOf(actorId, access, row.ownerIds),
    };
  }

  /**
   * 组内重排（A19 / A20 · Push 124）：把任务移到该组第 N 位（越界 = 组尾），返回落定位次。
   * 调用方必须已锁住该组（listGroupOrder lock=true）—— 只平移其余任务的位次，不逐个改版本 / updated_at。
   */
  /**
   * GET /projects/{id}/tasks/{taskId}/can-complete：完成任务预检（UI 置灰依据；不替代事务内强校验 —— 与节点 can-complete 同口径）。
   * 门禁口径（ADR-024 / A4-20 · 2026-11-12）：合并节点 required_doc 与任务 deliverable_types，配置了成果类型才要求上传文件，且只要范围内存在任一已上传文件即可；文件 doc_type 不参与匹配。未配置不要求文件。
   * draft 文件可完成并返回 R02 提醒；预检与事务内强校验同口径。
   */
  async canComplete(projectId: string, taskId: string): Promise<TaskCanCompleteResponse> {
    await this.loadProjectOrFail(projectId);
    const target = await this.repository.findCompletionTarget(this.database.db, taskId);
    if (target === null || target.projectId !== projectId) {
      throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
    }
    if (target.status === "done") return { canComplete: false, missing: [], warnings: [] };
    const gate = await this.evaluateGate(this.database.db, target);
    return { canComplete: gate.missing.length === 0, missing: gate.missing, warnings: gate.warnings };
  }

  /**
   * POST /projects/{id}/tasks/{taskId}/complete：任务完成提交（M3-03 · PoC 9 后半）。
   * 事务内乐观锁 + 门禁强校验；已配置成果类型但缺上传文件 → 422 TASK_REQUIRED_DOC_MISSING（拒绝也留痕）；
   * 存在 draft 成果文件放行 + warning 并触发 R02。
   */
  async complete(projectId: string, taskId: string, body: TaskCompleteBody, actorId: string): Promise<TaskCompleteResponse> {
    await this.loadProjectOrFail(projectId);
    const access = await this.permission.assertProjectVisible(actorId, projectId);
    const at = new Date();
    const today = shanghaiToday(at);
    const result = await this.runCompletionGuarded(actorId, taskId, () =>
      this.database.db.transaction(async (tx) => {
        const before = await this.repository.lockTask(tx, taskId);
        if (before === null || before.projectId !== projectId) {
          throw new AppError("NOT_FOUND", "任务不存在或不属于该项目");
        }
        await this.loadProjectForWrite(projectId, isOpenTemporaryTask(before), tx);
        this.assertTaskWriteAllowed(actorId, access, before, true);
        this.assertTaskMutable(before);
        if (before.status === "done") {
          throw new AppError("TASK_ALREADY_DONE", "任务已完成，无需重复提交");
        }
        if (before.version !== body.version) {
          throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
        }
        const linked = applyStatusWrite(
          {
            status: before.status,
            progress: Number(before.progress),
            actualEnd: body.actualEnd ?? before.actualEnd,
            statusOverride: before.statusOverride,
          },
          "done",
          today,
        );
        assertActualEnd(before.title, before.plannedStart, linked.actualEnd, today);
        const warnings = await this.assertCompletionGate(tx, before, at, actorId);
        const patch: TaskUpdatePatch = {
          status: linked.status,
          statusOverride: linked.statusOverride,
          progress: String(linked.progress),
          actualEnd: linked.actualEnd,
          note: body.note !== undefined ? body.note : before.note,
        };
        const updated = await this.repository.updateWithVersion(taskId, body.version, patch, at, tx);
        if (updated === null) {
          throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
        }
        await this.repository.insertEvents(tx, buildEvents(before, patch), actorId, at);
        await this.appendCompletionOutbox(tx, { projectId, task: updated, warnings, actorId, at });
        await this.repository.touchProject(projectId, at, tx);
        const changes = diffRecords(taskAuditSnapshot(before), taskAuditSnapshot(updated));
        await this.audit.record(tx, {
          actorId,
          action: "complete",
          objectType: "task",
          objectId: taskId,
          projectId,
          summary: "完成任务：" + updated.title + (warnings.length > 0 ? "（存在未定档成果文件，已触发 R02 提醒）" : ""),
          changes: changes.length > 0 ? changes : null,
        });
        return { task: updated, warnings };
      }),
    );
    return { task: toTaskView(result.task, today, await this.changeLinksOf(result.task)), warnings: result.warnings };
  }

  /**
   * POST /projects/{id}/tasks/{taskId}/finalize：任务定档（Push 252 · 业务口径「在抽屉中每个任务在任务状态旁边加一个定档按钮状态，有二次提示」）。
   * 口径（2026-11-12）：任务必须已完成（status=done）、至少配置一类输出成果文件，且范围内存在任一已上传文件，才可定档；
   * 文件 doc_type 为空或与配置不一致均不阻止。未完成 / 未配置成果类型 → 409 TASK_FINALIZE_NOT_READY；没有任何成果文件 → 422 TASK_REQUIRED_DOC_MISSING。
   * 通过后置位 finalized_at / finalized_by（version+1、留痕、outbox task.finalized、项目触点）；此后写口一律 409 TASK_FINALIZED（assertTaskMutable）；修改走变更。
   * 防绕过补漏：定档同时撤销该任务在途的 version 上传会话；completeUpload 事务内再复核（会话早于定档发起时状态门禁不够）。
   * 已定档 → 幂等短路（200 原样返回，不写库 / 不递增版本 —— 抽屉开关重复点击 / 与文件定档并发都只生效一次）；version 不匹配 → 409 VERSION_CONFLICT。
   * 与文件定档（file.finalizeFile → markTaskFinalized）双入口并存：两条路径都只置位一次。
   */
  async finalize(projectId: string, taskId: string, body: TaskFinalizeBody, actorId: string): Promise<Task> {
    await this.loadProjectForWrite(projectId);
    const access = await this.permission.assertProjectVisible(actorId, projectId);
    const at = new Date();
    const today = shanghaiToday(at);
    const row = await this.database.db.transaction(async (tx) => {
      const before = await this.requireActiveTask(tx, projectId, taskId);
      this.assertCanManageTaskFinalization(actorId, before, access);
      if (before.finalizedAt !== null) {
        return before;
      }
      if (before.version !== body.version) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      if (before.status !== "done") {
        throw new AppError("TASK_FINALIZE_NOT_READY", "任务未完成，不能定档；请先将任务状态改为已完成", [
          { code: "task_not_done", message: "任务状态必须为已完成", path: "status" },
        ]);
      }
      if (before.deliverableTypes.length === 0) {
        throw new AppError("TASK_FINALIZE_NOT_READY", "任务未设定输出成果文件，不能定档；请先配置输出成果文件", [
          { code: "deliverable_types_required", message: "至少需要配置一类输出成果文件", path: "deliverableTypes" },
        ]);
      }
      const gate = await this.gate.evaluateFinalization(tx, before);
      if (gate.missing.length > 0) {
        throw this.requiredDocsMissingError(gate.missing, "定档");
      }
      const updated = await this.repository.updateWithVersion(
        taskId,
        body.version,
        { finalizedAt: at, finalizedBy: actorId },
        at,
        tx,
      );
      if (updated === null) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      await appendOutbox(tx, {
        topic: "task.finalized",
        dedupeKey: "task.finalized:" + taskId + ":" + updated.version,
        payload: {
          projectId,
          taskId,
          finalizedAt: at.toISOString(),
          finalizedBy: actorId,
          actorId,
          at: at.toISOString(),
        },
      });
      await this.repository.touchProject(projectId, at, tx);
      // 定档兜底（防绕过补漏）：撤销该任务在途的 version 上传会话（change = A4-13 唯一保留的修改通道，不撤）；
      // 漏网会话（如并发发起）由 completeUpload 的任务定档复核兜住。
      const abortedUploadSessions = await this.repository.abortActiveTaskUploadSessions(taskId, at, tx);
      await this.audit.record(tx, {
        actorId,
        action: "update",
        objectType: "task",
        objectId: taskId,
        projectId,
        summary: "任务定档：" + updated.title + "（此后不支持任何修改；文件修改走变更）",
        changes: [{ field: "finalizedAt", from: null, to: at.toISOString() }],
        metadata: { abortedUploadSessions },
      });
      return updated;
    });
    return toTaskView(row, today, await this.changeLinksOf(row));
  }

  /**
   * POST /projects/{id}/tasks/{taskId}/unfinalize：任务取消定档（Push 260 · 业务口径「把现在的定档改成 再次点击取消定档吧」）。
   * 口径：已定档且预计完成日期当天及之前 → 清空 finalized_at / finalized_by（version+1、留痕「取消定档」、outbox task.unfinalized、项目触点），
   * 任务重新开放修改（编辑 / 删除 / 文件写口恢复）；任务负责人遇到预计完成日期已过（Asia/Shanghai 今天晚于 planned_end）→ 409 TASK_UNFINALIZE_AFTER_PLAN，只能定档不能取消；
   * 项目经理及其他项目编辑者仍可取消定档；无预计完成日期不锁。
   * 文件级定档（files.status=final）不回退 —— 文件修改仍走变更（A4-13）。
   * 未定档 → 幂等短路（200 原样返回，不写库 / 不递增版本）；version 不匹配 → 409 VERSION_CONFLICT。
   * 操作记录（业务口径「点击定档按钮应该也要计入操作记录」）：定档 / 取消定档各留一条「任务」记录（action=update，摘要前缀「任务定档」/「取消定档」）。
   */
  async unfinalize(projectId: string, taskId: string, body: TaskUnfinalizeBody, actorId: string): Promise<Task> {
    await this.loadProjectForWrite(projectId);
    const access = await this.permission.assertProjectVisible(actorId, projectId);
    const at = new Date();
    const today = shanghaiToday(at);
    const row = await this.database.db.transaction(async (tx) => {
      const before = await this.requireActiveTask(tx, projectId, taskId);
      const capabilities = this.assertCanManageTaskFinalization(actorId, before, access);
      if (before.finalizedAt === null) {
        return before;
      }
      if (capabilities.source === "task_owner" && isUnfinalizeLockedByPlannedEnd(before.plannedEnd, today)) {
        throw new AppError("TASK_UNFINALIZE_AFTER_PLAN", "预计完成时间已过，任务负责人不能取消定档（项目经理仍可取消）", [
          { code: "unfinalize_after_planned_end", message: "预计完成日期：" + (before.plannedEnd ?? ""), path: "plannedEnd" },
        ]);
      }
      if (before.version !== body.version) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      const updated = await this.repository.updateWithVersion(
        taskId,
        body.version,
        { finalizedAt: null, finalizedBy: null },
        at,
        tx,
      );
      if (updated === null) {
        throw new AppError("VERSION_CONFLICT", "任务已被他人更新，请刷新后重试");
      }
      await appendOutbox(tx, {
        topic: "task.unfinalized",
        dedupeKey: "task.unfinalized:" + taskId + ":" + updated.version,
        payload: {
          projectId,
          taskId,
          unfinalizedAt: at.toISOString(),
          actorId,
          at: at.toISOString(),
        },
      });
      await this.repository.touchProject(projectId, at, tx);
      await this.audit.record(tx, {
        actorId,
        action: "update",
        objectType: "task",
        objectId: taskId,
        projectId,
        summary: "取消定档：" + updated.title + "（任务重新开放修改；文件修改仍走变更）",
        changes: [{ field: "finalizedAt", from: before.finalizedAt.toISOString(), to: null }],
      });
      return updated;
    });
    return toTaskView(row, today, await this.changeLinksOf(row));
  }

  /**
   * 门禁判定（ADR-024 / A4-20 · 2026-10-29 收敛）：
   * 1) 合并节点 required_doc 与任务 deliverable_types；配置了成果类型时，范围内存在任一已上传文件即可；
   * 2) 未配置任何成果类型时不要求文件，不能凭空增加“所有任务都必须有文件”的隐性约束。
   * 上传口径：files.status ∈ (draft, final, changed) 且 current_version_id 非空；draft 放行并给 R02 提醒。
   */
  private async evaluateGate(
    client: DbClient,
    task: TaskCompletionTargetRow,
  ): Promise<{ missing: TaskGateMissing[]; warnings: TaskGateWarning[] }> {
    const scope = { taskId: task.id, nodeId: task.nodeId };
    const nodeRequirements =
      task.nodeId === null ? [] : await this.gate.listNodeDocRequirements(client, task.nodeId);
    const requirements = mergeDeliveryRequirements(nodeRequirements, task.deliverableTypes);
    const uploaded = await this.gate.countUploadedFiles(client, scope);
    const missing: TaskGateMissing[] = missingDeliveryRequirements(requirements, uploaded).map((item) => ({
      docType: item.docType as TaskGateMissing["docType"],
      required: item.required,
      present: item.present,
    }));
    const warnings = buildDraftWarnings(await this.gate.countDraftFiles(client, scope));
    return { missing, warnings };
  }

  /**
   * 完成事件统一出口：完成提交 / PATCH 状态 / PATCH 进度 / 批量完成在首次进入 done 时共用同一事件与幂等键，
   * 避免只有 POST …/complete 触发 R02 而页面常态操作漏发。
   */
  private async appendCompletionOutbox(
    tx: DbClient,
    input: { projectId: string; task: TaskRow; warnings: TaskGateWarning[]; actorId: string; at: Date },
  ): Promise<void> {
    await appendOutbox(tx, {
      topic: "task.completed",
      dedupeKey: "task.completed:" + input.task.id + ":" + input.task.version,
      payload: {
        projectId: input.projectId,
        taskId: input.task.id,
        status: input.task.status,
        progress: Number(input.task.progress),
        actualEnd: input.task.actualEnd,
        warnings: input.warnings,
        actorId: input.actorId,
        at: input.at.toISOString(),
      },
    });
    if (input.warnings.length > 0) {
      await appendOutbox(tx, {
        topic: "task.draft_doc_reminded",
        dedupeKey: "task.draft_doc_reminded:" + input.task.id + ":" + input.task.version,
        payload: { projectId: input.projectId, taskId: input.task.id, warnings: input.warnings, actorId: input.actorId, at: input.at.toISOString() },
      });
    }
    await this.appendStageCompletionOutbox(tx, {
      projectId: input.projectId,
      task: input.task,
      actorId: input.actorId,
      at: input.at,
    });
  }

  /**
   * 大阶段完成群通知：只在本次任务首次转入 done 的同一事务内判定。
   * 阶段锁保证并发完成最后两项时只有后一笔看到“全部完成”；无任务 / 未分组阶段不发。
   * 每个项目每个阶段只播报一次：阶段回退后再次完成不重复发（永久送达留档 + outbox 稳定幂等键双保险）。
   */
  private async appendStageCompletionOutbox(
    tx: DbClient,
    input: { projectId: string; task: TaskRow; actorId: string; at: Date },
  ): Promise<void> {
    const stageKey = input.task.stageKey;
    if (stageKey === null || !(STAGE_KEYS as readonly string[]).includes(stageKey)) return;
    await this.repository.lockStageCompletion(tx, input.projectId, stageKey);
    const counts = await this.gate.evaluateDeliveryStatus(tx, input.projectId, stageKey);
    if (
      counts.total === 0 ||
      counts.done !== counts.total ||
      counts.deliveryReady !== counts.total
    ) {
      return;
    }
    if (await this.repository.hasSentStageCompletionNotice(tx, input.projectId, stageKey)) return;
    const stageName = (STAGE_NAMES as Record<string, string>)[stageKey] ?? stageKey;
    await appendOutboxIfAbsent(tx, {
      topic: "notify.group",
      dedupeKey: "stage.completed:" + input.projectId + ":" + stageKey,
      payload: {
        projectId: input.projectId,
        title: "阶段完成｜" + stageName,
        body: "「" + stageName + "」阶段 " + String(counts.total) + " 项小任务已全部完成，阶段里程碑达成。",
        refType: "task",
        refId: input.task.id,
        templateCode: "STAGE_COMPLETE_GROUP",
        stageKey,
      },
    });
  }

  /** 成果缺件错误（完成任务 / 定档共用）：422 + details.missing 口径一致。 */
  private requiredDocsMissingError(missing: readonly TaskGateMissing[], action: "完成任务" | "定档"): AppError {
    return new AppError(
      "TASK_REQUIRED_DOC_MISSING",
      "已配置的成果文件尚未上传，无法" + action + "（TASK_REQUIRED_DOC_MISSING）",
      missing.map((item) => ({
        code: "required_doc",
        message: "缺少已上传的成果文件：" + item.docType + "（需要 " + item.required + "，现有 " + item.present + "）",
        path: "missing",
        meta: { ...item },
      })),
    );
  }

  /** 事务内门禁强校验：已配置成果类型缺上传文件 → GateRejectedSignal（422 + missing）；通过 → 放行提示（R02）。拒绝留痕由调用方在事务外补写。 */
  private async assertCompletionGate(client: DbClient, task: TaskRow, at: Date, actorId: string): Promise<TaskGateWarning[]> {
    const gate = await this.evaluateGate(client, task);
    if (gate.missing.length > 0) {
      const rejection = this.requiredDocsMissingError(gate.missing, "完成任务");
      throw new GateRejectedSignal(rejection, {
        topic: "task.gate_rejected",
        dedupeKey: "task.gate_rejected:" + task.id + ":" + at.getTime(),
        payload: {
          taskId: task.id,
          projectId: task.projectId,
          nodeId: task.nodeId,
          missing: gate.missing,
          actorId,
          at: at.toISOString(),
        },
      });
    }
    return gate.warnings;
  }

  /** 门禁拒绝的事务外善后（照 FlowService 模式）：补写 outbox 留痕 + 审计 failed，再抛 422 契约错误；batchId 非空时审计标注批量入口（entry=batch）。 */
  private async runCompletionGuarded<T>(
    actorId: string,
    taskId: string,
    run: () => Promise<T>,
    batchId: string | null = null,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof GateRejectedSignal) {
        await appendOutbox(this.database.db, error.outbox);
        const projectId =
          typeof error.outbox.payload["projectId"] === "string" ? error.outbox.payload["projectId"] : null;
        await this.audit.record(this.database.db, {
          actorId,
          action: "complete",
          objectType: "task",
          objectId: taskId,
          projectId,
          result: "failed",
          summary: (batchId === null ? "" : "批量") + "任务完成被门禁拒绝：" + error.appError.message,
          metadata:
            batchId === null
              ? { errorCode: error.appError.code, details: error.appError.details }
              : { errorCode: error.appError.code, details: error.appError.details, entry: "batch", batchId },
        });
        throw error.appError;
      }
      throw error;
    }
  }

  /**
   * 创建时解析「要求输出成果文件」（A1-17 模板带出）：显式传入优先；缺省时从所属节点的 required_doc 类型带出；
   * 无节点任务缺省 = 空数组（不要求）。数组去重、首次出现保序。
   */
  private async resolveDeliverableTypes(
    client: DbClient,
    nodeId: string | null,
    requested: readonly string[] | undefined,
  ): Promise<string[]> {
    if (requested !== undefined) return normalizeDocTypes(requested);
    if (nodeId === null) return [];
    const requirements = await this.gate.listNodeDocRequirements(client, nodeId);
    return normalizeDocTypes(requirements.map((item) => item.docType));
  }

  private async moveWithinGroup(tx: DbClient, projectId: string, task: TaskRow, requested: number): Promise<number> {
    const rows = await this.repository.listGroupOrder(projectId, task.stageKey, tx, false, task.additionalStageNumber);
    const currentIndex = rows.findIndex((row) => row.id === task.id);
    const from = currentIndex >= 0 ? currentIndex : Number(task.sortIndex);
    const target = clampSortIndex(requested, rows.length - 1);
    if (target !== from) {
      if (target < from) {
        await this.repository.shiftGroupIndexes(projectId, task.stageKey, target, from - 1, 1, tx, task.additionalStageNumber);
      } else {
        await this.repository.shiftGroupIndexes(projectId, task.stageKey, from + 1, target, -1, tx, task.additionalStageNumber);
      }
    }
    return target;
  }

  /** 项目可见性：软删 / 不存在统一 404（记录级 404 语义随 h6 策略服务）。 */
  /** 写路径响应用：按任务行的 change_refs（追加序）取回关联变更，保证「编辑 / 完成」不改动已有变更关联。 */
  private async changeLinksOf(task: TaskRow): Promise<TaskChangeLinkRow[]> {
    return this.repository.listChangeLinks(task.changeRefs);
  }

  private async loadProjectOrFail(projectId: string, tx?: DbClient): Promise<TaskProjectRow> {
    const project = await this.repository.findProject(projectId, tx, tx !== undefined);
    if (project === null) throw new AppError("NOT_FOUND", "项目不存在或不可见");
    return project;
  }

  /** 归档项目只允许创建及处理未完成的手工临时任务。 */
  private async loadProjectForWrite(projectId: string, allowArchived = false, tx?: DbClient): Promise<TaskProjectRow> {
    const project = await this.loadProjectOrFail(projectId, tx);
    if (project.status === "archived" && !allowArchived) {
      throw new AppError("PROJECT_ARCHIVED", "项目已归档，禁止修改任务");
    }
    return project;
  }

  /** 阶段内手工创建无来源任务及锁定字段例外调整的管理员硬闸。 */
  private async assertAdmin(actorId: string, action: string): Promise<void> {
    if (await this.permission.canManageGroupAccess(actorId)) return;
    throw new AppError("FORBIDDEN", "仅管理员可" + action + "（系统功能书 A1-13）");
  }
}

function assertEndOnOrAfterStart(title: string, start: string | null, end: string | null, label: string): void {
  if (start !== null && end !== null && end < start) {
    throw new AppError("VALIDATION_FAILED", "任务「" + title + "」的" + label + "（" + end + "）早于开始日期（" + start + "）");
  }
}

function assertActualEnd(title: string, start: string | null, actualEnd: string | null, today: string): void {
  if (actualEnd !== null && actualEnd > today) {
    throw new AppError("VALIDATION_FAILED", "任务「" + title + "」的实际完成日期不能晚于今天（" + today + "）");
  }
  assertEndOnOrAfterStart(title, start, actualEnd, "实际完成日期");
}

function scheduleShiftDays(before: TaskRow, start: string | null, end: string | null): number {
  // 单字段改期跟随该字段，两端都变化时以预计完成日期为准。
  if (before.plannedEnd !== null && end !== null && end !== before.plannedEnd) {
    return (Date.parse(end) - Date.parse(before.plannedEnd)) / 86_400_000;
  }
  return before.plannedStart === null || start === null ? 0 : (Date.parse(start) - Date.parse(before.plannedStart)) / 86_400_000;
}

function shiftedPlanDate(title: string, date: string | null, days: number): string | null {
  if (date === null) return null;
  const shifted = addDays(date, days);
  if (!DateOnlySchema.safeParse(shifted).success) {
    throw new AppError("VALIDATION_FAILED", "任务「" + title + "」的顺延日期超出有效范围");
  }
  return shifted;
}

function isOpenTemporaryTask(task: TaskRow): boolean {
  return task.status !== "done" && isTemporaryTask(task);
}

/**
 * 批量条目错误降级（M3-04）：可预期的业务错误映射为 failures[] 条目（同批其它项照常处理）；
 * 非 AppError（程序缺陷 / 基础设施故障）返回 null —— 由 batch() 照旧抛出（500），避免系统错误被吞成「部分失败」。
 */
function toBatchFailure(taskId: string, error: unknown): TaskBatchFailure | null {
  if (!(error instanceof AppError)) return null;
  const message = error.message;
  switch (error.code) {
    case "NOT_FOUND":
      return { id: taskId, code: "not_found", message };
    case "PROJECT_ARCHIVED":
      return { id: taskId, code: "archived", message };
    case "TASK_REQUIRED_DOC_MISSING": {
      const missing = gateMissingFrom(error);
      return missing.length > 0
        ? { id: taskId, code: "gate_not_passed", message, missing }
        : { id: taskId, code: "gate_not_passed", message };
    }
    case "TASK_ALREADY_DONE":
      return { id: taskId, code: "already_done", message };
    case "VERSION_CONFLICT":
      return { id: taskId, code: "version_conflict", message };
    case "TASK_FINALIZED":
      return { id: taskId, code: "finalized", message };
    default:
      return error.httpStatus >= 400 && error.httpStatus < 500
        ? { id: taskId, code: "invalid_state", message }
        : null;
  }
}

/** 门禁缺件明细还原（assertCompletionGate 的 details[].meta → 契约 TaskGateMissing；缺 meta 的明细跳过）。 */
function gateMissingFrom(error: AppError): TaskGateMissing[] {
  const missing: TaskGateMissing[] = [];
  for (const detail of error.details) {
    const meta = detail.meta;
    if (meta === undefined) continue;
    const docType = meta["docType"];
    const required = meta["required"];
    const present = meta["present"];
    if (typeof docType !== "string" || typeof required !== "number" || typeof present !== "number") continue;
    const trimmed = docType.trim();
    if (trimmed === "") continue;
    missing.push({ docType: trimmed, required, present });
  }
  return missing;
}

/** 锁定字段快照（A1-17 例外调整留痕 · M3-05）：任务描述 / 输出成果文件 —— 不在 taskAuditSnapshot 内（后者只覆盖可编辑字段），故单列一份。 */
function lockedFieldsSnapshot(row: { title: string; titleEn: string | null; deliverableTypes: string[] }): Record<string, unknown> {
  return { title: row.title, titleEn: row.titleEn, deliverableTypes: normalizeDocTypes(row.deliverableTypes) };
}

/** 任务字段级留痕快照（C7-02：任务描述（Push 196 起临时任务可改）/ 负责人（多位）/ 状态 / 进度 / 组内位次 / 计划与实际日期 / 工期 / 人数 / 重要度 / 备注）。 */
function taskAuditSnapshot(row: {
  title: string;
  titleEn: string | null;
  ownerIds: string[];
  managerIds: string[];
  status: string;
  statusOverride: string | null;
  progress: string | number;
  sortIndex: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualEnd: string | null;
  estimatedDays: number | null;
  headcount: number | null;
  priority: string | null;
  deliverableTypes: string[];
  note: string | null;
}): Record<string, unknown> {
  return {
    title: row.title,
    titleEn: row.titleEn,
    ownerIds: row.ownerIds,
    managerIds: row.managerIds,
    status: row.status,
    statusOverride: row.statusOverride,
    progress: Number(row.progress),
    sortIndex: row.sortIndex,
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd,
    actualEnd: row.actualEnd,
    estimatedDays: row.estimatedDays,
    headcount: row.headcount,
    priority: row.priority,
    deliverableTypes: normalizeDocTypes(row.deliverableTypes),
    note: row.note,
  };
}

/** 行 → 契约视图：displayStatus / onTime 读时派生（A12 / A14），不写回存储。 */
function toTaskView(row: TaskRow, today: string, changeLinks: Task["changeLinks"]): Task {
  const input = {
    status: row.status,
    statusOverride: row.statusOverride,
    plannedEnd: row.plannedEnd,
    actualEnd: row.actualEnd,
    storedOnTime: row.onTime,
    today,
  };
  return {
    id: row.id,
    projectId: row.projectId,
    stageKey: row.stageKey as Task["stageKey"],
    ...(row.additionalStageNumber == null ? {} : { additionalStageNumber: row.additionalStageNumber }),
    sortIndex: row.sortIndex,
    nodeId: row.nodeId,
    sourceNodeId: row.taskNodeId,
    title: row.title,
    titleEn: row.titleEn,
    ownerIds: row.ownerIds,
    managerIds: row.managerIds,
    status: row.status as Task["status"],
    displayStatus: deriveDisplayStatus(input),
    progress: normalizeProgress(Number(row.progress)),
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd,
    actualEnd: row.actualEnd,
    estimatedDays: row.estimatedDays,
    headcount: row.headcount,
    priority: normalizePriority(row.priority),
    deliverableTypes: normalizeDocTypes(row.deliverableTypes),
    note: row.note,
    onTime: deriveOnTime(input),
    changeLinks,
    finalizedAt: row.finalizedAt === null ? null : row.finalizedAt.toISOString(),
    finalizedBy: row.finalizedBy,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 列表项：TaskListItem（Task + ownerNames / fileSummary；「变更关联」列吃 changeLinks 多条）。 */
function toListItem(row: TaskListRow, fileSummary: TaskFileSummaryCounts, today: string): TaskListItem {
  return {
    ...toTaskView(row.task, today, toChangeLinks(row.changeLinks)),
    ownerNames: row.ownerNames ?? [],
    managerNames: row.managerNames ?? [],
    fileSummary,
  };
}

/**
 * 字段级留痕（A1-10）：状态 / 进度 / 日期 / 备注四类；before / after 为 JSON（键 = 字段名，只记本次变化的字段）。
 * 2026-09-24 起「状态」含显式覆盖（status_override）：只改覆盖（如进行中 → 已延期）同样记 status_change，避免没有留痕。
 */
function buildEvents(before: TaskRow, after: TaskUpdatePatch): TaskEventInput[] {
  const events: TaskEventInput[] = [];
  const statusBefore: Record<string, string | null> = {};
  const statusAfter: Record<string, string | null> = {};
  if (after.status !== undefined && after.status !== before.status) {
    statusBefore.status = before.status;
    statusAfter.status = after.status;
  }
  if (after.statusOverride !== undefined && (after.statusOverride ?? null) !== (before.statusOverride ?? null)) {
    statusBefore.statusOverride = before.statusOverride ?? null;
    statusAfter.statusOverride = after.statusOverride;
  }
  if (Object.keys(statusAfter).length > 0) {
    events.push({
      taskId: before.id,
      eventType: "status_change",
      beforeValue: JSON.stringify(statusBefore),
      afterValue: JSON.stringify(statusAfter),
    });
  }
  if (after.progress !== undefined && Number(after.progress) !== Number(before.progress)) {
    events.push({
      taskId: before.id,
      eventType: "progress_change",
      beforeValue: JSON.stringify({ progress: Number(before.progress) }),
      afterValue: JSON.stringify({ progress: Number(after.progress) }),
    });
  }
  const dateBefore: Record<string, string | null> = {};
  const dateAfter: Record<string, string | null> = {};
  if (after.plannedStart !== undefined && after.plannedStart !== before.plannedStart) {
    dateBefore.plannedStart = before.plannedStart;
    dateAfter.plannedStart = after.plannedStart;
  }
  if (after.plannedEnd !== undefined && after.plannedEnd !== before.plannedEnd) {
    dateBefore.plannedEnd = before.plannedEnd;
    dateAfter.plannedEnd = after.plannedEnd;
  }
  if (after.actualEnd !== undefined && after.actualEnd !== before.actualEnd) {
    dateBefore.actualEnd = before.actualEnd;
    dateAfter.actualEnd = after.actualEnd;
  }
  if (Object.keys(dateAfter).length > 0) {
    events.push({
      taskId: before.id,
      eventType: "date_change",
      beforeValue: JSON.stringify(dateBefore),
      afterValue: JSON.stringify(dateAfter),
    });
  }
  if (after.note !== undefined && after.note !== before.note) {
    events.push({
      taskId: before.id,
      eventType: "note_change",
      beforeValue: JSON.stringify({ note: before.note }),
      afterValue: JSON.stringify({ note: after.note }),
    });
  }
  return events;
}

/** 变更关联项（A1-07 多条）：行上已按 change_refs 追加序取好；原因在服务端截短（列表短文本，全文在变更记录）。 */
function toChangeLinks(rows: readonly TaskChangeLinkRow[]): Task["changeLinks"] {
  return rows.map((row) => ({ id: row.id, reason: shortenChangeReason(row.reason), appliedAt: row.appliedAt }));
}

/** 变更原因短文本（列表用）：超长截断；详情跳变更记录看全文。 */
function shortenChangeReason(value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim();
  if (text === "") return null;
  return text.length > CHANGE_SUMMARY_MAX ? text.slice(0, CHANGE_SUMMARY_MAX) + "…" : text;
}

/** 进度归一化到离散五档（迁移 / 演示数据的任意小数先四舍五入到最近档，契约注释口径）。 */
function normalizeProgress(value: number): TaskProgress {
  const rounded = Math.round(value * 4) / 4;
  if (rounded === 0 || rounded === 0.25 || rounded === 0.5 || rounded === 0.75 || rounded === 1) {
    return rounded;
  }
  return 0;
}

function normalizePriority(value: string | null): Task["priority"] {
  if (value === null) return null;
  return (PRIORITY_VALUES as readonly string[]).includes(value) ? (value as Task["priority"]) : null;
}

/** 文件侧单值类型归一（files.doc_type）：去首尾空白，空值回落 null；内置与自定义类型均原样保留。 */
function normalizeDocType(value: string | null): Task["deliverableTypes"][number] | null {
  if (value === null) return null;
  const parsed = DeliverableTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 成果类型归一 + 去重（首次出现保序）—— ADR-024：内置十类与自定义名称均可，空数组 = 不要求。 */
function normalizeDocTypes(values: readonly string[]): Task["deliverableTypes"] {
  const seen = new Set<string>();
  const result: Task["deliverableTypes"] = [];
  for (const value of values) {
    const parsed = DeliverableTypeSchema.safeParse(value);
    if (!parsed.success || seen.has(parsed.data)) continue;
    seen.add(parsed.data);
    result.push(parsed.data);
  }
  return result;
}

/** 放行提示（A2-10 / R02）：存在未定档（draft）成果文件时按内置字典顺序、其后自定义顺序出 warning（计数 > 0 才出）。 */
function buildDraftWarnings(rows: readonly TaskGateDocCountRow[]): TaskGateWarning[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.docType !== null) counts.set(row.docType, row.present);
  }
  const docTypes = [...DOC_TYPES, ...[...counts.keys()].filter((docType) => !(DOC_TYPES as readonly string[]).includes(docType))];
  const warnings: TaskGateWarning[] = [];
  for (const docType of docTypes) {
    const count = counts.get(docType) ?? 0;
    if (count > 0) warnings.push({ code: "draft_doc_present", docType, count });
  }
  return warnings;
}
