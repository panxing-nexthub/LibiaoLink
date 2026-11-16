/**
 * Case Hub 本地错误码与错误类型（**暂存，非契约**）。
 *
 * 契约冻结（S3）前不写入 `shared/src/common/errors.ts`：错误码属于对外契约，
 * 新增必须同时回写《技术设计v0.2 §7.2》错误模型表并重新生成 OpenAPI（见 errors.ts 头注释）。
 * 冻结后本文件改为复用 `AppError`，删掉这里重复的码表与 HTTP 映射。
 */
export const CASE_HUB_ERROR_CODES = [
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "CASE_STATE_INVALID",
  "CASE_NOT_PUBLISHED",
  "IDEMPOTENCY_IN_PROGRESS",
] as const;

export type CaseHubErrorCode = (typeof CASE_HUB_ERROR_CODES)[number];

/** HTTP 映射为 §9.5 提案；D05 决定 `IDEMPOTENCY_IN_PROGRESS` 用 409 还是 425。 */
const HTTP_STATUS: Readonly<Record<CaseHubErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  CASE_STATE_INVALID: 409,
  CASE_NOT_PUBLISHED: 422,
  IDEMPOTENCY_IN_PROGRESS: 409,
};

export interface CaseHubErrorDetail {
  path?: string;
  message: string;
}

export class CaseHubError extends Error {
  readonly code: CaseHubErrorCode;
  readonly httpStatus: number;
  readonly details: CaseHubErrorDetail[];

  constructor(code: CaseHubErrorCode, message: string, details: CaseHubErrorDetail[] = []) {
    super(message);
    this.name = "CaseHubError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
  }
}
