import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { UuidSchema } from "@libiaolink/contracts";
import { ClockService } from "../../common/clock/clock.service.js";
import { AppConfig } from "../../config/config.module.js";
import { DatabaseService } from "../../db/database.service.js";
import { AuditService } from "../audit/index.js";
import { PermissionService } from "../permission/index.js";
import { NotifyDmService } from "./notify.dm.service.js";
import { NotifyGroupRepository } from "./notify.group.repository.js";
import { NotifyGroupService } from "./notify.group.service.js";
import { WecomProjectAccessRepository } from "./wecom-project-access.repository.js";
import { matchesGroupButtonCardClick, WecomAibotClient, type AibotIncomingMessage } from "./wecom.aibot.js";

const ISSUE_COMMAND = "发放项目只读授权卡";
const CLAIM_BUTTON = "claim-project-view";
const CARD_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class WecomProjectAccessService {
  private readonly logger = new Logger(WecomProjectAccessService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly clock: ClockService,
    private readonly groups: NotifyGroupRepository,
    private readonly groupNotify: NotifyGroupService,
    private readonly dmNotify: NotifyDmService,
    private readonly permission: PermissionService,
    private readonly repository: WecomProjectAccessRepository,
    private readonly audit: AuditService,
    private readonly aibot: WecomAibotClient,
  ) {}

  /** 消费本功能的群命令和按钮，其余回调交回 worker 的原有分流。 */
  async handle(incoming: AibotIncomingMessage): Promise<boolean> {
    const { chatid, fromUserId } = incoming;
    const botId = this.config.env.WECOM_BOT_ID;
    if (
      this.config.env.WECOM_PROJECT_GROUP_ACCESS_ENABLED !== "true" ||
      botId === "" || incoming.chattype !== "group" || chatid === null || fromUserId === null
    ) return false;

    const text = incoming.text?.trim().replace(/^(?:<@[^>]+>|@\S+)\s+/u, "").trim();
    if (incoming.cmd === "aibot_msg_callback" && incoming.msgtype === "text" && text === ISSUE_COMMAND) {
      await this.groupNotify.activateFromCallback(incoming);
      await this.issue(incoming, chatid, fromUserId, botId);
      return true;
    }

    const click = incoming.templateCardClick;
    if (incoming.cmd !== "aibot_event_callback" || incoming.eventType !== "template_card_event" ||
      click?.eventKey !== CLAIM_BUTTON) return false;
    const cardId = UuidSchema.safeParse(click.taskId);
    if (!cardId.success || !matchesGroupButtonCardClick(incoming, {
      botId, chatid, taskId: cardId.data, eventKey: CLAIM_BUTTON,
    })) return true;

    const outcome = await this.database.db.transaction(async (tx) => {
      const grant = await this.repository.claim({
        cardId: cardId.data, botId, chatid, wecomUserId: fromUserId, at: this.clock.now(),
      }, tx);
      if (grant?.kind === "granted") {
        await this.audit.record(tx, {
          actorId: grant.userId,
          action: "create",
          entry: "system",
          objectType: "project",
          objectId: grant.projectId,
          projectId: grant.projectId,
          summary: "领取企微项目群只读授权",
          metadata: { operation: "wecom_project_read_grant", issuedBy: grant.issuedBy },
        });
      }
      return grant?.kind;
    });
    if (outcome === undefined || incoming.reqId === null) return true;

    const result = await this.aibot.updateGroupCardForUser({
      reqId: incoming.reqId,
      chatid,
      userid: fromUserId,
      card: outcome === "unbound"
        ? {
            card_type: "button_interaction",
            task_id: cardId.data,
            main_title: { title: "请先绑定企业微信", desc: "在系统设置绑定企微，完成后回来领取。" },
            button_list: [{ text: "绑定后再领取", key: CLAIM_BUTTON, style: 1 }],
          }
        : {
            card_type: "text_notice",
            task_id: cardId.data,
            main_title: { title: "已领取项目只读权限", desc: "点击卡片，打开 LibiaoLink 项目空间。" },
            card_action: { type: 1, url: this.config.env.PUBLIC_APP_BASE_URL.replace(/\/+$/u, "") + "/#/projects" },
          },
    });
    if (!result.ok) {
      this.logger.warn("企微授权卡提示未确认送达：" + result.kind + " / errcode=" + (result.errcode ?? "无"));
    }
    return true;
  }

  private async issue(incoming: AibotIncomingMessage, chatid: string, fromUserId: string, botId: string): Promise<void> {
    const group = await this.groups.findGroupByChatid(chatid);
    const actorId = await this.dmNotify.resolveReportQueryActor(fromUserId);
    const access = group === null || actorId === null
      ? null
      : await this.permission.resolveProjectAccess(actorId, group.projectId);
    if (group === null || !group.enabled || group.activatedAt === null || actorId === null || access === null ||
        !(await this.permission.can(actorId, "member.manage", access))) {
      await this.reply(incoming, chatid, fromUserId, "请由已绑定企微且有项目成员管理权限的账号在已绑定项目群内发卡。");
      return;
    }

    const id = randomUUID();
    await this.repository.insertCard({
      id,
      groupId: group.id,
      groupEpoch: group.accessEpoch,
      botId,
      issuedBy: actorId,
      expiresAt: new Date(this.clock.now().getTime() + CARD_TTL_MS),
    });
    const result = await this.aibot.sendGroupButtonCard({
      chatid,
      groupActivated: true,
      card: {
        card_type: "button_interaction",
        main_title: {
          title: "领取项目只读权限",
          desc: "请先在 LibiaoLink 绑定企业微信。点击领取后，在项目空间查看项目。本卡 24 小时内有效。",
        },
        button_list: [{ text: "领取只读权限", key: CLAIM_BUTTON, style: 1 }],
        task_id: id,
      },
    });
    if (!result.ok) await this.reply(incoming, chatid, fromUserId, "本次发卡未确认送达，请稍后重试。");
  }

  private async reply(incoming: AibotIncomingMessage, chatid: string, userid: string, content: string): Promise<void> {
    if (incoming.reqId === null) return;
    await this.aibot.replyToCallback({ reqId: incoming.reqId, chatid, userid, content });
  }
}
