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

/**
 * 最新阶段 × 启动年份：
 * x = 九大阶段 + 暂停 / 归档-移交售后，y = 项目数；
 * 年份使用与项目统计图一致的多选方块筛选，悬停柱体显示所选年份的明细；点柱按「当前阶段 × 选中年份」下钻项目列表。
 * 图表按容器实际像素绘制，字号不随屏幕等比缩放，绘图区左右留白对称。
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
  if (rows.length === 0) return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  const allSelected = allYears.length > 0 && allYears.every((year) => includesYear(selectedYears, year));
  const toggleYear = (year: DashboardYearKey): void => setSelectedYears((current) =>
    includesYear(current, year) ? current.filter((item) => item !== year) : [...current, year]);
  const toggleAllYears = (): void => setSelectedYears(allSelected ? [] : [...allYears]);
  return (
    <div className="hub-dash-start">
      <div className="hub-dash-start__yearFilter">
        <button
          type="button"
          className="hub-dash-project-types__selectAll hub-dash-start__selectAll"
          data-active={allSelected ? "true" : "false"}
          aria-pressed={allSelected}
          onClick={toggleAllYears}
        >{t("hub.dash.projects.selectAll")}</button>
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
      ) : (
        <div className="hub-dash-start__bars">
          <StageBars insights={insights} selectedYears={selectedYears} onPick={onPick} />
        </div>
      )}
    </div>
  );
}
