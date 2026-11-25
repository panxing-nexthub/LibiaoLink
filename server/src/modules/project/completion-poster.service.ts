import { Injectable } from "@nestjs/common";
import type { ProjectCompletionPosterSendResult, ProjectCompletionPosterStatus } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../../db/database.service.js";
import { appendOutboxIfAbsent } from "../../db/outbox.js";
import { ArchiveRepository } from "./archive.repository.js";
import { ProjectRepository } from "./project.repository.js";

/**
 * 项目完成喜报（R06）群同步（2026-11-25 业务口径）：
 * 验收完成后由用户确认是否同步到项目群；归档不再自动发喜报；
 * 同一项目成功同步过一次后，后续不再重复发送。
 */
@Injectable()
export class ProjectCompletionPosterService {
  constructor(
    private readonly database: DatabaseService,
    private readonly projects: ProjectRepository,
    private readonly archive: ArchiveRepository,
  ) {}

  async status(projectId: string): Promise<ProjectCompletionPosterStatus> {
    await this.requireProject(projectId);
    const sent = await this.archive.findSentCompletionPoster(this.database.db, projectId);
    return { sent: sent !== null, sentAt: sent?.sentAt?.toISOString() ?? null };
  }

  async send(projectId: string, _actorId: string): Promise<ProjectCompletionPosterSendResult> {
    const view = await this.requireProject(projectId);
    if (view.project.status === "archived" && (view.archiveKind ?? "accepted") === "unaccepted") {
      throw new AppError("VALIDATION_FAILED", "异常归档项目不能同步完成喜报");
    }
    const sent = await this.archive.findSentCompletionPoster(this.database.db, projectId);
    if (sent !== null) return { status: "already_sent" };

    let alreadySent = false;
    await this.database.db.transaction(async (tx) => {
      const unfinished = await this.archive.listUnfinishedTasks(tx, projectId);
      const hasAcceptance = await this.archive.hasCompletedAcceptanceTask(tx, projectId);
      if (unfinished.length > 0) {
        throw new AppError("VALIDATION_FAILED", "项目还有 " + String(unfinished.length) + " 项任务未完成，不能同步完成喜报", [
          { code: "task_not_done", message: "请先完成项目全部任务", path: "status" },
        ]);
      }
      if (!hasAcceptance) {
        throw new AppError("VALIDATION_FAILED", "验收阶段尚无已完成的任务，不能同步完成喜报", [
          { code: "acceptance_missing", message: "请先完成验收阶段任务", path: "status" },
        ]);
      }
      if ((await this.archive.findSentCompletionPoster(tx, projectId)) !== null) {
        alreadySent = true;
        return;
      }
      const label =
        view.project.code === ""
          ? view.project.name
          : view.project.name === ""
            ? view.project.code
            : view.project.code + "·" + view.project.name;
      await appendOutboxIfAbsent(tx, {
        topic: "notify.group",
        dedupeKey: "R06:" + projectId,
        payload: {
          projectId,
          title: "🎉 叮咚~喜报来啦！",
          body: "项目：**" + label + "**\n项目已全部完成，验收交付完毕。大家一起为这份成果喝彩吧",
          refType: "project",
          refId: projectId,
          templateCode: "R06_GROUP",
        },
      });
    });
    return { status: alreadySent ? "already_sent" : "queued" };
  }

  private async requireProject(projectId: string) {
    const view = await this.projects.findViewById(projectId);
    if (view === null) throw new AppError("NOT_FOUND", "项目不存在或不可见");
    return view;
  }
}