import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  PROJECT_VIEW_GRANT_BATCH_LIMIT,
  type ProjectViewGrantAddResultSchema,
  type ProjectViewGrantListSchema,
  type ProjectViewGrantPreviewSchema,
  type z,
} from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../../db/database.service.js";
import { users } from "../../db/schema/identity.js";
import { projectViewGrants } from "../../db/schema/projects.js";
import { AuditService } from "../admin/index.js";
import { UserService } from "../identity/index.js";
import { PermissionService } from "../permission/index.js";

type ProjectViewGrantPreview = z.infer<typeof ProjectViewGrantPreviewSchema>;
type DirectoryUser = ProjectViewGrantPreview["items"][number]["candidates"][number];

function key(text: string): string {
  return text.trim().toLowerCase();
}

function parseMember(text: string) {
  const tab = text.indexOf("\t");
  const name = tab < 0 ? text : text.slice(0, tab).trim();
  const identifier = tab < 0 ? "" : key(text.slice(tab + 1));
  const alias = /^(.+?)\s*[(（]([^()（）]+)[)）]$/u.exec(name);
  return { text, fullName: key(name), name: key(alias?.[1] ?? name), alias: key(alias?.[2] ?? ""), identifier };
}

function matchesIdentifier(user: DirectoryUser, identifier: string): boolean {
  return key(user.username) === identifier || (user.email !== null && key(user.email) === identifier);
}

@Injectable()
export class ProjectViewGrantService {
  constructor(
    private readonly database: DatabaseService,
    private readonly permission: PermissionService,
    private readonly users: UserService,
    private readonly audit: AuditService,
  ) {}

  async preview(projectId: string, actorId: string, text: string): Promise<ProjectViewGrantPreview> {
    await this.assertManager(projectId, actorId);
    const members = text.split(/[;；\r\n]+/u).map((entry) => entry.trim()).filter(Boolean).map(parseMember);
    if (members.length === 0 || members.length > PROJECT_VIEW_GRANT_BATCH_LIMIT) {
      throw new AppError("VALIDATION_FAILED", "每批请粘贴 1–" + PROJECT_VIEW_GRANT_BATCH_LIMIT + " 位成员");
    }
    const keys = new Set(members.flatMap((member) => [member.fullName, member.name, member.alias, member.identifier]));
    keys.delete("");
    const directory = await this.users.findActiveDirectoryMatches([...keys]);
    return {
      items: members.map((member) => {
        const primary = directory.filter((user) =>
          key(user.displayName) === member.fullName || key(user.displayName) === member.name ||
          matchesIdentifier(user, member.fullName),
        );
        const candidates = member.identifier !== ""
          ? primary.filter((user) => matchesIdentifier(user, member.identifier))
          : primary.length > 0 || member.alias === ""
            ? primary
            : directory.filter((user) => key(user.displayName) === member.alias || matchesIdentifier(user, member.alias));
        return {
          text: member.text,
          status: candidates.length === 0 ? "unmatched" : candidates.length === 1 && primary.length > 0 ? "matched" : "confirm",
          candidates,
        };
      }),
    };
  }

  async list(projectId: string, actorId: string): Promise<z.infer<typeof ProjectViewGrantListSchema>> {
    await this.assertManager(projectId, actorId);
    const rows = await this.database.db.select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      status: users.status,
      removedAt: users.removedAt,
      createdAt: projectViewGrants.createdAt,
    }).from(projectViewGrants)
      .innerJoin(users, eq(users.id, projectViewGrants.userId))
      .where(eq(projectViewGrants.projectId, projectId))
      .orderBy(asc(users.username));
    return {
      items: rows.map(({ createdAt, status, removedAt, ...user }) => ({
        user: { ...user, status: status === "active" && removedAt === null ? "active" : "disabled" },
        createdAt: createdAt.toISOString(),
      })),
    };
  }

  async add(projectId: string, actorId: string, userIds: readonly string[]): Promise<z.infer<typeof ProjectViewGrantAddResultSchema>> {
    await this.assertManager(projectId, actorId);
    const ids = [...new Set(userIds.map((id) => id.toLowerCase()))].sort();
    return this.database.db.transaction(async (tx) => {
      const activeUsers = await tx.select({ id: users.id }).from(users).where(and(
        inArray(users.id, ids), eq(users.status, "active"), isNull(users.removedAt),
      ));
      if (activeUsers.length !== ids.length) {
        throw new AppError("VALIDATION_FAILED", "有账号已停用或不存在，请重新预览并确认");
      }
      const added = await tx.insert(projectViewGrants).values(ids.map((userId) => ({ projectId, userId })))
        .onConflictDoNothing().returning({ userId: projectViewGrants.userId });
      if (added.length > 0) {
        await this.audit.record(tx, {
          actorId,
          action: "create",
          objectType: "project_view_grant",
          objectId: projectId,
          projectId,
          summary: "添加项目仅浏览授权（" + added.length + " 人）",
          metadata: { userIds: added.map((row) => row.userId), accessLevel: "view" },
        });
      }
      return { added: added.length };
    });
  }

  async revoke(projectId: string, actorId: string, userId: string): Promise<void> {
    await this.assertManager(projectId, actorId);
    await this.database.db.transaction(async (tx) => {
      const removed = await tx.delete(projectViewGrants)
        .where(and(eq(projectViewGrants.projectId, projectId), eq(projectViewGrants.userId, userId)))
        .returning({ userId: projectViewGrants.userId });
      if (removed.length > 0) {
        await this.audit.record(tx, {
          actorId,
          action: "delete",
          objectType: "project_view_grant",
          objectId: projectId,
          projectId,
          summary: "撤销项目仅浏览授权",
          metadata: { userIds: removed.map((row) => row.userId), accessLevel: "view" },
        });
      }
    });
  }

  private async assertManager(projectId: string, actorId: string): Promise<void> {
    const access = await this.permission.assertProjectVisible(actorId, projectId);
    if (!access.projectManager) {
      throw new AppError("FORBIDDEN", "仅本项目的项目经理可以管理项目只读授权");
    }
  }
}
