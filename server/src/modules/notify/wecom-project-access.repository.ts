import { Injectable } from "@nestjs/common";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { DatabaseService } from "../../db/database.service.js";
import type { DbTransaction } from "../../db/db-client.js";
import { users } from "../../db/schema/identity.js";
import {
  wecomAibotDmActivations,
  wecomGroups,
  wecomProjectAccessCards,
  wecomProjectReadGrants,
} from "../../db/schema/notify.js";
import { projects } from "../../db/schema/projects.js";

type ClaimResult =
  | { kind: "granted"; projectId: string; userId: string; issuedBy: string }
  | { kind: "unbound" }
  | { kind: "already_granted" }
  | null;

@Injectable()
export class WecomProjectAccessRepository {
  constructor(private readonly database: DatabaseService) {}

  async insertCard(card: typeof wecomProjectAccessCards.$inferInsert): Promise<void> {
    await this.database.db.insert(wecomProjectAccessCards).values(card);
  }

  async claim(
    input: { cardId: string; botId: string; chatid: string; wecomUserId: string; at: Date },
    tx: DbTransaction,
  ): Promise<ClaimResult> {
    const [source] = await tx
      .select({
        groupId: wecomGroups.id,
        groupEpoch: wecomGroups.accessEpoch,
        projectId: projects.id,
        issuedBy: wecomProjectAccessCards.issuedBy,
      })
      .from(wecomProjectAccessCards)
      .innerJoin(wecomGroups, and(
        eq(wecomGroups.id, wecomProjectAccessCards.groupId),
        eq(wecomGroups.accessEpoch, wecomProjectAccessCards.groupEpoch),
        eq(wecomGroups.chatid, input.chatid),
        eq(wecomGroups.enabled, true),
        isNotNull(wecomGroups.activatedAt),
      ))
      .innerJoin(projects, and(eq(projects.id, wecomGroups.projectId), isNull(projects.deletedAt)))
      .where(and(
        eq(wecomProjectAccessCards.id, input.cardId),
        eq(wecomProjectAccessCards.botId, input.botId),
        gt(wecomProjectAccessCards.expiresAt, input.at),
      ))
      .for("share");
    if (source === undefined) return null;

    const [actor] = await tx
      .select({
        userId: users.id,
        activationId: wecomAibotDmActivations.id,
        status: users.status,
        removedAt: users.removedAt,
      })
      .from(wecomAibotDmActivations)
      .innerJoin(users, eq(users.id, wecomAibotDmActivations.userId))
      .where(and(
        eq(wecomAibotDmActivations.botId, input.botId),
        eq(wecomAibotDmActivations.wecomUserid, input.wecomUserId),
        isNotNull(wecomAibotDmActivations.boundAt),
      ))
      .for("share");
    if (actor === undefined) return { kind: "unbound" };
    if (actor.status !== "active" || actor.removedAt !== null) return null;

    const [grant] = await tx
      .insert(wecomProjectReadGrants)
      .values({
        groupId: source.groupId,
        groupEpoch: source.groupEpoch,
        userId: actor.userId,
        activationId: actor.activationId,
        cardId: input.cardId,
        createdAt: input.at,
      })
      .onConflictDoNothing()
      .returning({ userId: wecomProjectReadGrants.userId });
    if (grant !== undefined) {
      return { kind: "granted", projectId: source.projectId, userId: grant.userId, issuedBy: source.issuedBy };
    }

    // 也可能撞到卡片与企微身份的唯一约束。只对当前账号实际持有的同一绑定授权回告成功。
    const [existing] = await tx
      .select({ userId: wecomProjectReadGrants.userId })
      .from(wecomProjectReadGrants)
      .where(and(
        eq(wecomProjectReadGrants.groupId, source.groupId),
        eq(wecomProjectReadGrants.groupEpoch, source.groupEpoch),
        eq(wecomProjectReadGrants.userId, actor.userId),
        eq(wecomProjectReadGrants.activationId, actor.activationId),
      ))
      .limit(1);
    return existing === undefined ? null : { kind: "already_granted" };
  }
}
