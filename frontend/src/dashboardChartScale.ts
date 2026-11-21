/** 仪表盘柱状图统一纵轴：约 8% 顶部余量 + 1 / 2 / 5 × 10^n 的整数整齐步长。 */
const NICE_FRACTIONS = [1, 2, 5, 10] as const;

export function dashboardAxisOf(maxValue: number): { max: number; step: number } {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return { max: 1, step: 1 };
  if (maxValue <= 5) {
    return { max: Math.max(1, Math.ceil(maxValue * 1.08)), step: 1 };
  }
  const padded = maxValue * 1.08;
  const raw = padded / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const niceFraction = NICE_FRACTIONS.find((candidate) => candidate >= fraction) ?? 10;
  const step = Math.max(1, niceFraction * magnitude);
  return { max: Math.max(step, Math.ceil(padded / step) * step), step };
}
