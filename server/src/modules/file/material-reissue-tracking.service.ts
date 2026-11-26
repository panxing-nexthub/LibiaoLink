import { Injectable } from "@nestjs/common";
import {
  CreateMaterialReissueTrackingBodySchema,
  MaterialReissueTrackingResultSchema,
  UpdateMaterialReissueTrackingBodySchema,
  z,
} from "@libiaolink/contracts";
import type { MaterialReissueTrackingEntry, UpdateMaterialReissueTrackingBody } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { ClockService } from "../../common/clock/clock.service.js";
import { DatabaseService } from "../../db/database.service.js";
import { AuditService } from "../admin/index.js";
import { PermissionService, isProjectEditor } from "../permission/index.js";
import { FileRepository } from "./file.repository.js";

type CreateBody = z.infer<typeof CreateMaterialReissueTrackingBodySchema>;
type UpdateBody = UpdateMaterialReissueTrackingBody;
type Result = z.infer<typeof MaterialReissueTrackingResultSchema>;

function textOrNull(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

function textOrNullValue(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const text = value.trim();
  return text === "" ? null : text;
}

/**
 * 物料补发发货登记（2026-11-25）：补发页跨申请单勾选物料行后，一次写入已发货 / 已签收状态、
 * 快递单号、预计到货时间、发货备注与凭证图片；读面随 change_requests.materialReissueTracking 返回。
 *
 * 权限：项目编辑者、项目助理（物流任务负责人）或该补发申请来源任务的当前负责人；
 * 项目助理与项目编辑者一样可登记本项目全部申请单；
 * 一次批量可跨多张申请单，逐张变更行在事务内锁行，已登记过的物料行拒绝重复登记。
 */
@Injectable()
export class MaterialReissueTrackingService {
  constructor(
    private readonly repository: FileRepository,
    private readonly database: DatabaseService,
    private readonly permission: PermissionService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  async register(projectId: string, body: CreateBody, actorId: string): Promise<Result> {
    const access = await this.permission.assertProjectVisible(actorId, projectId);
    const imageFileIds = [...new Set([...(body.imageFileIds ?? []), ...(body.imageFileId === undefined ? [] : [body.imageFileId])])];
    for (const imageFileId of imageFileIds) {
      const image = await this.repository.findFileById(imageFileId);
      if (image === null || image.projectId !== projectId || image.recycledAt !== null) {
        throw new AppError("VALIDATION_FAILED", "发货凭证图片不存在、不属于当前项目或已回收", [
          { code: "invalid_image", message: "imageFileIds 必须属于当前项目且未回收", path: "imageFileIds" },
        ]);
      }
    }

    const unique = new Map<string, { changeRequestId: string; lineIndex: number }>();
    for (const item of body.items) {
      unique.set(item.changeRequestId + ":" + String(item.lineIndex), item);
    }
    const groups = new Map<string, number[]>();
    for (const item of unique.values()) {
      const lineIndexes = groups.get(item.changeRequestId);
      if (lineIndexes === undefined) {
        groups.set(item.changeRequestId, [item.lineIndex]);
      } else {
        lineIndexes.push(item.lineIndex);
      }
    }

    const at = this.clock.now();
    const entries: MaterialReissueTrackingEntry[] = [];
    await this.database.db.transaction(async (tx) => {
      const editor = isProjectEditor(access);
      const projectAssistant = !editor && await this.repository.isMaterialReissueProjectAssistant(projectId, actorId, tx);
      for (const [changeRequestId, lineIndexes] of groups) {
        const change = await this.repository.lockChangeRequest(changeRequestId, tx);
        if (change === null || change.projectId !== projectId) {
          throw new AppError("NOT_FOUND", "变更记录不存在或不属于当前项目");
        }
        if (change.changeType !== "material_reissue" || change.materialReissue === null) {
          throw new AppError("VALIDATION_FAILED", "仅物料补发记录可以登记发货");
        }
        if (!editor && !projectAssistant) {
          const task = await this.repository.findTaskReissueBrief(change.materialReissue.taskId, tx);
          if (task === null || task.deletedAt !== null || task.projectId !== projectId || !task.ownerIds.includes(actorId)) {
            throw new AppError("FORBIDDEN", "仅项目编辑者、项目助理或当前任务负责人可登记发货");
          }
        }
        const materials = change.materialReissue.materials;
        for (const lineIndex of lineIndexes) {
          if (lineIndex >= materials.length) {
            throw new AppError("VALIDATION_FAILED", "补发物料行不存在", [
              { code: "invalid_line", message: "lineIndex 超出补发清单范围", path: "items" },
            ]);
          }
        }
        const existing = change.materialReissueTracking ?? [];
        const existingIndexes = new Set(existing.map((entry) => entry.lineIndex));
        for (const lineIndex of lineIndexes) {
          if (existingIndexes.has(lineIndex)) {
            throw new AppError("VERSION_CONFLICT", "所选物料已登记发货，请刷新后重试", [
              { code: "already_tracked", message: "该物料行已有发货登记", path: "items" },
            ]);
          }
        }
        const newEntries: MaterialReissueTrackingEntry[] = [...new Set(lineIndexes)]
          .sort((left, right) => left - right)
          .map((lineIndex) => ({
            changeRequestId,
            lineIndex,
            status: body.status,
            trackingNo: textOrNull(body.trackingNo),
            estimatedArrivalDate: body.estimatedArrivalDate ?? null,
            note: textOrNull(body.note),
            imageFileId: imageFileIds[0] ?? null,
            imageFileIds,
            shippedBy: actorId,
            shippedAt: at.toISOString(),
            updatedAt: at.toISOString(),
          }));
        const tracking = [...existing, ...newEntries].sort((left, right) => left.lineIndex - right.lineIndex);
        await this.repository.updateChangeRequestTracking(changeRequestId, tracking, tx);
        entries.push(...newEntries);
        await this.audit.record(tx, {
          actorId,
          action: "update",
          objectType: "change",
          objectId: changeRequestId,
          projectId,
          summary: "物料补发发货登记：" + String(newEntries.length) + " 项",
          metadata: {
            status: body.status,
            trackingNo: textOrNull(body.trackingNo),
            estimatedArrivalDate: body.estimatedArrivalDate ?? null,
            note: textOrNull(body.note),
            imageFileIds,
            lineIndexes: newEntries.map((entry) => entry.lineIndex),
          },
        });
      }
    });
    return { items: entries };
  }

  /** 修改单条已登记发货行（快递单号 / 预计到货 / 发货备注 / 状态）；权限与登记一致。 */
  async update(projectId: string, body: UpdateBody, actorId: string): Promise<Result> {
    const access = await this.permission.assertProjectVisible(actorId, projectId);
    const at = this.clock.now();
    let updated: MaterialReissueTrackingEntry | null = null;
    await this.database.db.transaction(async (tx) => {
      const editor = isProjectEditor(access);
      const projectAssistant = !editor && await this.repository.isMaterialReissueProjectAssistant(projectId, actorId, tx);
      const change = await this.repository.lockChangeRequest(body.changeRequestId, tx);
      if (change === null || change.projectId !== projectId) {
        throw new AppError("NOT_FOUND", "变更记录不存在或不属于当前项目");
      }
      if (change.changeType !== "material_reissue" || change.materialReissue === null) {
        throw new AppError("VALIDATION_FAILED", "仅物料补发记录可以修改发货信息");
      }
      if (!editor && !projectAssistant) {
        const task = await this.repository.findTaskReissueBrief(change.materialReissue.taskId, tx);
        if (task === null || task.deletedAt !== null || task.projectId !== projectId || !task.ownerIds.includes(actorId)) {
          throw new AppError("FORBIDDEN", "仅项目编辑者、项目助理或当前任务负责人可修改发货信息");
        }
      }
      if (body.lineIndex >= change.materialReissue.materials.length) {
        throw new AppError("VALIDATION_FAILED", "补发物料行不存在", [
          { code: "invalid_line", message: "lineIndex 超出补发清单范围", path: "lineIndex" },
        ]);
      }
      const existing = change.materialReissueTracking ?? [];
      const index = existing.findIndex((entry) => entry.lineIndex === body.lineIndex);
      if (index < 0) {
        throw new AppError("NOT_FOUND", "该物料行尚未登记发货");
      }
      const entry = existing[index];
      if (entry === undefined) {
        throw new AppError("NOT_FOUND", "该物料行尚未登记发货");
      }
      const next: MaterialReissueTrackingEntry = {
        ...entry,
        status: body.status ?? entry.status,
        trackingNo: body.trackingNo === undefined ? entry.trackingNo : textOrNullValue(body.trackingNo),
        estimatedArrivalDate: body.estimatedArrivalDate === undefined ? entry.estimatedArrivalDate : body.estimatedArrivalDate,
        note: body.note === undefined ? entry.note : textOrNullValue(body.note),
        updatedAt: at.toISOString(),
      };
      const tracking = existing.map((item, itemIndex) => (itemIndex === index ? next : item));
      await this.repository.updateChangeRequestTracking(body.changeRequestId, tracking, tx);
      updated = next;
      await this.audit.record(tx, {
        actorId,
        action: "update",
        objectType: "change",
        objectId: body.changeRequestId,
        projectId,
        summary: "物料补发发货信息修改：1 项",
        metadata: {
          lineIndex: next.lineIndex,
          status: next.status,
          trackingNo: next.trackingNo,
          estimatedArrivalDate: next.estimatedArrivalDate,
          note: next.note,
        },
      });
    });
    return { items: updated === null ? [] : [updated] };
  }
}
