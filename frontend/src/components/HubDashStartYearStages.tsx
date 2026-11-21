import { useState } from "react";
import { stageText, useLocale, useT } from "../i18n";
import { usePersistentDashboardFilter } from "../dashboardFilterStorage";
import { DASHBOARD_YEAR_WINDOW, DashboardYearNavigator, type DashboardYearKey } from "./DashboardYearNavigator";
import { HubDashHoverTip, hoverTipAt, type DashboardHoverTip } from "./HubDashHoverTip";
import {
  DASHBOARD_PROJECT_STAGE_BUCKETS,
  DASHBOARD_PROJECT_STAGE_COLORS,
  dashboardProjectStageLabel,
  type DashboardProjectInsights,
} from "../data/dashboardProjectInsights";

const BAR_W = 1400;
const BAR_H = 320;
const LEFT = 64;
const RIGHT = 28;
const TOP = 24;
const AXIS_Y = 254;
const LABEL_Y = 276;
const LABEL_LINE_H = 14.5;
const BAR_MAX_W = 58;
const BAR_INSET_RATIO = 0.22;

function axisOf(maxValue: number): { max: number; step: number } {
  if (maxValue <= 5) return { max: Math.max(1, maxValue), step: 1 };
  const raw = maxValue / 4;
  const step = raw <= 1 ? 1 : raw <= 2 ? 2 : raw <= 5 ? 5 : raw <= 10 ? 10 : raw <= 20 ? 20 : raw <= 50 ? 50 : 100;
  return { max: Math.max(step, Math.ceil(maxValue / step) * step), step };
}

function yearLabel(year: DashboardYearKey, unknownLabel: string): string {
  return year === null ? unknownLabel : String(year);
}

function includesYear(years: readonly DashboardYearKey[], year: DashboardYearKey): boolean {
  return years.some((item) => item === year);
}

/** 将阶段名称拆成最多两行，避免 12 个横轴分类在英文 / 日文下互相压字。 */
function stageLabelLines(label: string): readonly string[] {
  const text = label.trim();
  if (text.length <= 7) return [text];
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

function StageBars({ insights, selectedYears }: {
  readonly insights: DashboardProjectInsights;
  readonly selectedYears: readonly DashboardYearKey[];
}) {
  const t = useT();
  const locale = useLocale();
  const [tip, setTip] = useState<DashboardHoverTip | null>(null);
  const axisFontSize = locale === "zh" ? 14.3 : locale === "en" ? 11.8 : 12.6;
  const selectedRows = insights.startYearStages.filter((row) => includesYear(selectedYears, row.year));
  if (selectedRows.length === 0) return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  const totals = DASHBOARD_PROJECT_STAGE_BUCKETS.map((_, stageIndex) =>
    selectedRows.reduce((sum, row) => sum + (row.stageCounts[stageIndex] ?? 0), 0));
  const maxValue = totals.reduce((max, count) => Math.max(max, count), 0);
  const { max: tickMax, step } = axisOf(Math.max(maxValue, 1));
  const unit = (AXIS_Y - TOP) / tickMax;
  const slotW = (BAR_W - LEFT - RIGHT) / DASHBOARD_PROJECT_STAGE_BUCKETS.length;
  const barW = Math.min(BAR_MAX_W, slotW * (1 - BAR_INSET_RATIO * 2));
  const ticks: number[] = [];
  for (let value = 0; value <= tickMax; value += step) ticks.push(value);
  return (
    <>
      <svg
        className="hub-dash-start-stage"
        viewBox={"0 0 " + BAR_W + " " + BAR_H}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t("hub.dash.projects.startYear.aria")}
        onMouseLeave={() => setTip(null)}
      >
        {ticks.map((value) => value > 0 ? (
          <line key={"grid-" + value} x1={LEFT} y1={AXIS_Y - value * unit} x2={BAR_W - RIGHT} y2={AXIS_Y - value * unit} stroke="#e8eaee" strokeDasharray="3 4" />
        ) : null)}
        <line x1={LEFT - 8} y1={AXIS_Y} x2={BAR_W - RIGHT + 8} y2={AXIS_Y} stroke="#b8bec6" />
        {ticks.map((value) => (
          <text key={"tick-" + value} x={LEFT - 12} y={AXIS_Y - value * unit + 4} textAnchor="end" fontSize={13.2} fill="#8a9099">{value}</text>
        ))}
        {DASHBOARD_PROJECT_STAGE_BUCKETS.map((bucket, stageIndex) => {
          const count = totals[stageIndex] ?? 0;
          const center = LEFT + slotW * stageIndex + slotW / 2;
          const x = center - barW / 2;
          const height = count * unit;
          const y = AXIS_Y - height;
          const label = stageText(locale, dashboardProjectStageLabel(bucket));
          const labelLines = stageLabelLines(label);
          const yearRows = selectedRows
            .map((row) => ({
              label: yearLabel(row.year, t("hub.dash.projects.unknownYear")),
              value: row.stageCounts[stageIndex] ?? 0,
            }))
            .filter((row) => row.value > 0)
            .map((row) => ({ ...row, color: "#94a3b8" }));
          const tipRows = [...yearRows, { label: t("hub.dash.projects.total"), value: count, color: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }];
          return (
            <g key={bucket}>
              <rect
                className="hub-dash-start-stage__band"
                x={LEFT + slotW * stageIndex}
                y={TOP}
                width={slotW}
                height={AXIS_Y - TOP}
                fill="transparent"
                onMouseEnter={(event) => setTip(hoverTipAt(event, label, tipRows, t("hub.dash.projects.startYear.title")))}
                onMouseMove={(event) => setTip(hoverTipAt(event, label, tipRows, t("hub.dash.projects.startYear.title")))}
              />
              {count > 0 ? (
                <rect
                  className="hub-dash-start-stage__bar"
                  style={{ animationDelay: stageIndex * 35 + "ms" }}
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(height, 2)}
                  rx={5}
                  fill={DASHBOARD_PROJECT_STAGE_COLORS[bucket]}
                  onMouseEnter={(event) => setTip(hoverTipAt(event, label, tipRows, t("hub.dash.projects.startYear.title")))}
                  onMouseMove={(event) => setTip(hoverTipAt(event, label, tipRows, t("hub.dash.projects.startYear.title")))}
                />
              ) : null}
              {count > 0 ? (
                <text
                  className="hub-dash-start-stage__num"
                  style={{ animationDelay: stageIndex * 35 + 250 + "ms" }}
                  x={center}
                  y={Math.max(y - 8, TOP + 10)}
                  textAnchor="middle"
                  fontSize={13.5}
                  fontWeight={650}
                  fill="#374151"
                  pointerEvents="none"
                >{count}</text>
              ) : null}
              <text x={center} y={LABEL_Y} textAnchor="middle" fontSize={axisFontSize} fill="#4b5563" fontWeight={500}>
                {labelLines.map((line, lineIndex) => (
                  <tspan key={line + ":" + lineIndex} x={center} y={LABEL_Y + lineIndex * LABEL_LINE_H}>{line}</tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
      <HubDashHoverTip tip={tip} />
    </>
  );
}

/**
 * 最新阶段 × 启动年份：
 * x = 九大阶段 + 异常归档 / 验收归档 / 归档-临时任务，y = 项目数；
 * 年份使用与项目统计图一致的多选方块筛选，悬停柱体显示所选年份的明细。
 */
export function HubDashStartYearStages({ insights, storageKeyPrefix }: {
  readonly insights: DashboardProjectInsights;
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
          <StageBars insights={insights} selectedYears={selectedYears} />
        </div>
      )}
    </div>
  );
}
