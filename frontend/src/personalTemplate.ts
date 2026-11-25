/**
 * 默认「个人模版」的共享识别 / 本地标记。
 * 任务模板页与项目空间「添加任务」卡片共用同一份 localStorage 键：
 * - 模板页改名 / 改范围 / 删除后，项目空间仍能认出同一份默认模板；
 * - 模板页删除后，项目空间不再自动补一份空「个人模版」。
 */
import type { TemplateItem } from "./templateApi";

export const PERSONAL_DEFAULT_TEMPLATE_NAME = "个人模版";
export const PERSONAL_DEFAULT_TEMPLATE_ID_PREFIX = "personal-default:";
const PERSONAL_DEFAULT_MARKERS_KEY = "libiaolink.personalDefaultTemplateIds.v1";
const PERSONAL_DEFAULT_DISMISSED_KEY = "libiaolink.personalDefaultDismissed.v1";
const inMemoryDismissed = new Set<string>();

function markerKey(userId: string | null, stage: string): string {
  return (userId ?? "anonymous") + "\n" + stage;
}

function readMarkers(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PERSONAL_DEFAULT_MARKERS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const markers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") markers[key] = value;
    }
    return markers;
  } catch {
    return {};
  }
}

export function markedPersonalDefaultTemplateId(userId: string | null, stage: string): string | null {
  return readMarkers()[markerKey(userId, stage)] ?? null;
}

export function rememberPersonalDefaultTemplate(userId: string | null, stage: string, templateId: string): void {
  if (typeof window === "undefined") return;
  try {
    const markers = readMarkers();
    markers[markerKey(userId, stage)] = templateId;
    window.localStorage.setItem(PERSONAL_DEFAULT_MARKERS_KEY, JSON.stringify(markers));
  } catch {
    // localStorage 不可用时只丢跨刷新识别。
  }
}

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PERSONAL_DEFAULT_DISMISSED_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

export function isPersonalDefaultDismissed(userId: string | null, stage: string): boolean {
  const key = markerKey(userId, stage);
  return inMemoryDismissed.has(key) || readDismissed().has(key);
}

/** 一份模板是否是当前账号的默认「个人模版」：优先认本地记住的 id，其次名称 / 私有 / 归属兜底。 */
export function isPersonalDefaultTemplate(
  template: Pick<TemplateItem, "id" | "name" | "visibility" | "createdBy">,
  userId: string | null,
  stage: string,
): boolean {
  if (template.id.startsWith(PERSONAL_DEFAULT_TEMPLATE_ID_PREFIX)) return true;
  if (userId !== null && template.createdBy !== userId) return false;
  const markedId = markedPersonalDefaultTemplateId(userId, stage);
  if (markedId !== null) return template.id === markedId;
  return template.visibility === "private" && template.name.trim() === PERSONAL_DEFAULT_TEMPLATE_NAME;
}

/** 未落库的空默认面板：只在项目空间「添加任务」卡片里展示，第一次加节点时才创建真实模板。 */
export function virtualPersonalDefaultTemplate(stage: string, userId: string | null): TemplateItem {
  return {
    id: PERSONAL_DEFAULT_TEMPLATE_ID_PREFIX + stage,
    name: PERSONAL_DEFAULT_TEMPLATE_NAME,
    visibility: "private",
    nodes: [],
    createdBy: userId,
    createdByName: null,
    version: 0,
  };
}

/** 保证当前阶段的模板列表里有默认「个人模版」；已落库的默认模板排最前，删除过则不再补。 */
export function ensurePersonalDefaultTemplate(
  templates: TemplateItem[],
  stage: string,
  userId: string | null,
): TemplateItem[] {
  const persisted = templates.filter((template) => isPersonalDefaultTemplate(template, userId, stage));
  if (persisted.length > 0) {
    const first = persisted[0];
    const rest = templates.filter((template) => template !== first && !template.id.startsWith(PERSONAL_DEFAULT_TEMPLATE_ID_PREFIX));
    return templates[0] === first && rest.length === templates.length - 1 ? templates : [first, ...rest];
  }
  if (isPersonalDefaultDismissed(userId, stage)) {
    return templates.filter((template) => !template.id.startsWith(PERSONAL_DEFAULT_TEMPLATE_ID_PREFIX));
  }
  return [virtualPersonalDefaultTemplate(stage, userId), ...templates];
}
