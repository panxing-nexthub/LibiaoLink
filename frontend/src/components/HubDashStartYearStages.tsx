import { useState } from "react";
import { stageText, useLocale, useT } from "../i18n";
import { usePersistentDashboardFilter } from "../dashboardFilterStorage";
import { dashboardAxisOf } from "../dashboardChartScale";
import { DASHBOARD_YEAR_WINDOW, DashboardYearNavigator, type DashboardYearKey } from "./DashboardYearNavigator";
import { HubDashHoverTip, hoverTipAt, type DashboardHoverTip } from "./HubDashHoverTip";
import { useResponsiveChartSize } from "./useResponsiveChartSize";
import {
  DASHBOARD_PROJECT_STAGE_BUCKETS,
  DASHBOARD_PROJECT_STAGE_COLORS,
  dashboardProjectStageLabel,
  type DashboardProjectInsights,
  type DashboardProjectStageBucket,
} from "../data/dashboardProjectInsights";

const MIN_SLOT_W = 43;
const EDGE_MIN = 32;
const EDGE_MAX = 48;
const PLOT_TOP = 18;
const BAR_MAX_W = 56;
const BAR_INSET_RATIO = 0.22;
const MIN_CHART_H = 112;
const PIE_FALLBACK_W = 560;
const PIE_FALLBACK_H = 330;
const PIE_MIN_RENDER_W = 240;
const PIE_MIN_RENDER_H = 140;

type StageChartView = "bar" | "pie";

function yearLabel(year: DashboardYearKey, unknownLabel: string): string {
  return year === null ? unknownLabel : String(year);
}

function includesYear(years: readonly DashboardYearKey[], year: DashboardYearKey): boolean {
  return years.some((item) => item === year);
}

/** 将阶段名称拆成最多两行，避免 11 个横轴分类在英文 / 日文 / 低高度双栏下互相压字。 */
function stageLabelLines(label: string, maxChars = 7): readonly string[] {
  const text = label.trim();
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  if (words.length > 1) {
    let bestIndex = 1;
    let bestWidth = Number.POSITIVE_INFINITY;
    for (let index = 1; index < words.length; index += 1) {
      const left = words.slice(0, index).join(" ");
      const right = words.slice(index).join(" ");
      const width = Math.max(left.length, right.length);
      if (width < bestWidth) {
        bestWidth = width;
        bestIndex = index;
      }
    }
    return [words.slice(0, bestIndex).join(" "), words.slice(bestIndex).join(" ")];
  }
  const dotIndex = Math.max(text.indexOf(" · "), text.indexOf("・"));
  if (dotIndex > 0) {
    const separatorLength = text.startsWith(" · ", dotIndex) ? 3 : 1;
    return [text.slice(0, dotIndex + separatorLength), text.slice(dotIndex + separatorLength)];
  }
  const hyphenIndex = text.indexOf("-");
  if (hyphenIndex > 0) return [text.slice(0, hyphenIndex + 1), text.slice(hyphenIndex + 1)];
  const middle = Math.ceil(text.length / 2);
  return [text.slice(0, middle), text.slice(middle)];
}

function StageBars({ insights, selectedYears, onPick }: {
  readonly insights: DashboardProjectInsights;
  readonly selectedYears: readonly DashboardYearKey[];
  readonly onPick?: (bucket: DashboardProjectStageBucket, years: readonly DashboardYearKey[]) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [tip, setTip] = useState<DashboardHoverTip | null>(null);
  const { ref: chartRef, width: availableWidth, height: availableHeight } = useResponsiveChartSize(720, 220);
  const selectedRows = insights.startYearStages.filter((row) => includesYear(selectedYears, row.year));
  if (selectedRows.length === 0) return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  const totals = DASHBOARD_PROJECT_STAGE_BUCKETS.map((_, stageIndex) =>
    selectedRows.reduce((sum, row) => sum + (row.stageCounts[stageIndex] ?? 0), 0));
  const maxValue = totals.reduce((max, count) => Math.max(max, count), 0);
  const { max: tickMax, step } = dashboardAxisOf(maxValue);
  const chartWidth = Math.max(
    availableWidth,
    DASHBOARD_PROJECT_STAGE_BUCKETS.length * MIN_SLOT_W + EDGE_MIN * 2,
  );
  const chartHeight = Math.max(availableHeight, MIN_CHART_H);
  const marginX = Math.max(EDGE_MIN, Math.min(EDGE_MAX, Math.round(chartWidth * 0.024)));
  const plotW = chartWidth - marginX * 2;
  const slotW = plotW / DASHBOARD_PROJECT_STAGE_BUCKETS.length;
  const tickFontSize = Math.max(11.2, Math.min(14, chartWidth * 0.0058));
  const numberFontSize = Math.max(12.5, Math.min(15, chartWidth * 0.0062));
  const baseAxisFontSize = locale === "zh"
    ? Math.max(12.5, Math.min(16.5, chartWidth * 0.0067))
    : locale === "en"
      ? Math.max(11.2, Math.min(14.5, chartWidth * 0.006))
      : Math.max(11.5, Math.min(15, chartWidth * 0.0062));
  const axisFontSize = Math.max(10.2, Math.min(baseAxisFontSize, slotW * 0.24));
  const labelMaxChars = Math.max(3, Math.floor(slotW / (axisFontSize * 1.15)));
  const labelLineH = axisFontSize + 2.2;
  const axisY = chartHeight - labelLineH * 2 - 12;
  const unit = (axisY - PLOT_TOP) / tickMax;
  const barW = Math.min(BAR_MAX_W, slotW * (1 - BAR_INSET_RATIO * 2));
  const ticks: number[] = [];
  for (let value = 0; value <= tickMax; value += step) ticks.push(value);
  return (
    <>
      <div ref={chartRef} className="hub-dash-chartViewport" data-chart="start-stage">
        <div className="hub-dash-chartCanvas" style={{ width: chartWidth + "px" }}>
          <svg
            className="hub-dash-start-stage"
            width={chartWidth}
            height={chartHeight}
            viewBox={"0 0 " + chartWidth + " " + chartHeight}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={t("hub.dash.projects.startYear.aria")}
            onMouseLeave={() => setTip(null)}
          >
            {ticks.map((value) => value > 0 ? (
              <line key={"grid-" + value} x1={marginX} y1={axisY - value * unit} x2={chartWidth - marginX} y2={axisY - value * unit} stroke="#e8eaee" strokeDasharray="3 4" />
            ) : null)}
            <line x1={marginX - 8} y1={axisY} x2={chartWidth - marginX + 8} y2={axisY} stroke="#b8bec6" />
            {ticks.map((value) => (
              <text key={"tick-" + value} x={marginX - 9} y={axisY - value * unit + 4} textAnchor="end" fontSize={tickFontSize} fill="#8a9099">{value}</text>
            ))}
            {DASHBOARD_PROJECT_STAGE_BUCKETS.map((bucket, stageIndex) => {
              const count = totals[stageIndex] ?? 0;
              const center = marginX + slotW * stageIndex + slotW / 2;
              const x = center - barW / 2;
              const height = count * unit;
              const y = axisY - height;
              const label = stageText(locale, dashboardProjectStageLabel(bucket));
              const labelLines = stageLabelLines(label, labelMaxChars);
              const yearRows = selectedRows
                .map((row) => ({
                  label: yearLabel(row.year, t("hub.dash.projects.unknownYear")),
                  value: row.stageCounts[stageIndex] ?? 0,
                }))
                .filter((row) => row.value > 0)
                .map((row) => ({ ...row, color: "#94a3b8" }));
              const tipRows = [...yearRows, { label: t("hub.dash.projects.total"), value: count, color: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }];
              const labelY = labelLines.length > 1 ? axisY + 17 : axisY + 20;
              return (
                <g key={bucket}>
                  <rect
                    className="hub-dash-start-stage__band"
                    x={marginX + slotW * stageIndex}
                    y={PLOT_TOP}
                    width={slotW}
                    height={axisY - PLOT_TOP}
                    fill="transparent"
                    onMouseEnter={(event) => setTip(hoverTipAt(event, label, tipRows, t("hub.dash.projects.startYear.title")))}
                    onMouseMove={(event) => setTip(hoverTipAt(event, label, tipRows, t("hub.dash.projects.startYear.title")))}
                  />
                  {count > 0 ? (
                    <rect
                      className="hub-dash-start-stage__bar"
                      data-drill={onPick === undefined ? undefined : "true"}
                      style={{ animationDelay: stageIndex * 35 + "ms" }}
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(height, 2)}
                      rx={5}
                      fill={DASHBOARD_PROJECT_STAGE_COLORS[bucket]}
                      onClick={onPick === undefined ? undefined : () => { onPick(bucket, selectedYears); }}
                      onMouseEnter={(event) => setTip(hoverTipAt(event, label, tipRows, t("hub.dash.projects.startYear.title")))}
                      onMouseMove={(event) => setTip(hoverTipAt(event, label, tipRows, t("hub.dash.projects.startYear.title")))}
                    />
                  ) : null}
                  {count > 0 ? (
                    <text
                      className="hub-dash-start-stage__num"
                      style={{ animationDelay: stageIndex * 35 + 250 + "ms" }}
                      x={center}
                      y={y - 8}
                      textAnchor="middle"
                      fontSize={numberFontSize}
                      fontWeight={650}
                      fill="#374151"
                      pointerEvents="none"
                    >{count}</text>
                  ) : null}
                  <text x={center} y={labelY} textAnchor="middle" fontSize={axisFontSize} fill="#4b5563" fontWeight={500}>
                    {labelLines.map((line, lineIndex) => (
                      <tspan key={line + ":" + lineIndex} x={center} y={labelY + lineIndex * labelLineH}>{line}</tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <HubDashHoverTip tip={tip} />
    </>
  );
}


/** 饼图角度（0 = 12 点，顺时针，单位度）→ 屏幕方向向量。 */
function pieDirOf(angle: number): { readonly x: number; readonly y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

/** 饼图极坐标点（0 = 12 点，顺时针）。 */
function piePolarOf(angle: number, radius: number, cx: number, cy: number): { readonly x: number; readonly y: number } {
  const direction = pieDirOf(angle);
  return { x: cx + direction.x * radius, y: cy + direction.y * radius };
}

/** 全直角扇形：圆心 → 外弧 → 圆心；扇区间仅靠 1.5px 白色描边分隔，与任务状态饼图同形。 */
function pieSectorPathOf(startAngle: number, endAngle: number, cx: number, cy: number, radius: number): string {
  const outerLarge = endAngle - startAngle > 180 ? 1 : 0;
  const start = piePolarOf(startAngle, radius, cx, cy);
  const end = piePolarOf(endAngle, radius, cx, cy);
  return (
    "M " + cx.toFixed(2) + " " + cy.toFixed(2) +
    " L " + start.x.toFixed(2) + " " + start.y.toFixed(2) +
    " A " + radius + " " + radius + " 0 " + outerLarge + " 1 " + end.x.toFixed(2) + " " + end.y.toFixed(2) +
    " Z"
  );
}

/** 估算文本宽（CJK 按 1 em，其余按 0.55 em；用于引线落点与左右标签防碰）。 */
function pieTextWidthOf(value: string, fontSize: number): number {
  let width = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    width += code >= 0x2e80 && code <= 0x9fff ? fontSize : fontSize * 0.55;
  }
  return width;
}

/** 长语种标签按可用宽度折成多行；首个候选完整单行放不下时才拆阶段名，计数 / 占比单独成行。 */
function pieLabelLayout(label: string, count: number, share: string, maxWidth: number, fontSize: number): { lines: readonly string[]; width: number; lineHeight: number } {
  const full = label + ": " + count + " (" + share + ")";
  const lineHeight = fontSize + 2.2;
  if (pieTextWidthOf(full, fontSize) <= maxWidth) {
    return { lines: [full], width: pieTextWidthOf(full, fontSize), lineHeight };
  }
  const lines: string[] = [];
  let remaining = label.trim();
  while (remaining !== "" && pieTextWidthOf(remaining, fontSize) > maxWidth) {
    let splitAt = 1;
    for (let index = 1; index < remaining.length; index += 1) {
      if (pieTextWidthOf(remaining.slice(0, index), fontSize) <= maxWidth) splitAt = index;
      else break;
    }
    const bestSpace = remaining.lastIndexOf(" ", splitAt);
    const bestHyphen = remaining.lastIndexOf("-", splitAt);
    const bestDot = remaining.lastIndexOf("・", splitAt);
    const preferred = Math.max(bestSpace, bestHyphen, bestDot);
    const cut = preferred > 0 && preferred < remaining.length - 1 ? preferred + 1 : splitAt;
    lines.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining !== "") lines.push(remaining);
  lines.push(count + " (" + share + ")");
  return { lines, width: Math.max(...lines.map((line) => pieTextWidthOf(line, fontSize))), lineHeight };
}

type StagePieRow = DashboardProjectInsights["startYearStages"][number];

/** 单年份阶段饼图：按卡片实测宽高重算圆心、半径、字号和引线；宽屏铺满，矮屏收紧，避免裁切。 */
function StagePie({ row, onPick }: {
  readonly row: StagePieRow;
  readonly onPick?: (bucket: DashboardProjectStageBucket, years: readonly DashboardYearKey[]) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [tip, setTip] = useState<DashboardHoverTip | null>(null);
  const { ref: pieRef, width: availableWidth, height: availableHeight } = useResponsiveChartSize(PIE_FALLBACK_W, PIE_FALLBACK_H);
  const total = row.total;
  if (total <= 0) return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  const chartW = Math.max(PIE_MIN_RENDER_W, availableWidth);
  const chartH = Math.max(PIE_MIN_RENDER_H, availableHeight);
  const cx = chartW / 2;
  const cy = chartH / 2;
  const radius = Math.max(34, Math.min(150, chartH * 0.38, chartW * 0.2));
  const labelPad = Math.max(6, Math.min(18, chartW * 0.016));
  const leaderStub = Math.max(7, Math.min(14, radius * 0.13));
  const sideSpace = Math.max(58, cx - radius - 16);
  const labelMaxWidth = Math.max(66, Math.min(280, chartW * 0.25, sideSpace));
  const arcs: Array<{
    bucket: DashboardProjectStageBucket;
    label: string;
    count: number;
    color: string;
    share: string;
    startAngle: number;
    endAngle: number;
    midAngle: number;
  }> = [];
  let cursor = 0;
  for (const bucket of DASHBOARD_PROJECT_STAGE_BUCKETS) {
    const stageIndex = DASHBOARD_PROJECT_STAGE_BUCKETS.indexOf(bucket);
    const count = row.stageCounts[stageIndex] ?? 0;
    if (count <= 0) continue;
    const endAngle = cursor + (count / total) * 360;
    arcs.push({
      bucket,
      label: stageText(locale, dashboardProjectStageLabel(bucket)),
      count,
      color: DASHBOARD_PROJECT_STAGE_COLORS[bucket],
      share: ((count / total) * 100).toFixed(2) + "%",
      startAngle: cursor,
      endAngle,
      midAngle: (cursor + endAngle) / 2,
    });
    cursor = endAngle;
  }
  const year = yearLabel(row.year, t("hub.dash.projects.unknownYear"));
  type PieArc = (typeof arcs)[number];
  type PieLabelItem = { arc: PieArc; right: boolean; y: number; layout: ReturnType<typeof pieLabelLayout> };
  const baseFont = Math.max(10, Math.min(16, chartH * 0.052, chartW * 0.024));
  const minFont = Math.max(8, baseFont * 0.55);
  let labelFont = baseFont;
  let labelItems: PieLabelItem[] = [];
  for (let fontSize = baseFont; fontSize >= minFont - 0.001; fontSize -= 0.5) {
    const drafts: PieLabelItem[] = arcs.map((arc) => {
      const direction = pieDirOf(arc.midAngle);
      return {
        arc,
        right: direction.x >= 0,
        y: cy + direction.y * radius * 1.06,
        layout: pieLabelLayout(arc.label, arc.count, arc.share, labelMaxWidth, fontSize),
      };
    });
    let fits = true;
    for (const right of [false, true]) {
      const group = drafts.filter((item) => item.right === right).sort((left, rightItem) => left.y - rightItem.y);
      let cursor = 4;
      for (const item of group) {
        const blockHeight = item.layout.lines.length * item.layout.lineHeight;
        const top = Math.max(item.y - blockHeight / 2, cursor);
        item.y = top + blockHeight / 2;
        cursor = top + blockHeight + 3;
      }
      const last = group[group.length - 1];
      if (last !== undefined) {
        const blockHeight = last.layout.lines.length * last.layout.lineHeight;
        const overflow = last.y + blockHeight / 2 - (chartH - 4);
        if (overflow > 0) {
          for (const item of group) item.y -= overflow;
        }
      }
      const first = group[0];
      if (first !== undefined) {
        const blockHeight = first.layout.lines.length * first.layout.lineHeight;
        if (first.y - blockHeight / 2 < 4) fits = false;
      }
      if (last !== undefined) {
        const blockHeight = last.layout.lines.length * last.layout.lineHeight;
        if (last.y + blockHeight / 2 > chartH - 4) fits = false;
      }
    }
    labelItems = drafts;
    labelFont = fontSize;
    if (fits) break;
  }
  const leaderEndGap = Math.max(4, labelFont * 0.5);
  const legendFontSize = arcs.length > 8 ? "0.68rem" : arcs.length > 6 ? "0.72rem" : "0.8rem";
  const tipOf = (event: { readonly clientX: number; readonly clientY: number }, arc: (typeof arcs)[number]): DashboardHoverTip =>
    hoverTipAt(event, arc.label, [
      { label: t("hub.dash.projects.projectCount"), value: arc.count, color: arc.color },
      { label: t("hub.dash.projects.share"), value: arc.share, color: "#94a3b8" },
    ], year);
  return (
    <>
      <div className="hub-dash-start__pieLegend" role="group" aria-label={t("hub.dash.projects.stageLegend")}>
        {arcs.map((arc) => (
          <span key={arc.bucket} className="hub-dash-start__pieLegendItem" style={{ fontSize: legendFontSize }}>
            <i style={{ background: arc.color }} />{arc.label}
          </span>
        ))}
      </div>
      <div ref={pieRef} className="hub-dash-start__pieChartViewport">
        <svg
          className="hub-dash-start__pieChart"
          width={chartW}
          height={chartH}
          viewBox={"0 0 " + chartW + " " + chartH}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={t("hub.dash.projects.startYear.pieAria", { year })}
          onMouseLeave={() => setTip(null)}
        >
          {arcs.length === 1 ? (
            <circle
              className="hub-dash-start__pieArc"
              data-drill={onPick === undefined ? undefined : "true"}
              cx={cx}
              cy={cy}
              r={radius}
              style={{ transformOrigin: cx + "px " + cy + "px" }}
              fill={arcs[0].color}
              onMouseEnter={(event) => setTip(tipOf(event, arcs[0]))}
              onMouseMove={(event) => setTip(tipOf(event, arcs[0]))}
              onClick={onPick === undefined ? undefined : () => { onPick(arcs[0].bucket, [row.year]); }}
            />
          ) : arcs.map((arc) => (
            <path
              key={arc.bucket}
              className="hub-dash-start__pieArc"
              data-drill={onPick === undefined ? undefined : "true"}
              d={pieSectorPathOf(arc.startAngle, arc.endAngle, cx, cy, radius)}
              style={{ transformOrigin: cx + "px " + cy + "px" }}
              fill={arc.color}
              onMouseEnter={(event) => setTip(tipOf(event, arc))}
              onMouseMove={(event) => setTip(tipOf(event, arc))}
              onClick={onPick === undefined ? undefined : () => { onPick(arc.bucket, [row.year]); }}
            />
          ))}
          {labelItems.map((item) => {
            const direction = pieDirOf(item.arc.midAngle);
            const attach = { x: cx + direction.x * Math.max(radius - 1, 1), y: cy + direction.y * Math.max(radius - 1, 1) };
            const bend = { x: cx + direction.x * (radius + leaderStub), y: cy + direction.y * (radius + leaderStub) };
            const layout = item.layout;
            const labelX = item.right ? chartW - labelPad : labelPad;
            const innerX = item.right ? labelX - layout.width - leaderEndGap : labelX + layout.width + leaderEndGap;
            const textY = item.y - ((layout.lines.length - 1) * layout.lineHeight) / 2 + labelFont / 3;
            return (
              <g key={"label-" + item.arc.bucket}>
                <polyline
                  className="hub-dash-start__pieLeader"
                  points={attach.x.toFixed(2) + "," + attach.y.toFixed(2) + " " + bend.x.toFixed(2) + "," + bend.y.toFixed(2) + " " + innerX.toFixed(2) + "," + item.y.toFixed(2)}
                  stroke={item.arc.color}
                  strokeWidth={1}
                  fill="none"
                />
                <text
                  className="hub-dash-start__pieLabel"
                  textAnchor={item.right ? "end" : "start"}
                  fontSize={labelFont}
                  fill={item.arc.color}
                >
                  {layout.lines.map((line, index) => (
                    <tspan key={line + ":" + index} x={labelX} y={textY + index * layout.lineHeight}>{line}</tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <HubDashHoverTip tip={tip} />
    </>
  );
}

/** 所选年份逐张饼图：多选年份时横向排列，单年时仍保持同一卡片形态。 */
function StagePies({ insights, selectedYears, onPick }: {
  readonly insights: DashboardProjectInsights;
  readonly selectedYears: readonly DashboardYearKey[];
  readonly onPick?: (bucket: DashboardProjectStageBucket, years: readonly DashboardYearKey[]) => void;
}) {
  const t = useT();
  const selectedRows = insights.startYearStages.filter((row) => includesYear(selectedYears, row.year));
  if (selectedRows.length === 0) return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  return (
    <div className="hub-dash-start__pieGrid" data-chart="start-stage-pie">
      {selectedRows.map((row) => {
        const year = yearLabel(row.year, t("hub.dash.projects.unknownYear"));
        return (
          <section key={row.year === null ? "unknown" : String(row.year)} className="hub-dash-start__pieCard" data-year={row.year === null ? "unknown" : String(row.year)}>
            <header className="hub-dash-start__pieCardHeader">
              <h4 className="hub-dash-start__pieCardTitle">{t("hub.dash.projects.startYear.yearPieTitle", { year })}</h4>
              <span className="hub-dash-start__pieCardMeta">{t("hub.dash.projects.detail.count", { n: row.total })}</span>
            </header>
            <StagePie row={row} onPick={onPick} />
          </section>
        );
      })}
    </div>
  );
}

/**
 * 最新阶段 × 启动年份：
 * - 柱状图：x = 九大阶段 + 暂停 / 归档-移交售后，y = 项目数；按选中年份合并统计。
 * - 饼图：每个选中年份一张阶段占比卡片，沿用任务状态饼图的图例 / 扇区 / 两侧引线标签。
 * 年份使用与项目统计图一致的多选方块筛选，悬停显示明细；点柱 / 点扇区按「阶段 × 年份」下钻项目列表。
 * 柱状图按容器实际像素绘制，字号不随屏幕等比缩放；饼图按年份卡片横向排列，卡片内等比缩放并自动折行长标签。
 */
export function HubDashStartYearStages({ insights, onPick, storageKeyPrefix }: {
  readonly insights: DashboardProjectInsights;
  /** 点阶段柱：按当前阶段 × 当前选中年份打开项目列表。 */
  readonly onPick?: (bucket: DashboardProjectStageBucket, years: readonly DashboardYearKey[]) => void;
  /** 全部项目仪表盘传入时，按账号记住当前阶段图的年份筛选。 */
  readonly storageKeyPrefix?: string;
}) {
  const t = useT();
  const rows = insights.startYearStages;
  const numericYears = [...new Set(rows.map((row) => row.year).filter((year): year is number => year !== null))].sort((left, right) => left - right);
  const hasUnknownYear = rows.some((row) => row.year === null);
  const allYears: DashboardYearKey[] = hasUnknownYear ? [...numericYears, null] : [...numericYears];
  const [selectedYears, setSelectedYears] = usePersistentDashboardFilter<DashboardYearKey[]>(
    storageKeyPrefix ? storageKeyPrefix + ".selectedYears" : null,
    () => {
      const recentYears = numericYears.slice(-DASHBOARD_YEAR_WINDOW);
      return recentYears.length > 0 ? recentYears : hasUnknownYear ? [null] : [];
    },
    (value): value is DashboardYearKey[] => Array.isArray(value) && value.every((item) => item === null || typeof item === "number"),
  );
  const [yearWindowStart, setYearWindowStart] = usePersistentDashboardFilter<number>(
    storageKeyPrefix ? storageKeyPrefix + ".yearWindowStart" : null,
    () => Math.max(0, numericYears.length - DASHBOARD_YEAR_WINDOW),
    (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0,
  );
  const [chartView, setChartView] = usePersistentDashboardFilter<StageChartView>(
    storageKeyPrefix ? storageKeyPrefix + ".stageView" : null,
    "bar",
    (value): value is StageChartView => value === "bar" || value === "pie",
  );
  if (rows.length === 0) return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  const allSelected = allYears.length > 0 && allYears.every((year) => includesYear(selectedYears, year));
  const toggleYear = (year: DashboardYearKey): void => setSelectedYears((current) =>
    includesYear(current, year) ? current.filter((item) => item !== year) : [...current, year]);
  const toggleAllYears = (): void => setSelectedYears(allSelected ? [] : [...allYears]);
  return (
    <div className="hub-dash-start" data-chart-view={chartView}>
      <div className="hub-dash-start__yearFilter">
        <div className="hub-dash-start__leftControls">
          <button
            type="button"
            className="hub-dash-project-types__selectAll hub-dash-start__selectAll"
            data-active={allSelected ? "true" : "false"}
            aria-pressed={allSelected}
            onClick={toggleAllYears}
          >{t("hub.dash.projects.selectAll")}</button>
          <button
            type="button"
            className="hub-dash-project-types__selectAll hub-dash-start__chartToggle"
            data-active={chartView === "pie" ? "true" : "false"}
            aria-pressed={chartView === "pie"}
            aria-label={t("hub.dash.projects.startYear.viewToggle")}
            onClick={() => setChartView((current) => current === "bar" ? "pie" : "bar")}
          >{chartView === "bar" ? t("hub.dash.projects.startYear.viewPie") : t("hub.dash.projects.startYear.viewBar")}</button>
        </div>
        <DashboardYearNavigator
          numericYears={numericYears}
          hasUnknownYear={hasUnknownYear}
          selectedYears={selectedYears}
          onToggleYear={toggleYear}
          windowStart={yearWindowStart}
          onWindowStartChange={setYearWindowStart}
        />
      </div>
      {selectedYears.length === 0 ? (
        <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>
      ) : chartView === "bar" ? (
        <div className="hub-dash-start__bars" data-testid="start-stage-bars">
          <StageBars insights={insights} selectedYears={selectedYears} onPick={onPick} />
        </div>
      ) : (
        <StagePies insights={insights} selectedYears={selectedYears} onPick={onPick} />
      )}
    </div>
  );
}
