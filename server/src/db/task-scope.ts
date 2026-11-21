import { and, eq, isNotNull, isNull, ne, not, sql } from "drizzle-orm";
import type { DbClient } from "./db-client.js";
import { projects } from "./schema/projects.js";
import { tasks } from "./schema/tasks.js";

type TaskOrigin = Pick<typeof tasks.$inferSelect, "stageKey" | "nodeId" | "taskNodeId">;

export function isTemporaryTask(task: TaskOrigin): boolean {
  return task.stageKey === null && task.nodeId === null && task.taskNodeId === null;
}

export function temporaryTaskCondition() {
  return sql`(${tasks.stageKey} is null and ${tasks.nodeId} is null and ${tasks.taskNodeId} is null)`;
}

// Both timestamps are assigned by PostgreSQL after the project row is locked.
export const hasOpenPostArchiveTask = sql<boolean>`(
  ${projects.status} = 'archived' and exists (
    select 1 from ${tasks}
    where ${tasks.projectId} = ${projects.id}
      and ${tasks.createdAt} > ${projects.archivedAt}
      and ${tasks.deletedAt} is null and ${tasks.status} <> 'done'
      and ${temporaryTaskCondition()}
  )
)`;

export async function hasUnfinishedTemporaryTask(client: DbClient, projectId: string, taskId?: string): Promise<boolean> {
  const rows = await client.select({ id: tasks.id }).from(tasks)
    .where(and(
      eq(tasks.projectId, projectId),
      taskId === undefined ? undefined : eq(tasks.id, taskId),
      isNull(tasks.deletedAt),
      temporaryTaskCondition(),
      ne(tasks.status, "done"),
    ))
    .limit(1);
  return rows.length > 0;
}

/** 项目经理名单同步到非临时任务；定档任务只更新展示字段。 */
export async function syncProjectManagersToStageTasks(
  client: DbClient,
  projectId: string,
  managerIds: string[],
  at: Date,
  exceptTaskId?: string,
): Promise<void> {
  const scope = and(
    eq(tasks.projectId, projectId),
    isNull(tasks.deletedAt),
    not(temporaryTaskCondition()),
    exceptTaskId === undefined ? undefined : ne(tasks.id, exceptTaskId),
  );
  await client.update(tasks)
    .set({ managerIds, version: sql`${tasks.version} + 1`, updatedAt: at })
    .where(and(scope, isNull(tasks.finalizedAt)));
  await client.update(tasks)
    .set({ managerIds })
    .where(and(scope, isNotNull(tasks.finalizedAt)));
}
