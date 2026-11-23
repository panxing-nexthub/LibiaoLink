#!/usr/bin/env node
/**
 * 用独立测试机器人向已激活的测试群发一张卡片，不写项目数据。
 * 在 server/ 先运行 npm run build，再运行 node scripts/wecom-group-card-probe.mjs。
 * 两位原群成员先各发一条 @机器人 测试消息，再各点击一次，按参与者编号核对文本和点击。
 * 最后尝试把同一张卡片转到其他群及私聊，记录群外点击是否有回调。探针不会更新卡片。
 */
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnv } from "../dist/config/env.js";
import {
  createWecomAibotClientFromEnv,
  matchesGroupButtonCardClick,
} from "../dist/modules/notify/wecom.aibot.js";

const botId = process.env.WECOM_CARD_PROBE_BOT_ID?.trim();
const secret = process.env.WECOM_CARD_PROBE_BOT_SECRET?.trim();
const chatid = process.env.WECOM_CARD_PROBE_CHATID?.trim();
if (!botId || !secret || !chatid) {
  console.error("请通过进程环境提供独立测试机器人的 WECOM_CARD_PROBE_BOT_ID、WECOM_CARD_PROBE_BOT_SECRET 和测试群的 WECOM_CARD_PROBE_CHATID。");
  process.exit(2);
}

const env = loadEnv({
  // The shared config validator requires a URL, but this probe does not open a database connection.
  DATABASE_URL: "postgresql://127.0.0.1:1/unused",
  WECOM_BOT_ID: botId,
  WECOM_BOT_SECRET: secret,
});
const { aibot } = createWecomAibotClientFromEnv(env);
const expected = { botId, chatid, taskId: "group-card-probe_" + randomUUID(), eventKey: "verify" };
const participants = new Map();
const groupSenders = new Set();
const matchingSenders = new Set();
let observedClicks = 0;

function participantOf(userId) {
  if (userId === null) return null;
  if (!participants.has(userId)) participants.set(userId, participants.size + 1);
  return participants.get(userId);
}

const unsubscribe = aibot.onMessage((message) => {
  if (
    message.cmd === "aibot_msg_callback" && message.msgtype === "text" &&
    message.chattype === "group" && message.chatid === chatid && message.fromUserId !== null &&
    !groupSenders.has(message.fromUserId)
  ) {
    groupSenders.add(message.fromUserId);
    console.log(JSON.stringify({ event: "原群文本", participant: participantOf(message.fromUserId) }));
  }
  if (message.eventType !== "template_card_event") return;

  const click = message.templateCardClick;
  const matches = matchesGroupButtonCardClick(message, expected);
  observedClicks += 1;
  if (matches && message.fromUserId !== null) matchingSenders.add(message.fromUserId);
  console.log(JSON.stringify({
    event: "卡片点击",
    participant: participantOf(message.fromUserId),
    conversation: message.chatid === chatid ? "原群" : message.chatid === null ? "无群标识" : "其他群",
    groupEvent: message.chattype === "group",
    hasMessageId: Boolean(message.msgid),
    botMatches: click?.botId === botId,
    cardMatches: click?.taskId === expected.taskId,
    buttonMatches: click?.eventKey === expected.eventKey,
    matches,
  }));
});

const controller = new AbortController();
const abort = () => controller.abort();
process.once("SIGINT", abort);
process.once("SIGTERM", abort);
try {
  aibot.start();
  if (!(await aibot.waitForSubscribed(15_000))) {
    console.error("测试机器人订阅超时。");
    process.exitCode = 1;
  } else {
    const sent = await aibot.sendGroupButtonCard({
      chatid,
      groupActivated: true,
      card: {
        card_type: "button_interaction",
        main_title: { title: "LibiaoLink 卡片协议测试", desc: "点击仅验证企微回调，不授予项目权限。" },
        button_list: [{ text: "测试点击", key: expected.eventKey, style: 1 }],
        task_id: expected.taskId,
      },
    });
    if (!sent.ok) {
      console.error(JSON.stringify({ event: "发卡失败", kind: sent.kind, errcode: sent.errcode }));
      process.exitCode = 1;
    } else {
      console.log("测试卡片已受理。等待三分钟，期间可用两位原群成员点击，再由群外账号尝试点击转发卡片。");
      await delay(180_000, undefined, { signal: controller.signal }).catch((error) => {
        if (error?.name !== "AbortError") throw error;
      });
      console.log(JSON.stringify({
        event: "结束",
        observedClicks,
        matchingParticipants: matchingSenders.size,
        matchingGroupTextParticipants: [...matchingSenders].filter((userId) => groupSenders.has(userId)).length,
      }));
    }
  }
} finally {
  process.off("SIGINT", abort);
  process.off("SIGTERM", abort);
  unsubscribe();
  await aibot.stop();
}
