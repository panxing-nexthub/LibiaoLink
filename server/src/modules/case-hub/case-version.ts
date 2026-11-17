import { CaseHubError } from "./case-hub.error.js";

/**
 * 乐观锁版本语义（与 `shared/src/common/conventions.ts` 的 `VersionSchema` 同口径：
 * 非负整数、读取时返回、更新必须原样回传）。
 *
 * 只落业务语义，不落 HTTP 细节：ETag 编码与 If-Match 缺失时的状态码属待定项 D06。
 *
 * 形状校验（缺失 / 非整数 / 负数）单独导出，服务层在进仓储前先自己做一遍：
 * 否则「缺 version」会由各适配器各自解释（内存实现报 VALIDATION_FAILED，SQL 适配器可能变成 0 行更新）。
 */
export function nextVersion(current: number): number {
  return current + 1;
}

/** 版本号形状校验：缺失、非整数、负数一律 `VALIDATION_FAILED`。 */
export function assertVersionShape(expected: number | undefined): asserts expected is number {
  if (expected === undefined) {
    throw new CaseHubError("VALIDATION_FAILED", "缺少版本号：更新必须携带当前 version", [
      { path: "version", message: "required" },
    ]);
  }
  if (!Number.isInteger(expected) || expected < 0) {
    throw new CaseHubError("VALIDATION_FAILED", "版本号必须是非负整数", [
      { path: "version", message: String(expected) },
    ]);
  }
}

/**
 * 校验请求携带的版本与当前版本一致。
 * D06 未定时，缺少版本号按校验失败处理（而不是默认放行）。
 */
export function assertVersionMatch(current: number, expected: number | undefined): void {
  assertVersionShape(expected);
  if (expected !== current) {
    throw new CaseHubError("VERSION_CONFLICT", `版本冲突：当前 ${current}，请求 ${expected}`, [
      { path: "version", message: `expected ${current}` },
    ]);
  }
}
