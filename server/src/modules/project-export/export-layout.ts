/** 项目 / 页面级 Excel 导出共用排版：按内容扩列宽，按换行和上下留白估行高。 */

export const EXPORT_PX_PER_POINT = 4 / 3;
export const EXPORT_BODY_MIN_HEIGHT_PX = 38;
export const EXPORT_BODY_LINE_HEIGHT_PX = 19;
export const EXPORT_BODY_VERTICAL_PADDING_PX = 20;
export const EXPORT_HEADER_MIN_HEIGHT_PX = 42;
export const EXPORT_HEADER_LINE_HEIGHT_PX = 18;
export const EXPORT_HEADER_VERTICAL_PADDING_PX = 18;
export const EXPORT_MAX_ROW_HEIGHT_PX = 540;
export const EXPORT_MAX_COLUMN_WIDTH = 72;
export const EXPORT_COLUMN_GROWTH = 18;

/** 以 Excel 列宽字符为单位估算显示宽度：ASCII 记 1，中文 / 全角记 2。 */
export function textDisplayWidth(value: string): number {
  let width = 0;
  for (const char of value) width += /[\u0000-\u00ff]/.test(char) ? 1 : 2;
  return width;
}

export function longestTextWidth(value: string): number {
  let longest = 0;
  for (const line of value.split("\n")) longest = Math.max(longest, textDisplayWidth(line));
  return longest;
}

export function estimatedWrappedLines(value: string, widthChars: number): number {
  if (value === "") return 1;
  const usableWidth = Math.max(4, widthChars - 0.8);
  let total = 0;
  for (const line of value.split("\n")) {
    total += Math.max(1, Math.ceil(textDisplayWidth(line) / usableWidth));
  }
  return Math.max(1, total);
}

function estimatedHeightPx(
  values: readonly string[],
  widths: readonly number[],
  minHeightPx: number,
  lineHeightPx: number,
  verticalPaddingPx: number,
): number {
  let lines = 1;
  for (let index = 0; index < values.length; index += 1) {
    lines = Math.max(lines, estimatedWrappedLines(values[index] ?? "", widths[index] ?? 8.43));
  }
  return Math.min(EXPORT_MAX_ROW_HEIGHT_PX, Math.max(minHeightPx, lines * lineHeightPx + verticalPaddingPx));
}

export function bodyRowHeightPx(values: readonly string[], widths: readonly number[]): number {
  return estimatedHeightPx(
    values,
    widths,
    EXPORT_BODY_MIN_HEIGHT_PX,
    EXPORT_BODY_LINE_HEIGHT_PX,
    EXPORT_BODY_VERTICAL_PADDING_PX,
  );
}

export function headerRowHeightPx(values: readonly string[], widths: readonly number[]): number {
  return estimatedHeightPx(
    values,
    widths,
    EXPORT_HEADER_MIN_HEIGHT_PX,
    EXPORT_HEADER_LINE_HEIGHT_PX,
    EXPORT_HEADER_VERTICAL_PADDING_PX,
  );
}

/** 只扩不缩，避免旧行在宽度回缩后发生文字裁切。 */
export function fittedColumnWidth(value: string, baseWidth: number, growth = EXPORT_COLUMN_GROWTH): number {
  const desired = Math.ceil(longestTextWidth(value) + 2.2);
  const maxWidth = Math.min(EXPORT_MAX_COLUMN_WIDTH, baseWidth + growth);
  return Math.max(baseWidth, Math.min(maxWidth, desired));
}
