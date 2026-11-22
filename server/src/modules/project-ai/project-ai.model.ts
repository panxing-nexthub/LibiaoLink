import { Injectable } from "@nestjs/common";
import { z } from "@libiaolink/contracts";
import { ProjectAiSummaryPayloadSchema, type ProjectAiContext, type ProjectAiSummaryPayload } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { ModelConfigService } from "../model-config/index.js";

/** 单次生成超时：项目上下文可能很大，给足时间；超时按 INTERNAL 失败，不写缓存。 */
const AI_SUMMARY_TIMEOUT_MS = 120_000;
/** prompt 侧的条数上限：只影响送模型的量，不影响接口返回的完整上下文。 */
const PROMPT_MAX_TASKS = 300;
const PROMPT_MAX_REPORTS = 80;
const PROMPT_MAX_ISSUES = 200;
const PROMPT_MAX_CHANGES = 100;
const PROMPT_NOTE_MAX = 300;

const MODEL_OUTPUT_SCHEMA = ProjectAiSummaryPayloadSchema.extend({
  summaryText: z.string().min(1).max(20_000),
});

export interface ProjectAiModelResult {
  modelId: string;
  summaryText: string;
  summary: ProjectAiSummaryPayload;
}

interface ChatCompletionReply {
  choices?: Array<{ message?: { content?: unknown } }>;
}

/** 递归去掉 null / 空数组 / 空对象：同样的信息量下显著减少 token。 */
function pruneEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pruneEmpty);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === null || item === undefined) continue;
      if (Array.isArray(item) && item.length === 0) continue;
      out[key] = pruneEmpty(item);
    }
    return out;
  }
  return value;
}

function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length <= max ? value : value.slice(0, max) + "…";
}

function buildPromptContext(context: ProjectAiContext): unknown {
  return pruneEmpty({
    project: context.project,
    stages: context.stages,
    ungroupedTasks: context.ungroupedTasks,
    tasks: context.tasks.slice(0, PROMPT_MAX_TASKS).map((task) => ({
      stageKey: task.stageKey,
      title: task.title,
      titleEn: task.titleEn,
      note: truncate(task.note, PROMPT_NOTE_MAX),
      ownerNames: task.ownerNames,
      managerNames: task.managerNames,
      status: task.status,
      displayStatus: task.displayStatus,
      progress: task.progress,
      plannedStart: task.plannedStart,
      plannedEnd: task.plannedEnd,
      actualEnd: task.actualEnd,
      estimatedDays: task.estimatedDays,
      headcount: task.headcount,
      priority: task.priority,
      deliverableTypes: task.deliverableTypes,
      onTime: task.onTime,
      finalizedAt: task.finalizedAt,
      changeLinks: task.changeLinks,
    })),
    changes: context.changes.slice(-PROMPT_MAX_CHANGES),
    reports: context.reports.slice(-PROMPT_MAX_REPORTS),
    issues: context.issues.slice(-PROMPT_MAX_ISSUES),
    promptTruncated: {
      tasks: context.tasks.length > PROMPT_MAX_TASKS,
      reports: context.reports.length > PROMPT_MAX_REPORTS,
      issues: context.issues.length > PROMPT_MAX_ISSUES,
      changes: context.changes.length > PROMPT_MAX_CHANGES,
      contextTruncated: context.truncated,
    },
  });
}

function buildSystemPrompt(): string {
  return [
    "你是工程交付项目的项目助理，负责根据给定的结构化项目数据写一份中文项目进展总结。",
    "硬性规则：",
    "1. 只使用给定数据，不得推测、补全或使用常识。字段为空 / 无记录时明确写「暂无数据」。",
    "2. 不得编造日期、数量、人员、原因、进度；不得给出验收结论、质量结论或工期承诺。",
    "3. 不评价任何人的绩效或态度，只描述事实。",
    "4. stageHighlights 的 stageKey 必须来自数据中 stages 的 stageKey；没有内容的阶段可以省略。",
    "5. risks 必须能在数据中找到依据，evidence 写明依据（任务标题 / 日期 / 问题 / 变更原因），没有依据就写 null。",
    "6. dataGaps 列出数据缺失或暂无记录的关键项（如阶段日期为空、无变更记录、无日报）。",
    "7. 只输出一个 JSON 对象，不要输出 markdown 代码块、注释或任何解释文字。",
    'JSON 结构：{"summaryText":"300-600 字整体总结","stageHighlights":[{"stageKey":"...","summary":"..."}],',
    '"risks":[{"level":"high|medium|low","text":"...","evidence":"...或null"}],',
    '"issueSummary":"...或null","changeSummary":"...或null","reportSummary":"...或null",',
    '"nextSteps":["..."],"dataGaps":["..."]}',
  ].join("\n");
}

/** 模型返回值可能带 markdown 代码块或前后缀：截取第一个 { 到最后一个 }。 */
function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return raw.slice(start, end + 1);
}

/**
 * 项目总结模型调用（独立 provider，便于测试注入假实现）。
 * 只做「上下文 → prompt → 模型 → 校验后的结构化结果」，不碰数据库与缓存。
 */
@Injectable()
export class ProjectAiModelClient {
  constructor(private readonly models: ModelConfigService) {}

  async summarize(context: ProjectAiContext): Promise<ProjectAiModelResult> {
    const active = await this.models.active();
    if (active === null) {
      throw new AppError("VALIDATION_FAILED", "尚未启用 AI 模型，请先在系统设置中配置并启用模型服务");
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (active.apiKey !== "") headers.Authorization = "Bearer " + active.apiKey;

    let response: Response;
    try {
      response = await fetch(active.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: active.modelId,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: "项目数据（JSON）：\n" + JSON.stringify(buildPromptContext(context)) },
          ],
          temperature: 0.2,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(AI_SUMMARY_TIMEOUT_MS),
      });
    } catch (error) {
      throw new AppError("INTERNAL", "AI 模型不可用（" + (error instanceof Error ? error.message : String(error)) + "）");
    }

    if (!response.ok) {
      throw new AppError("INTERNAL", "AI 模型返回 HTTP " + String(response.status) + "，请稍后重试");
    }

    const data = (await response.json().catch(() => null)) as ChatCompletionReply | null;
    const content = data?.choices?.[0]?.message?.content;
    const raw = typeof content === "string" ? content : "";
    if (raw.trim() === "") {
      throw new AppError("INTERNAL", "AI 模型响应缺少内容，请重试");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(raw));
    } catch {
      throw new AppError("INTERNAL", "AI 模型返回内容不是有效 JSON，请重试");
    }

    const validated = MODEL_OUTPUT_SCHEMA.safeParse(parsed);
    if (!validated.success) {
      throw new AppError("INTERNAL", "AI 模型返回内容不符合约定结构，请重试");
    }

    const { summaryText, ...summary } = validated.data;
    return { modelId: active.modelId, summaryText, summary };
  }
}
