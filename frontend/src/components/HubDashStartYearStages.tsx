import { useState } from "react";
import { stageText, useLocale, useT } from "../i18n";
import { HubDashHoverTip, hoverTipAt, type DashboardHoverTip } from "./HubDashHoverTip";
import {
  DASHBOARD_PROJECT_STAGE_BUCKETS,
  DASHBOARD_PROJECT_STAGE_COLORS,
  dashboardProjectStageLabel,
  type DashboardProjectInsights,
} from "../data/dashboardProjectInsights";

const BAR_W = 760;
const BAR_H = 400;
const LEFT = 54;
const RIGHT = 20;
const TOP = 20;
const AXIS_Y = 326;
const LABEL_Y = 350;
const BAR_MAX_W = 54;
const BAR_INSET_RATIO = 0.22;
const PIE_SIZE = 320;
const PIE_CX = 160;
const PIE_CY = 160;
const PIE_R = 126;
const PIE_INNER_R = 78;

type YearSelection = "all" | number | null;

function axisOf(maxValue: number): { max: number; step: number } {
  if (maxValue <= 5) return { max: Math.max(1, maxValue), step: 1 };
  const raw = maxValue / 4;
  const step = raw <= 1 ? 1 : raw <= 2 ? 2 : raw <= 5 ? 5 : raw <= 10 ? 10 : raw <= 20 ? 20 : raw <= 50 ? 50 : 100;
  return { max: Math.max(step, Math.ceil(maxValue / step) * step), step };
}

function zeroCounts(): number[] {
  return DASHBOARD_PROJECT_STAGE_BUCKETS.map(() => 0);
}

function yearLabel(year: number | null, unknownLabel: string): string {
  return year === null ? unknownLabel : String(year);
}

function donutSegmentPath(start: number, end: number): string {
  const largeArc = end - start > Math.PI ? 1 : 0;
  const outerStartX = PIE_CX + PIE_R * Math.cos(start);
  const outerStartY = PIE_CY + PIE_R * Math.sin(start);
  const outerEndX = PIE_CX + PIE_R * Math.cos(end);
  const outerEndY = PIE_CY + PIE_R * Math.sin(end);
  const innerEndX = PIE_CX + PIE_INNER_R * Math.cos(end);
  const innerEndY = PIE_CY + PIE_INNER_R * Math.sin(end);
  const innerStartX = PIE_CX + PIE_INNER_R * Math.cos(start);
  const innerStartY = PIE_CY + PIE_INNER_R * Math.sin(start);
  return [
    "M " + outerStartX + " " + outerStartY,
    "A " + PIE_R + " " + PIE_R + " 0 " + largeArc + " 1 " + outerEndX + " " + outerEndY,
    "L " + innerEndX + " " + innerEndY,
    "A " + PIE_INNER_R + " " + PIE_INNER_R + " 0 " + largeArc + " 0 " + innerStartX + " " + innerStartY,
    "Z",
  ].join(" ");
}

function StartYearBars({ insights, selected, onSelect }: {
  readonly insights: DashboardProjectInsights;
  readonly selected: YearSelection;
  readonly onSelect: (year: number | null) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [tip, setTip] = useState<DashboardHoverTip | null>(null);
  const rows = insights.startYearStages;
  if (rows.length === 0) return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  const maxValue = rows.reduce((max, row) => Math.max(max, row.total), 0);
  const { max: tickMax, step } = axisOf(Math.max(maxValue, 1));
  const unit = (AXIS_Y - TOP) / tickMax;
  const slotW = (BAR_W - LEFT - RIGHT) / rows.length;
  const barW = Math.min(BAR_MAX_W, slotW * (1 - BAR_INSET_RATIO * 2));
  const ticks: number[] = [];
  for (let value = 0; value <= tickMax; value += step) ticks.push(value);
  return (
    <>
    <svg
      className="hub-dash-start-year"
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
        <text key={"tick-" + value} x={LEFT - 11} y={AXIS_Y - value * unit + 4} textAnchor="end" fontSize={11.5} fill="#8a9099">{value}</text>
      ))}
      {rows.map((row, yearIndex) => {
        const center = LEFT + slotW * yearIndex + slotW / 2;
        const x = center - barW / 2;
        const label = yearLabel(row.year, t("hub.dash.projects.unknownYear"));
        const active = selected !== "all" && selected === row.year;
        const stageRows = DASHBOARD_PROJECT_STAGE_BUCKETS.flatMap((bucket, stageIndex) => {
          const count = row.stageCounts[stageIndex] ?? 0;
          return count > 0 ? [{ label: stageText(locale, dashboardProjectStageLabel(bucket)), value: count, color: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }] : [];
        });
        stageRows.push({ label: t("hub.dash.projects.total"), value: row.total, color: "#94a3b8" });
        let cursorY = AXIS_Y;
        return (
          <g
            key={row.year === null ? "unknown" : String(row.year)}
            className="hub-dash-start-year__year"
            data-selected={active ? "true" : "false"}
            onClick={() => onSelect(row.year)}
            role="button"
            tabIndex={0}
            aria-label={t("hub.dash.projects.startYear.select", { year: label })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(row.year);
              }
            }}
          >
            <rect
              className="hub-dash-start-year__band"
              x={LEFT + slotW * yearIndex}
              y={TOP}
              width={slotW}
              height={AXIS_Y - TOP}
              fill={active ? "#f5f7fb" : "transparent"}
              rx={8}
              onMouseEnter={(event) => setTip(hoverTipAt(event, label, stageRows, t("hub.dash.projects.startYear.title")))}
              onMouseMove={(event) => setTip(hoverTipAt(event, label, stageRows, t("hub.dash.projects.startYear.title")))}
            />
            {DASHBOARD_PROJECT_STAGE_BUCKETS.map((bucket, stageIndex) => {
              const count = row.stageCounts[stageIndex] ?? 0;
              if (count <= 0) return null;
              const height = count * unit;
              const y = cursorY - height;
              cursorY = y;
              const stageLabel = stageText(locale, dashboardProjectStageLabel(bucket));
              return (
                <g key={bucket}>
                  <rect
                    className="hub-dash-start-year__segment"
                    style={{ animationDelay: yearIndex * 55 + stageIndex * 14 + "ms" }}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(height, 1.5)}
                    fill={DASHBOARD_PROJECT_STAGE_COLORS[bucket]}
                    onMouseEnter={(event) => setTip(hoverTipAt(event, label, [{ label: t("hub.dash.projects.projectCount"), value: count, color: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }], stageLabel))}
                    onMouseMove={(event) => setTip(hoverTipAt(event, label, [{ label: t("hub.dash.projects.projectCount"), value: count, color: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }], stageLabel))}
                  />
                  {height >= 12 ? (
                    <text x={center} y={y + height / 2 + 3.8} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={bucket === "purchase" ? "#313033" : "#ffffff"} pointerEvents="none">{count}</text>
                  ) : null}
                </g>
              );
            })}
            <text x={center} y={LABEL_Y + 14} textAnchor="middle" fontSize={row.year === null ? 10.5 : 12} fill={active ? "#1d4ed8" : "#4b5563"} fontWeight={active ? 700 : 500}>{label}</text>
          </g>
        );
      })}
    </svg>
    <HubDashHoverTip tip={tip} />
    </>
  );
}

function StartYearPie({ insights, selected }: { readonly insights: DashboardProjectInsights; readonly selected: YearSelection }) {
  const t = useT();
  const locale = useLocale();
  const [tip, setTip] = useState<DashboardHoverTip | null>(null);
  const rows = insights.startYearStages;
  const allCounts = zeroCounts();
  for (const row of rows) {
    row.stageCounts.forEach((count, index) => { allCounts[index] = (allCounts[index] ?? 0) + count; });
  }
  const selectedRow = selected === "all" ? undefined : rows.find((row) => row.year === selected);
  const counts = selected === "all" ? allCounts : selectedRow?.stageCounts ?? zeroCounts();
  const total = counts.reduce((sum, count) => sum + count, 0);
  const selectedLabel = selected === "all" ? t("hub.dash.projects.allYears") : yearLabel(selected, t("hub.dash.projects.unknownYear"));
  if (total === 0) return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  const nonZero = DASHBOARD_PROJECT_STAGE_BUCKETS
    .map((bucket, index) => ({ bucket, count: counts[index] ?? 0 }))
    .filter((item) => item.count > 0);
  let angle = -Math.PI / 2;
  const segments = nonZero.map((item) => {
    const start = angle;
    const end = start + (item.count / total) * Math.PI * 2;
    angle = end;
    return { ...item, start, end };
  });
  return (
    <>
    <div className="hub-dash-start-pie">
      <svg viewBox={"0 0 " + PIE_SIZE + " " + PIE_SIZE} role="img" aria-label={t("hub.dash.projects.startYear.pieAria", { year: selectedLabel })} onMouseLeave={() => setTip(null)}>
        {segments.length === 1 ? (
          <circle
            className="hub-dash-start-pie__segment"
            cx={PIE_CX}
            cy={PIE_CY}
            r={(PIE_R + PIE_INNER_R) / 2}
            fill="none"
            stroke={DASHBOARD_PROJECT_STAGE_COLORS[segments[0].bucket]}
            strokeWidth={PIE_R - PIE_INNER_R}
            onMouseEnter={(event) => {
              const label = stageText(locale, dashboardProjectStageLabel(segments[0].bucket));
              setTip(hoverTipAt(event, selectedLabel, [
                { label: t("hub.dash.projects.projectCount"), value: segments[0].count, color: DASHBOARD_PROJECT_STAGE_COLORS[segments[0].bucket] },
                { label: t("hub.dash.projects.share"), value: "100%", color: "#94a3b8" },
              ], label));
            }}
            onMouseMove={(event) => {
              const label = stageText(locale, dashboardProjectStageLabel(segments[0].bucket));
              setTip(hoverTipAt(event, selectedLabel, [
                { label: t("hub.dash.projects.projectCount"), value: segments[0].count, color: DASHBOARD_PROJECT_STAGE_COLORS[segments[0].bucket] },
                { label: t("hub.dash.projects.share"), value: "100%", color: "#94a3b8" },
              ], label));
            }}
          />
        ) : segments.map((segment) => {
          const label = stageText(locale, dashboardProjectStageLabel(segment.bucket));
          return (
            <path
              key={segment.bucket}
              className="hub-dash-start-pie__segment"
              d={donutSegmentPath(segment.start, segment.end)}
              fill={DASHBOARD_PROJECT_STAGE_COLORS[segment.bucket]}
              stroke="#ffffff"
              strokeWidth={2}
              onMouseEnter={(event) => setTip(hoverTipAt(event, selectedLabel, [
                { label: t("hub.dash.projects.projectCount"), value: segment.count, color: DASHBOARD_PROJECT_STAGE_COLORS[segment.bucket] },
                { label: t("hub.dash.projects.share"), value: Math.round((segment.count / total) * 100) + "%", color: "#94a3b8" },
              ], label))}
              onMouseMove={(event) => setTip(hoverTipAt(event, selectedLabel, [
                { label: t("hub.dash.projects.projectCount"), value: segment.count, color: DASHBOARD_PROJECT_STAGE_COLORS[segment.bucket] },
                { label: t("hub.dash.projects.share"), value: Math.round((segment.count / total) * 100) + "%", color: "#94a3b8" },
              ], label))}
            />
          );
        })}
        <text x={PIE_CX} y={PIE_CY - 5} textAnchor="middle" fontSize={13} fill="#6b7280">{selectedLabel}</text>
        <text x={PIE_CX} y={PIE_CY + 22} textAnchor="middle" fontSize={25} fontWeight={700} fill="#111827">{total}</text>
      </svg>
      <div className="hub-dash-start-pie__list">
        {segments.map((segment) => {
          const label = stageText(locale, dashboardProjectStageLabel(segment.bucket));
          const share = Math.round((segment.count / total) * 100);
          return (
            <div
              key={segment.bucket}
              className="hub-dash-start-pie__row"
              onMouseEnter={(event) => setTip(hoverTipAt(event, selectedLabel, [
                { label: t("hub.dash.projects.projectCount"), value: segment.count, color: DASHBOARD_PROJECT_STAGE_COLORS[segment.bucket] },
                { label: t("hub.dash.projects.share"), value: share + "%", color: "#94a3b8" },
              ], label))}
              onMouseMove={(event) => setTip(hoverTipAt(event, selectedLabel, [
                { label: t("hub.dash.projects.projectCount"), value: segment.count, color: DASHBOARD_PROJECT_STAGE_COLORS[segment.bucket] },
                { label: t("hub.dash.projects.share"), value: share + "%", color: "#94a3b8" },
              ], label))}
            >
              <i style={{ background: DASHBOARD_PROJECT_STAGE_COLORS[segment.bucket] }} />
              <span className="hub-dash-start-pie__name">{label}</span>
              <span className="hub-dash-start-pie__count">{segment.count}</span>
              <span className="hub-dash-start-pie__share">{share}%</span>
            </div>
          );
        })}
      </div>
    </div>
    <HubDashHoverTip tip={tip} />
    </>
  );
}

/**
 * 启动年份 × 最新阶段：左侧按年份堆叠柱状图，右侧为当前选择年份的阶段占比饼图。
 * 年份默认「全部年份」；点击年份柱或年份按钮可切换饼图年份。
 */
export function HubDashStartYearStages({ insights }: { readonly insights: DashboardProjectInsights }) {
  const t = useT();
  const locale = useLocale();
  const [selected, setSelected] = useState<YearSelection>("all");
  const rows = insights.startYearStages;
  if (rows.length === 0) return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  return (
    <div className="hub-dash-start">
      <div className="hub-dash-start__toolbar">
        <div className="hub-dash-start__legend">
          {DASHBOARD_PROJECT_STAGE_BUCKETS.map((bucket) => (
            <span key={bucket} className="hub-dash-start__legendItem">
              <i style={{ background: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }} />
              {stageText(locale, dashboardProjectStageLabel(bucket))}
            </span>
          ))}
        </div>
        <div className="hub-dash-start__years" role="group" aria-label={t("hub.dash.projects.startYear.pickYear")}>
          <button type="button" aria-pressed={selected === "all"} data-active={selected === "all" ? "true" : "false"} onClick={() => setSelected("all")}>{t("hub.dash.projects.allYears")}</button>
          {rows.map((row) => {
            const label = yearLabel(row.year, t("hub.dash.projects.unknownYear"));
            return (
              <button
                key={row.year === null ? "unknown" : String(row.year)}
                type="button"
                aria-pressed={selected !== "all" && selected === row.year}
                data-active={selected !== "all" && selected === row.year ? "true" : "false"}
                onClick={() => setSelected(row.year)}
              >{label}</button>
            );
          })}
        </div>
      </div>
      <div className="hub-dash-start__grid">
        <div className="hub-dash-start__bars">
          <StartYearBars insights={insights} selected={selected} onSelect={setSelected} />
        </div>
        <div className="hub-dash-start__pie">
          <StartYearPie insights={insights} selected={selected} />
        </div>
      </div>
    </div>
  );
}
