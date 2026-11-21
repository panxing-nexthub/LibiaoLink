import { DASHBOARD_PROJECT_TYPE_COLORS, DASHBOARD_PROJECT_TYPES, type DashboardProjectInsights } from "../data/dashboardProjectInsights";
import { useT } from "../i18n";

/** 年份内三根柱子；配色沿用现有仪表盘柱状图的蓝 / 黄 / 绿。 */
const VIEW_W = 1200;
const VIEW_H = 430;
const PLOT_X0 = 88;
const PLOT_X1 = 1168;
const PLOT_TOP = 78;
const AXIS_Y = 358;
const TICK_LABEL_Y = 382;
const BAR_MAX_W = 46;
const GROUP_INSET_RATIO = 0.16;

function axisOf(maxValue: number): { max: number; step: number } {
  if (maxValue <= 5) return { max: Math.max(1, maxValue), step: 1 };
  const raw = maxValue / 4;
  const step = raw <= 1 ? 1 : raw <= 2 ? 2 : raw <= 5 ? 5 : raw <= 10 ? 10 : raw <= 20 ? 20 : raw <= 50 ? 50 : 100;
  return { max: Math.max(step, Math.ceil(maxValue / step) * step), step };
}

/**
 * 「全部项目」项目数量统计：x = 启动年份，每组三根柱 = T-sort / 3D分拣 / 飞箱。
 * 多类型项目在每个命中类型各计一次；未记录启动年份的项目置最后一组。
 */
export function HubDashProjectTypeYears({ insights }: { readonly insights: DashboardProjectInsights }) {
  const t = useT();
  const rows = insights.typeByYear;
  if (rows.length === 0) {
    return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  }
  const maxValue = rows.reduce((max, row) => row.counts.reduce((inner, count) => Math.max(inner, count), max), 0);
  const { max: tickMax, step } = axisOf(Math.max(maxValue, 1));
  const unit = (AXIS_Y - PLOT_TOP) / tickMax;
  const groupW = (PLOT_X1 - PLOT_X0) / rows.length;
  const itemW = groupW * (1 - GROUP_INSET_RATIO * 2) / DASHBOARD_PROJECT_TYPES.length;
  const barW = Math.min(BAR_MAX_W, itemW * 0.64);
  const groupGap = itemW - barW;
  const ticks: number[] = [];
  for (let value = 0; value <= tickMax; value += step) ticks.push(value);
  return (
    <svg
      className="hub-dash-project-types"
      viewBox={"0 0 " + VIEW_W + " " + VIEW_H}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={t("hub.dash.projects.typeYear.aria")}
    >
      {DASHBOARD_PROJECT_TYPES.map((type, index) => {
        const legendW = 168;
        const legendStart = VIEW_W / 2 - (legendW * DASHBOARD_PROJECT_TYPES.length) / 2;
        const x = legendStart + index * legendW;
        return (
          <g key={type}>
            <rect x={x} y={12} width={14} height={14} rx={3} fill={DASHBOARD_PROJECT_TYPE_COLORS[type]} />
            <text x={x + 23} y={24} fontSize={15} fill="#374151">{type}</text>
          </g>
        );
      })}
      {ticks.map((value) => value > 0 ? (
        <line key={"grid-" + value} x1={PLOT_X0} y1={AXIS_Y - value * unit} x2={PLOT_X1} y2={AXIS_Y - value * unit} stroke="#e8eaee" strokeDasharray="3 4" />
      ) : null)}
      <line x1={PLOT_X0 - 8} y1={AXIS_Y} x2={PLOT_X1 + 8} y2={AXIS_Y} stroke="#b8bec6" />
      {ticks.map((value) => (
        <text key={"tick-" + value} x={PLOT_X0 - 14} y={AXIS_Y - value * unit + 4} textAnchor="end" fontSize={12} fill="#8a9099">{value}</text>
      ))}
      {rows.map((row, yearIndex) => {
        const groupX = PLOT_X0 + groupW * yearIndex;
        const startX = groupX + groupW * GROUP_INSET_RATIO;
        const baselineLabel = row.year === null ? t("hub.dash.projects.unknownYear") : String(row.year);
        return (
          <g key={row.year === null ? "unknown" : String(row.year)}>
            {DASHBOARD_PROJECT_TYPES.map((type, typeIndex) => {
              const count = row.counts[typeIndex] ?? 0;
              const height = count * unit;
              const x = startX + typeIndex * itemW + groupGap / 2;
              const y = AXIS_Y - height;
              return (
                <g key={type}>
                  {count > 0 ? (
                    <rect
                      className="hub-dash-project-types__bar"
                      style={{ animationDelay: yearIndex * 55 + typeIndex * 30 + "ms" }}
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(height, 2)}
                      rx={4}
                      fill={DASHBOARD_PROJECT_TYPE_COLORS[type]}
                    >
                      <title>{baselineLabel + " · " + type + " · " + count}</title>
                    </rect>
                  ) : null}
                  {count > 0 ? (
                    <text
                      className="hub-dash-project-types__num"
                      style={{ animationDelay: yearIndex * 55 + typeIndex * 30 + 300 + "ms" }}
                      x={x + barW / 2}
                      y={Math.max(y - 8, PLOT_TOP + 10)}
                      textAnchor="middle"
                      fontSize={13}
                      fontWeight={600}
                      fill="#374151"
                    >{count}</text>
                  ) : null}
                </g>
              );
            })}
            <text x={groupX + groupW / 2} y={TICK_LABEL_Y + 15} textAnchor="middle" fontSize={row.year === null ? 11.5 : 13} fill="#4b5563">{baselineLabel}</text>
          </g>
        );
      })}
    </svg>
  );
}
