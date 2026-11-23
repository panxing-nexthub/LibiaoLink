import { useEffect, useState } from "react";
import { DASHBOARD_PROJECT_TYPE_COLORS, DASHBOARD_PROJECT_TYPES, type DashboardProjectInsights, type DashboardProjectTypeCode } from "../data/dashboardProjectInsights";
import { useT } from "../i18n";
import { usePersistentDashboardFilter } from "../dashboardFilterStorage";
import { dashboardAxisOf } from "../dashboardChartScale";
import { DASHBOARD_YEAR_WINDOW, DashboardYearNavigator, type DashboardYearKey } from "./DashboardYearNavigator";
import { HubDashHoverTip, hoverTipAt, type DashboardHoverTip } from "./HubDashHoverTip";
import { useResponsiveChartSize } from "./useResponsiveChartSize";

const PLOT_TOP = 18;
const BAR_MAX_W = 46;
const GROUP_INSET_RATIO = 0.16;
const MIN_CHART_W = 560;
const MIN_CHART_H = 120;

type YearKey = DashboardYearKey;
export type DashboardProjectChartKind = "bar" | "line";
type ChartKind = DashboardProjectChartKind;

function yearKey(year: YearKey): string { return year === null ? "unknown" : String(year); }
function includesYear(years: readonly YearKey[], year: YearKey): boolean { return years.some((item) => item === year); }

/**
 * 「全部项目」项目统计：x = 启动年份，柱状图为每组三根柱，折线图为三条按年份连接的趋势线。
 * 年份与类型均可点击筛选；年份默认最近 5 年，左右按钮切换年份窗口；最左侧「全选」与「折线图 / 柱状图」按钮同排。
 * 图表按钮切换柱状图 / 折线图；两种图形共用年份、类型筛选和悬停统计；点柱 / 数据点按「年份 × 类型」下钻项目列表。
 * 绘图区按容器实际像素重算，字号不随屏幕等比缩放，柱状图和折线图共用同一套居中坐标。
 */
export function HubDashProjectTypeYears({ insights, expanded = false, onChartTypeChange, onPick, storageKeyPrefix }: {
  readonly insights: DashboardProjectInsights;
  readonly expanded?: boolean;
  readonly onChartTypeChange?: (chartType: DashboardProjectChartKind) => void;
  /** 点柱 / 点折线数据点：按启动年份 × 项目类型打开项目列表。 */
  readonly onPick?: (year: YearKey, type: DashboardProjectTypeCode) => void;
  /** 全部项目仪表盘传入时，按账号记住年份 / 类型 / 图表类型筛选。 */
  readonly storageKeyPrefix?: string;
}) {
  const t = useT();
  const rows = insights.typeByYear;
  const numericYears = [...new Set(rows.map((row) => row.year).filter((year): year is number => year !== null))].sort((left, right) => left - right);
  const hasUnknownYear = rows.some((row) => row.year === null);
  const allYears: YearKey[] = hasUnknownYear ? [...numericYears, null] : [...numericYears];
  const [selectedYears, setSelectedYears] = usePersistentDashboardFilter<YearKey[]>(
    storageKeyPrefix ? storageKeyPrefix + ".selectedYears" : null,
    () => numericYears.slice(-DASHBOARD_YEAR_WINDOW),
    (value): value is YearKey[] => Array.isArray(value) && value.every((item) => item === null || typeof item === "number"),
  );
  const [visibleTypes, setVisibleTypes] = usePersistentDashboardFilter<DashboardProjectTypeCode[]>(
    storageKeyPrefix ? storageKeyPrefix + ".visibleTypes" : null,
    () => [...DASHBOARD_PROJECT_TYPES],
    (value): value is DashboardProjectTypeCode[] => Array.isArray(value) && value.every((item) => DASHBOARD_PROJECT_TYPES.includes(item as DashboardProjectTypeCode)),
  );
  const [yearWindowStart, setYearWindowStart] = usePersistentDashboardFilter<number>(
    storageKeyPrefix ? storageKeyPrefix + ".yearWindowStart" : null,
    () => Math.max(0, numericYears.length - DASHBOARD_YEAR_WINDOW),
    (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0,
  );
  const [chartType, setChartType] = usePersistentDashboardFilter<ChartKind>(
    storageKeyPrefix ? storageKeyPrefix + ".chartType" : null,
    "bar",
    (value): value is ChartKind => value === "bar" || value === "line",
  );
  const [tip, setTip] = useState<DashboardHoverTip | null>(null);
  const [hoverYear, setHoverYear] = useState<string | null>(null);
  const { ref: chartRef, width: availableWidth, height: availableHeight } = useResponsiveChartSize(1000, 240);
  const expandedLine = expanded && chartType === "line";
  useEffect(() => {
    onChartTypeChange?.(chartType);
  }, [chartType, onChartTypeChange]);
  const chartToggle = (): void => setChartType((current) => current === "bar" ? "line" : "bar");

  if (rows.length === 0) return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;

  const visibleYears = rows.filter((row) => includesYear(selectedYears, row.year));
  const activeTypeIndexes = DASHBOARD_PROJECT_TYPES.map((type, index) => ({ type, index })).filter((item) => visibleTypes.includes(item.type));
  const maxValue = visibleYears.reduce((max, row) => activeTypeIndexes.reduce((inner, item) => Math.max(inner, row.counts[item.index] ?? 0), max), 0);
  const { max: tickMax, step } = dashboardAxisOf(maxValue);
  const chartWidth = Math.max(availableWidth, MIN_CHART_W);
  const chartHeight = Math.max(availableHeight, MIN_CHART_H);
  const tickFontSize = Math.max(11.2, Math.min(14, chartWidth * 0.0058));
  const numberFontSize = Math.max(12.5, Math.min(15, chartWidth * 0.0062));
  const yearFontSize = Math.max(12.5, Math.min(15.5, chartWidth * 0.0064));
  const edgeX = Math.max(34, Math.min(50, Math.round(chartWidth * 0.03)));
  const plotX0 = edgeX;
  const plotX1 = chartWidth - edgeX;
  const axisY = chartHeight - 30;
  const tickLabelY = axisY + 20;
  const unit = (axisY - PLOT_TOP) / tickMax;
  const groupW = visibleYears.length === 0 ? plotX1 - plotX0 : (plotX1 - plotX0) / visibleYears.length;
  const itemW = groupW * (1 - GROUP_INSET_RATIO * 2) / Math.max(activeTypeIndexes.length, 1);
  const barW = Math.min(BAR_MAX_W, itemW * 0.64);
  const groupGap = itemW - barW;
  const ticks: number[] = [];
  for (let value = 0; value <= tickMax; value += step) ticks.push(value);
  const allSelected = allYears.length > 0 && allYears.every((year) => includesYear(selectedYears, year));
  const toggleYear = (year: YearKey): void => setSelectedYears((current) => includesYear(current, year) ? current.filter((item) => item !== year) : [...current, year]);
  const toggleType = (type: DashboardProjectTypeCode): void => setVisibleTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  const yearText = (year: YearKey): string => year === null ? t("hub.dash.projects.unknownYear") : String(year);
  const lineSeries = activeTypeIndexes.map((item) => ({
    type: item.type,
    color: DASHBOARD_PROJECT_TYPE_COLORS[item.type],
    points: visibleYears.map((row, yearIndex) => {
      const count = row.counts[item.index] ?? 0;
      return {
        row,
        yearIndex,
        count,
        x: plotX0 + groupW * yearIndex + groupW / 2,
        y: axisY - count * unit,
      };
    }),
  }));

  return (
    <div className="hub-dash-project-types-wrap">
      <div className="hub-dash-project-types__controls">
        <div className="hub-dash-project-types__filterGrid">
          <div className="hub-dash-project-types__leftControls">
            <button type="button" className="hub-dash-project-types__selectAll" data-active={allSelected ? "true" : "false"} aria-pressed={allSelected} onClick={() => setSelectedYears(allSelected ? [] : [...allYears])}>{t("hub.dash.projects.selectAll")}</button>
            <button
              type="button"
              className="hub-dash-project-types__selectAll hub-dash-project-types__chartToggle"
              data-active={chartType === "line" ? "true" : "false"}
              aria-pressed={chartType === "line"}
              aria-label={t("hub.dash.projects.typeYear.viewToggle")}
              onClick={chartToggle}
            >{chartType === "bar" ? t("hub.dash.projects.typeYear.viewLine") : t("hub.dash.projects.typeYear.viewBar")}</button>
          </div>
          <div className="hub-dash-project-types__rightFilters">
            <DashboardYearNavigator
              numericYears={numericYears}
              hasUnknownYear={hasUnknownYear}
              selectedYears={selectedYears}
              onToggleYear={toggleYear}
              windowStart={yearWindowStart}
              onWindowStartChange={setYearWindowStart}
            />
            <div className="hub-dash-project-types__typeLine">
              {DASHBOARD_PROJECT_TYPES.map((type) => {
                const active = visibleTypes.includes(type);
                return (
                  <button key={type} type="button" className="hub-dash-project-types__typeChip" data-active={active ? "true" : "false"} aria-pressed={active} onClick={() => toggleType(type)}>
                    <i style={{ background: active ? DASHBOARD_PROJECT_TYPE_COLORS[type] : "#c9ced6" }} /><span>{type}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {visibleYears.length === 0 || activeTypeIndexes.length === 0 ? (
        <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>
      ) : (
        <div ref={chartRef} className="hub-dash-chartViewport hub-dash-project-types__viewport" data-chart="project-type">
          <div className="hub-dash-chartCanvas" style={{ width: chartWidth + "px" }}>
            <svg
              className="hub-dash-project-types"
              width={chartWidth}
              height={chartHeight}
              viewBox={"0 0 " + chartWidth + " " + chartHeight}
              data-expanded={expandedLine ? "true" : "false"}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={chartType === "bar" ? t("hub.dash.projects.typeYear.aria") : t("hub.dash.projects.typeYear.ariaLine")}
              onMouseLeave={() => { setTip(null); setHoverYear(null); }}
            >
              {ticks.map((value) => value > 0 ? <line key={"grid-" + value} x1={plotX0} y1={axisY - value * unit} x2={plotX1} y2={axisY - value * unit} stroke="#e8eaee" strokeDasharray="3 4" /> : null)}
              <line x1={plotX0 - 8} y1={axisY} x2={plotX1 + 8} y2={axisY} stroke="#b8bec6" />
              {ticks.map((value) => <text key={"tick-" + value} x={plotX0 - 9} y={axisY - value * unit + 4} textAnchor="end" fontSize={tickFontSize} fill="#8a9099">{value}</text>)}

              {visibleYears.map((row, yearIndex) => {
                const groupX = plotX0 + groupW * yearIndex;
                const baselineLabel = yearText(row.year);
                const key = yearKey(row.year);
                const yearRows = activeTypeIndexes.map((item) => ({ label: item.type, value: row.counts[item.index] ?? 0, color: DASHBOARD_PROJECT_TYPE_COLORS[item.type] }));
                return (
                  <rect
                    key={"band-" + key}
                    className="hub-dash-project-types__band"
                    x={groupX + 4}
                    y={PLOT_TOP - 6}
                    width={Math.max(groupW - 8, 1)}
                    height={axisY - PLOT_TOP + 6}
                    rx={8}
                    fill="transparent"
                    onMouseEnter={(event) => { setHoverYear(key); setTip(hoverTipAt(event, baselineLabel, yearRows, t("hub.dash.projects.typeYear.title"))); }}
                    onMouseMove={(event) => { setHoverYear(key); setTip(hoverTipAt(event, baselineLabel, yearRows, t("hub.dash.projects.typeYear.title"))); }}
                  />
                );
              })}

              {chartType === "bar" ? visibleYears.map((row, yearIndex) => {
                const groupX = plotX0 + groupW * yearIndex;
                const startX = groupX + groupW * GROUP_INSET_RATIO;
                const baselineLabel = yearText(row.year);
                return (
                  <g key={"bars-" + yearKey(row.year)}>
                    {activeTypeIndexes.map((item, typeIndex) => {
                      const count = row.counts[item.index] ?? 0;
                      const height = count * unit;
                      const x = startX + typeIndex * itemW + groupGap / 2;
                      const y = axisY - height;
                      const color = DASHBOARD_PROJECT_TYPE_COLORS[item.type];
                      return (
                        <g key={item.type}>
                          {count > 0 ? <rect className="hub-dash-project-types__bar" data-drill={onPick === undefined ? undefined : "true"} style={{ animationDelay: yearIndex * 55 + typeIndex * 30 + "ms" }} x={x} y={y} width={barW} height={Math.max(height, 2)} rx={4} fill={color} onClick={onPick === undefined ? undefined : () => { onPick(row.year, item.type); }} onMouseEnter={(event) => { setHoverYear(null); setTip(hoverTipAt(event, baselineLabel, [{ label: t("hub.dash.projects.projectCount"), value: count, color }], item.type)); }} onMouseMove={(event) => { setHoverYear(null); setTip(hoverTipAt(event, baselineLabel, [{ label: t("hub.dash.projects.projectCount"), value: count, color }], item.type)); }} /> : null}
                          {count > 0 && hoverYear !== yearKey(row.year) ? <text className="hub-dash-project-types__num" style={{ animationDelay: yearIndex * 55 + typeIndex * 30 + 300 + "ms" }} x={x + barW / 2} y={y - 8} textAnchor="middle" fontSize={numberFontSize} fontWeight={600} fill="#374151" pointerEvents="none">{count}</text> : null}
                        </g>
                      );
                    })}
                  </g>
                );
              }) : (
                <>
                  {lineSeries.map((series, seriesIndex) => (
                    <polyline
                      key={"line-" + series.type}
                      className="hub-dash-project-types__line"
                      points={series.points.map((point) => point.x + "," + point.y).join(" ")}
                      pathLength={1}
                      style={{ animationDelay: seriesIndex * 90 + "ms" }}
                      fill="none"
                      stroke={series.color}
                      strokeWidth={3.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                  ))}
                  {lineSeries.map((series, seriesIndex) => series.points.map((point) => {
                    const baselineLabel = yearText(point.row.year);
                    const key = yearKey(point.row.year);
                    const pointDelay = seriesIndex * 80 + point.yearIndex * 65 + 240;
                    return (
                      <g key={"point-" + series.type + "-" + key}>
                        <circle
                          className="hub-dash-project-types__pointHit"
                          data-drill={onPick === undefined ? undefined : "true"}
                          cx={point.x}
                          cy={point.y}
                          r={11}
                          fill="transparent"
                          onClick={onPick === undefined ? undefined : () => { onPick(point.row.year, series.type); }}
                          onMouseEnter={(event) => { setHoverYear(null); setTip(hoverTipAt(event, baselineLabel, [{ label: t("hub.dash.projects.projectCount"), value: point.count, color: series.color }], series.type)); }}
                          onMouseMove={(event) => { setHoverYear(null); setTip(hoverTipAt(event, baselineLabel, [{ label: t("hub.dash.projects.projectCount"), value: point.count, color: series.color }], series.type)); }}
                        />
                        <circle className="hub-dash-project-types__point" style={{ animationDelay: pointDelay + "ms" }} cx={point.x} cy={point.y} r={4.8} fill={series.color} stroke="#ffffff" strokeWidth={2} pointerEvents="none" />
                        {point.count > 0 && hoverYear !== key ? <text className="hub-dash-project-types__num" style={{ animationDelay: pointDelay + 120 + "ms" }} x={point.x} y={point.y - 10} textAnchor="middle" fontSize={numberFontSize} fontWeight={600} fill="#374151" pointerEvents="none">{point.count}</text> : null}
                      </g>
                    );
                  }))}
                </>
              )}

              {visibleYears.map((row, yearIndex) => {
                const groupX = plotX0 + groupW * yearIndex;
                const key = yearKey(row.year);
                const visibleTotal = activeTypeIndexes.reduce((sum, item) => sum + (row.counts[item.index] ?? 0), 0);
                return (
                  <g key={"labels-" + key}>
                    {hoverYear === key ? (
                      <text
                        className="hub-dash-project-types__hoverTotal"
                        x={groupX + groupW / 2}
                        y={PLOT_TOP + 20}
                        textAnchor="middle"
                        fontSize={Math.max(16, Math.min(22, groupW * 0.12))}
                        fontWeight={700}
                        fill="#334155"
                        pointerEvents="none"
                      >{visibleTotal}</text>
                    ) : null}
                    <text x={groupX + groupW / 2} y={tickLabelY} textAnchor="middle" fontSize={row.year === null ? Math.max(11.2, tickFontSize - 1) : yearFontSize} fill="#4b5563">{yearText(row.year)}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}
      <HubDashHoverTip tip={tip} />
    </div>
  );
}
