import { CaseHubError } from "./case-hub.error.js";

/**
 * payload 形状与 extensions 限额校验（不依赖业务字段）。
 *
 * 顶层六个分组由《团队分工.md》§3 W0 固定；分组内的字段与必填项属待定项 D01，
 * 因此这里只校验形状：未识别的顶层分组会被拒绝、六个分组的值必须是对象，
 * 分组内字段（必填 / 枚举 / 语义）一律不在这里校验。
 * 限额取 §9.4 提案，D02 定稿后只改本文件常量。
 */
export const CASE_PAYLOAD_GROUPS = [
  "profile",
  "narrative",
  "solution",
  "outcomes",
  "confidentiality",
  "extensions",
] as const;

export type CasePayloadGroup = (typeof CASE_PAYLOAD_GROUPS)[number];

export const CASE_EXTENSION_LIMITS = {
  maxKeys: 32,
  maxValueBytes: 8 * 1024,
  maxTotalBytes: 64 * 1024,
  maxDepth: 3,
} as const;

/**
 * `<ns>:<name>`：ns 小写字母开头 2–16 位；name 1–32 位，允许大小写、数字、- 与 _
 * （扩展名习惯写 camelCase，如 `crm:customerLevel`）。
 */
const EXTENSION_KEY_PATTERN = /^[a-z][a-z0-9]{1,15}:[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/** 保留前缀：内部字段不得占用扩展命名空间。 */
const RESERVED_NAMESPACES = ["case", "internal"] as const;

function depthOf(value: unknown): number {
  if (value === null || typeof value !== "object") {
    return 0;
  }
  const children: unknown[] = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  if (children.length === 0) {
    return 0;
  }
  return 1 + Math.max(...children.map(depthOf));
}

function byteLengthOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/** 拒绝未识别的顶层分组（严格形状）；未知字段不静默丢弃。 */
export function assertPayloadGroups(payload: Record<string, unknown>): void {
  const unknownGroups = Object.keys(payload).filter(
    (key) => !(CASE_PAYLOAD_GROUPS as readonly string[]).includes(key),
  );
  if (unknownGroups.length === 0) {
    return;
  }
  throw new CaseHubError(
    "VALIDATION_FAILED",
    "payload 存在未识别的顶层分组",
    unknownGroups.map((key) => ({ path: key, message: "unknown group" })),
  );
}

/** 六个分组各自必须是对象（分组内字段属 D01，不在这里校验）。 */
export function assertPayloadGroupTypes(payload: Record<string, unknown>): void {
  const invalidGroups = CASE_PAYLOAD_GROUPS.filter((group) => {
    const value = payload[group];
    return value !== undefined && (value === null || typeof value !== "object" || Array.isArray(value));
  });
  if (invalidGroups.length === 0) {
    return;
  }
  throw new CaseHubError(
    "VALIDATION_FAILED",
    "payload 分组必须是对象",
    invalidGroups.map((group) => ({ path: group, message: "object expected" })),
  );
}

/** 校验 extensions：键格式、保留命名空间、key 数、单值字节、总量、嵌套深度。 */
export function assertExtensions(extensions: unknown): void {
  if (extensions === undefined || extensions === null) {
    return;
  }
  if (typeof extensions !== "object" || Array.isArray(extensions)) {
    throw new CaseHubError("VALIDATION_FAILED", "extensions 必须是对象", [
      { path: "extensions", message: "object expected" },
    ]);
  }
  const entries = Object.entries(extensions as Record<string, unknown>);
  if (entries.length > CASE_EXTENSION_LIMITS.maxKeys) {
    throw new CaseHubError(
      "VALIDATION_FAILED",
      `extensions 数量超过上限（${CASE_EXTENSION_LIMITS.maxKeys}）`,
      [{ path: "extensions", message: `count ${entries.length}` }],
    );
  }

  let totalBytes = 0;
  for (const [key, value] of entries) {
    if (!EXTENSION_KEY_PATTERN.test(key)) {
      throw new CaseHubError("VALIDATION_FAILED", `extensions 键必须形如 <ns>:<name>：${key}`, [
        { path: `extensions.${key}`, message: "invalid key" },
      ]);
    }
    const namespace = key.slice(0, key.indexOf(":"));
    if ((RESERVED_NAMESPACES as readonly string[]).includes(namespace)) {
      throw new CaseHubError("VALIDATION_FAILED", `extensions 不得使用保留命名空间：${namespace}`, [
        { path: `extensions.${key}`, message: "reserved namespace" },
      ]);
    }
    const depth = depthOf(value);
    if (depth > CASE_EXTENSION_LIMITS.maxDepth) {
      throw new CaseHubError(
        "VALIDATION_FAILED",
        `extensions 嵌套深度超过上限（${CASE_EXTENSION_LIMITS.maxDepth}）`,
        [{ path: `extensions.${key}`, message: `depth ${depth}` }],
      );
    }
    const bytes = byteLengthOf(value);
    if (bytes > CASE_EXTENSION_LIMITS.maxValueBytes) {
      throw new CaseHubError(
        "VALIDATION_FAILED",
        `extensions 单值超过上限（${CASE_EXTENSION_LIMITS.maxValueBytes} 字节）`,
        [{ path: `extensions.${key}`, message: `${bytes} bytes` }],
      );
    }
    totalBytes += bytes;
  }

  if (totalBytes > CASE_EXTENSION_LIMITS.maxTotalBytes) {
    throw new CaseHubError(
      "VALIDATION_FAILED",
      `extensions 总量超过上限（${CASE_EXTENSION_LIMITS.maxTotalBytes} 字节）`,
      [{ path: "extensions", message: `${totalBytes} bytes` }],
    );
  }
}

/**
 * payload 整体形状校验入口（校验顺序：顶层分组 → 分组类型 → extensions 限额）。
 * 服务层（S5 `CaseService`）在写入前调用；仓储保持哑存储语义，不重复校验。
 */
export function assertPayloadShape(payload: Record<string, unknown>): void {
  assertPayloadGroups(payload);
  assertPayloadGroupTypes(payload);
  assertExtensions(payload.extensions);
}
