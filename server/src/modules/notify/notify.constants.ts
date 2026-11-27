/** 站内信投递事件主题（契约 `OUTBOX_TOPICS` 白名单成员；Push 169 定案时为「已定案预留」，S7-4 规则接线 Push 180 起为写入端 + 本模块消费侧接线）。 */
export const NOTIFY_MESSAGE_TOPIC = "notify.message" as const;

/** 群播报投递事件主题（M5-03-2 接线段起为写入端 + 本模块消费侧接线：automation-wiring 产出 / 群通道消费）。 */
export const NOTIFY_GROUP_TOPIC = "notify.group" as const;

export const STAGE_COMPLETE_GROUP_TEMPLATE = "STAGE_COMPLETE_GROUP";
export const STAGE_ADVANCED_GROUP_TEMPLATE = "A08_GROUP";

/** 同一个项目原阶段的手动群播报共用一条 outbox 记录。 */
export function stageCompletionNoticeKey(projectId: string, stageKey: string): string {
  return "stage.completed.manual:" + projectId + ":" + stageKey;
}
