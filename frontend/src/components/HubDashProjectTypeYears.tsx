import { useState } from "react";
import { DASHBOARD_PROJECT_TYPE_COLORS, DASHBOARD_PROJECT_TYPES, type DashboardProjectInsights, type DashboardProjectTypeCode } from "../data/dashboardProjectInsights";
import { useT } from "../i18n";
import { HubDashHoverTip, hoverTipAt, type DashboardHoverTip } from "./HubDashHoverTip";

const VIEW_W = 1200;
const VIEW_H = 360;
const PLOT_X0 = 88;
const PLOT_X1 = 1168;
const PLOT_TOP = 22;
const AXIS_Y = 296;
const TICK_LABEL_Y = 322;
const BAR_MAX_W = 46;
const GROUP_INSET_RATIO = 0.16;
const YEAR_WINDOW = 3;

type YearKey = number | null;

function axisOf(maxValue: number): { max: number; step: number } {
  if (maxValue <= 5) return { max: Math.max(1, maxValue), step: 1 };
  const raw = maxValue / 4;
  const step = raw <= 1 ? 1 : raw <= 2 ? 2 : raw <= 5 ? 5 : raw <= 10 ? 10 : raw <= 20 ? 20 : raw <= 50 ? 50 : 100;
  return { max: Math.max(step, Math.ceil(maxValue / step) * step), step };
}

function yearKey(year: YearKey): string { return year === null ? "unknown" : String(year); }
function includesYear(years: readonly YearKey[], year: YearKey): boolean { return years.some((item) => item === year); }

/**
 * 「全部项目」项目数量统计：x = 启动年份，每组三根柱 = T-sort / 3D分拣 / 飞箱。
 * 年份与类型均可点击筛选；年份默认最近 3 年，左右按钮切换年份窗口；最左侧「全选」为液态玻璃按钮。
 * 悬停年份阴影区时，在区域中央显示当前可见类型的粗体项目总数。
 */
export function HubDashProjectTypeYears({ insights }: { readonly insights: DashboardProjectInsights }) {
  const t = useT();
  const rows = insights.typeByYear;
  const numericYears = [...new Set(rows.map((row) => row.year).filter((year): year is number => year !== null))].sort((left, right) => left - right);
  const hasUnknownYear = rows.some((row) => row.year === null);
  const allYears: YearKey[] = hasUnknownYear ? [...numericYears, null] : [...numericYears];
  const [selectedYears, setSelectedYears] = useState<YearKey[]>(() => numericYears.slice(-YEAR_WINDOW));
  const [visibleTypes, setVisibleTypes] = useState<DashboardProjectTypeCode[]>([...DASHBOARD_PROJECT_TYPES]);
  const [yearWindowStart, setYearWindowStart] = useState(() => Math.max(0, numericYears.length - YEAR_WINDOW));
  const [tip, setTip] = useState<DashboardHoverTip | null>(null);
  const [hoverYear, setHoverYear] = useState<string | null>(null);

  if (rows.length === 0) return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;

  const visibleYears = rows.filter((row) => includesYear(selectedYears, row.year));
  const activeTypeIndexes = DASHBOARD_PROJECT_TYPES.map((type, index) => ({ type, index })).filter((item) => visibleTypes.includes(item.type));
  const maxValue = visibleYears.reduce((max, row) => activeTypeIndexes.reduce((inner, item) => Math.max(inner, row.counts[item.index] ?? 0), max), 0);
  const { max: tickMax, step } = axisOf(Math.max(maxValue, 1));
  const unit = (AXIS_Y - PLOT_TOP) / tickMax;
  const groupW = visibleYears.length === 0 ? PLOT_X1 - PLOT_X0 : (PLOT_X1 - PLOT_X0) / visibleYears.length;
  const itemW = groupW * (1 - GROUP_INSET_RATIO * 2) / Math.max(activeTypeIndexes.length, 1);
  const barW = Math.min(BAR_MAX_W, itemW * 0.64);
  const groupGap = itemW - barW;
  const ticks: number[] = [];
  for (let value = 0; value <= tickMax; value += step) ticks.push(value);
  const visibleYearChars = numericYears.slice(yearWindowStart, yearWindowStart + YEAR_WINDOW);
  const allSelected = allYears.length > 0 && allYears.every((year) => includesYear(selectedYears, year));
  const toggleYear = (year: YearKey): void => setSelectedYears((current) => includesYear(current, year) ? current.filter((item) => item !== year) : [...current, year]);
  const toggleType = (type: DashboardProjectTypeCode): void => setVisibleTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  const yearText = (year: YearKey): string => year === null ? t("hub.dash.projects.unknownYear") : String(year);

  return (
    <div className="hub-dash-project-types-wrap">
      <div className="hub-dash-project-types__controls">
        <div className="hub-dash-project-types__yearLine">
          <button type="button" className="hub-dash-project-types__selectAll" data-active={allSelected ? "true" : "false"} aria-pressed={allSelected} onClick={() => setSelectedYears(allSelected ? [] : [...allYears])}>{t("hub.dash.projects.selectAll")}</button>
          <button type="button" className="hub-dash-project-types__arrow" disabled={yearWindowStart <= 0} aria-label={t("hub.dash.projects.yearPrev")} onClick={() => setYearWindowStart((start) => Math.max(0, start - YEAR_WINDOW))}>《</button>
          <div className="hub-dash-project-types__yearChips">
            {visibleYearChars.map((year) => (
              <button key={year} type="button" className="hub-dash-project-types__yearChip" data-active={includesYear(selectedYears, year) ? "true" : "false"} aria-pressed={includesYear(selectedYears, year)} onClick={() => toggleYear(year)}>
                <i /><span>{year}</span>
              </button>
            ))}
            {hasUnknownYear ? (
              <button type="button" className="hub-dash-project-types__yearChip" data-active={includesYear(selectedYears, null) ? "true" : "false"} aria-pressed={includesYear(selectedYears, null)} onClick={() => toggleYear(null)}>
                <i /><span>{t("hub.dash.projects.unknownYear")}</span>
              </button>
            ) : null}
          </div>
          <button type="button" className="hub-dash-project-types__arrow" disabled={yearWindowStart + YEAR_WINDOW >= numericYears.length} aria-label={t("hub.dash.projects.yearNext")} onClick={() => setYearWindowStart((start) => Math.min(Math.max(0, numericYears.length - YEAR_WINDOW), start + YEAR_WINDOW))}>》</button>
        </div>
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

      {visibleYears.length === 0 || activeTypeIndexes.length === 0 ? (
        <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>
      ) : (
        <svg className="hub-dash-project-types" viewBox={"0 0 " + VIEW_W + " " + VIEW_H} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t("hub.dash.projects.typeYear.aria")} onMouseLeave={() => { setTip(null); setHoverYear(null); }}>
          {ticks.map((value) => value > 0 ? <line key={"grid-" + value} x1={PLOT_X0} y1={AXIS_Y - value * unit} x2={PLOT_X1} y2={AXIS_Y - value * unit} stroke="#e8eaee" strokeDasharray="3 4" /> : null)}
          <line x1={PLOT_X0 - 8} y1={AXIS_Y} x2={PLOT_X1 + 8} y2={AXIS_Y} stroke="#b8bec6" />
          {ticks.map((value) => <text key={"tick-" + value} x={PLOT_X0 - 14} y={AXIS_Y - value * unit + 4} textAnchor="end" fontSize={12} fill="#8a9099">{value}</text>)}
          {visibleYears.map((row, yearIndex) => {
            const groupX = PLOT_X0 + groupW * yearIndex;
            const startX = groupX + groupW * GROUP_INSET_RATIO;
            const baselineLabel = yearText(row.year);
            const key = yearKey(row.year);
            const visibleTotal = activeTypeIndexes.reduce((sum, item) => sum + (row.counts[item.index] ?? 0), 0);
            const yearRows = activeTypeIndexes.map((item) => ({ label: item.type, value: row.counts[item.index] ?? 0, color: DASHBOARD_PROJECT_TYPE_COLORS[item.type] }));
            return (
              <g key={key}>
                <rect className="hub-dash-project-types__band" x={groupX + 4} y={PLOT_TOP - 6} width={Math.max(groupW - 8, 1)} height={AXIS_Y - PLOT_TOP + 6} rx={8} fill="transparent" onMouseEnter={(event) => { setHoverYear(key); setTip(hoverTipAt(event, baselineLabel, yearRows, t("hub.dash.projects.typeYear.title"))); }} onMouseMove={(event) => { setHoverYear(key); setTip(hoverTipAt(event, baselineLabel, yearRows, t("hub.dash.projects.typeYear.title"))); }} />
                {activeTypeIndexes.map((item, typeIndex) => {
                  const count = row.counts[item.index] ?? 0;
                  const height = count * unit;
                  const x = startX + typeIndex * itemW + groupGap / 2;
                  const y = AXIS_Y - height;
                  return (
                    <g key={item.type}>
                      {count > 0 ? <rect className="hub-dash-project-types__bar" style={{ animationDelay: yearIndex * 55 + typeIndex * 30 + "ms" }} x={x} y={y} width={barW} height={Math.max(height, 2)} rx={4} fill={DASHBOARD_PROJECT_TYPE_COLORS[item.type]} onMouseEnter={(event) => { setHoverYear(key); setTip(hoverTipAt(event, baselineLabel, [{ label: t("hub.dash.projects.projectCount"), value: count, color: DASHBOARD_PROJECT_TYPE_COLORS[item.type] }], item.type)); }} onMouseMove={(event) => { setHoverYear(key); setTip(hoverTipAt(event, baselineLabel, [{ label: t("hub.dash.projects.projectCount"), value: count, color: DASHBOARD_PROJECT_TYPE_COLORS[item.type] }], item.type)); }} /> : null}
                      {count > 0 ? <text className="hub-dash-project-types__num" style={{ animationDelay: yearIndex * 55 + typeIndex * 30 + 300 + "ms" }} x={x + barW / 2} y={Math.max(y - 8, PLOT_TOP + 10)} textAnchor="middle" fontSize={13} fontWeight={600} fill="#374151" pointerEvents="none">{count}</text> : null}
                    </g>
                  );
                })}
                {hoverYear === key ? <text className="hub-dash-project-types__hoverTotal" x={groupX + groupW / 2} y={(PLOT_TOP + AXIS_Y) / 2 + 8} textAnchor="middle" fontSize={28} fontWeight={700} fill="#475569" stroke="#ffffff" strokeWidth={6} paintOrder="stroke" pointerEvents="none">{visibleTotal}</text> : null}
                <text x={groupX + groupW / 2} y={TICK_LABEL_Y + 15} textAnchor="middle" fontSize={row.year === null ? 11.5 : 13} fill="#4b5563">{baselineLabel}</text>
              </g>
            );
          })}
        </svg>
      )}
      <HubDashHoverTip tip={tip} />
    </div>
  );
}
