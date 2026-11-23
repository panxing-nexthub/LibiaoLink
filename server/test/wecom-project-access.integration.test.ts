import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { STAGE_KEYS } from "@libiaolink/contracts";
import { AppModule } from "../src/app.module.js";
import { loadEnv } from "../src/config/env.js";
import { DatabaseService } from "../src/db/database.service.js";
import { auditLogs } from "../src/db/schema/admin.js";
import { users } from "../src/db/schema/identity.js";
import { wecomAibotDmActivations, wecomGroups, wecomProjectAccessCards, wecomProjectReadGrants } from "../src/db/schema/notify.js";
import { projectMembers, projects } from "../src/db/schema/projects.js";
import { SessionService } from "../src/modules/identity/session.service.js";
import { WecomAibotClient, WecomProjectAccessService, type AibotIncomingMessage } from "../src/modules/notify/index.js";
import { ProjectGroupRepository } from "../src/modules/project/project-group.repository.js";

const databaseUrl = process.env.WECOM_PROJECT_ACCESS_TEST_DATABASE_URL;
const suffix = randomUUID().slice(0, 8);
const botId = "test-bot-" + suffix;
const chatid = "test-group-" + suffix;
const otherChatid = "other-group-" + suffix;

function message(overrides: Partial<AibotIncomingMessage>): AibotIncomingMessage {
  return {
    cmd: "aibot_msg_callback",
    reqId: "request-id",
    chatid,
    chattype: "group",
    fromUserId: "issuer",
    msgid: "message-id",
    msgtype: "text",
    text: "<@robot> 发放项目只读授权卡",
    eventType: null,
    ...overrides,
  };
}

describe.skipIf(!databaseUrl)("企微项目只读授权（独立 PostgreSQL + HTTP）", () => {
  let app: INestApplication;
  const sendGroupButtonCard = vi.fn<WecomAibotClient["sendGroupButtonCard"]>().mockResolvedValue({ ok: true, attempts: 1 });
  const replyToCallback = vi.fn<WecomAibotClient["replyToCallback"]>().mockResolvedValue({ ok: true, attempts: 1 });
  const updateGroupCardForUser = vi.fn<WecomAibotClient["updateGroupCardForUser"]>()
    .mockResolvedValue({ ok: true, attempts: 1 });

  beforeAll(async () => {
    const env = loadEnv({
      DATABASE_URL: databaseUrl,
      LOG_LEVEL: "silent",
      GROUP_ACCESS_ENFORCED: "true",
      GROUP_ACCESS_ADMIN_USER_IDS: randomUUID(),
      WECOM_BOT_ID: botId,
      WECOM_PROJECT_GROUP_ACCESS_ENABLED: "true",
    });
    const module = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
      .overrideProvider(WecomAibotClient)
      .useValue({ sendGroupButtonCard, replyToCallback, updateGroupCardForUser })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("授权发卡、拒绝错误来源，并发重复领取只生效一次且 HTTP 不允许写", async () => {
    const service = app.get(WecomProjectAccessService);
    const database = app.get(DatabaseService);
    const names = ["issuer", "reader", "second-reader", "disabled", "rebound"] as const;
    const actorIds = Object.fromEntries(names.map((name) => [name, randomUUID()])) as Record<typeof names[number], string>;
    await database.db.insert(users).values(names.map((name) => ({
      id: actorIds[name],
      username: name + "-" + suffix,
      casdoorId: name + "-" + suffix,
      displayName: name,
      status: name === "disabled" ? "disabled" : "active",
    })));
    await database.db.insert(wecomAibotDmActivations).values(names
      .filter((name) => name !== "rebound" && name !== "second-reader")
      .map((name) => ({ botId, wecomUserid: name, userId: actorIds[name], boundAt: new Date() })));
    await database.db.insert(wecomAibotDmActivations).values({ botId, wecomUserid: "second-reader" });

    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    await database.db.insert(projects).values([projectId, otherProjectId].map((id) => ({
      id, code: "test-" + id, name: "企微只读授权测试", region: "中国", projectType: "implementation",
      managerIds: [actorIds.issuer], stageKey: STAGE_KEYS[0], status: "active",
    })));
    const [binding] = await database.db.insert(wecomGroups).values({ projectId, chatid }).returning();
    expect(binding).toBeDefined();

    const sessions = app.get(SessionService);
    const { token } = await sessions.create({
      userId: actorIds.reader,
      idToken: "local-session-fixture",
      expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    const api = request(app.getHttpServer());
    const cookie = "ll_sid=" + token + "; ll_csrf=fixture";
    const path = "/api/v1/projects/" + projectId;
    const read = () => api.get(path).set("Cookie", cookie);

    await read().expect(404);
    await service.handle(message({ fromUserId: "reader" }));
    expect(sendGroupButtonCard).not.toHaveBeenCalled();
    await service.handle(message({ chatid: otherChatid }));
    expect(sendGroupButtonCard).not.toHaveBeenCalled();
    await service.handle(message({}));
    const card = sendGroupButtonCard.mock.calls[0]![0].card;
    expect(sendGroupButtonCard).toHaveBeenCalledTimes(1);
    replyToCallback.mockClear();
    const click = (fromUserId: string, overrides: Partial<AibotIncomingMessage> = {}) => message({
      cmd: "aibot_event_callback",
      msgtype: "event",
      eventType: "template_card_event",
      text: null,
      fromUserId,
      templateCardClick: { botId, taskId: card.task_id, eventKey: card.button_list[0]!.key },
      ...overrides,
    });
    const grants = () => database.db.select().from(wecomProjectReadGrants)
      .where(eq(wecomProjectReadGrants.groupId, binding!.id));
    const audit = () => database.db.select().from(auditLogs).where(and(
      eq(auditLogs.projectId, projectId),
      sql`${auditLogs.metadata}->>'operation' = 'wecom_project_read_grant'`,
    ));
    for (const event of [
      click("reader", { chatid: otherChatid }),
      click("reader", { chattype: "single" }),
      click("reader", { msgid: null }),
      click("reader", { templateCardClick: { ...click("reader").templateCardClick!, botId: "wrong-bot" } }),
      click("reader", { templateCardClick: { ...click("reader").templateCardClick!, taskId: randomUUID() } }),
      click("reader", { templateCardClick: { ...click("reader").templateCardClick!, eventKey: "wrong-button" } }),
      click("disabled"),
      click("unbound", { chatid: otherChatid }),
      click("unbound", { reqId: null }),
    ]) await service.handle(event);
    expect(updateGroupCardForUser).not.toHaveBeenCalled();

    await service.handle(click("unbound", { reqId: "unbound-click" }));
    await service.handle(click("second-reader", { reqId: "activated-but-unbound-click" }));
    expect(updateGroupCardForUser).toHaveBeenCalledTimes(2);
    expect(updateGroupCardForUser).toHaveBeenLastCalledWith({
      reqId: "activated-but-unbound-click",
      chatid,
      userid: "second-reader",
      card: {
        card_type: "button_interaction",
        task_id: card.task_id,
        main_title: expect.objectContaining({ title: "请先绑定企业微信" }),
        button_list: [{ text: "绑定后再领取", key: card.button_list[0]!.key, style: 1 }],
      },
    });
    expect(updateGroupCardForUser.mock.calls[0]![0].userid).toBe("unbound");
    expect(replyToCallback).not.toHaveBeenCalled();
    expect(await grants()).toHaveLength(0);
    expect(await audit()).toHaveLength(0);

    const [issuedCard] = await database.db.select().from(wecomProjectAccessCards)
      .where(eq(wecomProjectAccessCards.id, card.task_id));
    await database.db.update(wecomProjectAccessCards).set({ expiresAt: new Date(0) })
      .where(eq(wecomProjectAccessCards.id, card.task_id));
    await service.handle(click("reader"));
    await service.handle(click("unbound"));
    expect(await grants()).toHaveLength(0);
    expect(updateGroupCardForUser).toHaveBeenCalledTimes(2);
    await database.db.update(wecomProjectAccessCards).set({ expiresAt: issuedCard!.expiresAt })
      .where(eq(wecomProjectAccessCards.id, card.task_id));

    await database.db.update(wecomAibotDmActivations).set({ userId: actorIds["second-reader"], boundAt: new Date() })
      .where(and(eq(wecomAibotDmActivations.botId, botId), eq(wecomAibotDmActivations.wecomUserid, "second-reader")));

    await Promise.all([
      service.handle(click("reader")),
      service.handle(click("reader")),
      service.handle(click("reader", { msgid: "another-click" })),
      service.handle(click("second-reader", { msgid: "reclick-after-binding" })),
    ]);
    expect(updateGroupCardForUser).toHaveBeenCalledTimes(6);
    const confirmations = updateGroupCardForUser.mock.calls.slice(2).map(([update]) => update);
    expect(confirmations.map((update) => update.userid).sort()).toEqual(["reader", "reader", "reader", "second-reader"]);
    for (const { card: confirmation } of confirmations) {
      expect(confirmation).toEqual({
        card_type: "text_notice",
        task_id: card.task_id,
        main_title: expect.objectContaining({ title: "已领取项目只读权限" }),
        card_action: { type: 1, url: "https://pm.libiaorobot.com/#/projects" },
      });
    }
    expect(replyToCallback).not.toHaveBeenCalled();
    expect((await grants()).map((grant) => grant.userId).sort()).toEqual([actorIds.reader, actorIds["second-reader"]].sort());
    expect(await audit()).toHaveLength(2);
    expect(await database.db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId))).toHaveLength(0);

    await read().expect(200).expect(({ body }) => expect(body.accessLevel).toBe("view"));
    await api.get("/api/v1/projects").set("Cookie", cookie).expect(200).expect(({ body }) => {
      expect(body.items.map((project: { id: string }) => project.id)).toEqual([projectId]);
    });
    await api.get("/api/v1/projects/" + otherProjectId).set("Cookie", cookie).expect(404);
    await api.patch(path).set("Cookie", cookie).set("X-CSRF-Token", "fixture").send({ name: "越权修改" }).expect(403);

    await database.db.update(wecomAibotDmActivations).set({ userId: actorIds.rebound, boundAt: new Date() })
      .where(and(eq(wecomAibotDmActivations.botId, botId), eq(wecomAibotDmActivations.wecomUserid, "reader")));
    await read().expect(404);
    await service.handle(click("reader"));
    expect(updateGroupCardForUser).toHaveBeenCalledTimes(6);
    expect(await audit()).toHaveLength(2);

    const groupRepository = app.get(ProjectGroupRepository);
    const at = new Date();
    const unchanged = await groupRepository.upsert({ projectId, chatid, name: "改名", activatedAt: at }, at);
    expect(unchanged.accessEpoch).toBe(binding!.accessEpoch);
    await groupRepository.upsert({ projectId, chatid: "replaced-" + suffix, name: null, activatedAt: at }, at);
    await groupRepository.upsert({ projectId, chatid, name: null, activatedAt: at }, at);
    const newBinding = await groupRepository.findByProject(projectId);
    expect(newBinding?.accessEpoch).not.toBe(binding!.accessEpoch);
    await service.handle(click("second-reader", { msgid: "old-card-on-new-binding" }));
    expect(await audit()).toHaveLength(2);
    expect(await app.get(WecomProjectAccessService).handle(message({ text: "普通群消息" }))).toBe(false);
  });
});
