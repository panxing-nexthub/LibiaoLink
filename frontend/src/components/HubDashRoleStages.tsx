import type { TextKey } from "../i18n";
import { stageText, useLocale, useT } from "../i18n";
import {
  DASHBOARD_PROJECT_ROLES,
  DASHBOARD_PROJECT_STAGE_BUCKETS,
  DASHBOARD_PROJECT_STAGE_COLORS,
  dashboardProjectStageLabel,
  type DashboardProjectInsights,
  type DashboardProjectRole,
  type DashboardProjectRoleStats,
} from "../data/dashboardProjectInsights";

const ROLE_TITLE_KEYS: Readonly<Record<DashboardProjectRole, TextKey>> = {
  manager: "hub.dash.projects.role.manager",
  sales: "hub.dash.projects.role.sales",
  planning: "hub.dash.projects.role.planning",
};

const VIEW_H = 378;
const PLOT_TOP = 24;
const AXIS_Y = 306;
const LABEL_Y = 334;
const LEFT = 66;
const RIGHT = 28;
const MIN_VIEW_W = 900;
const SLOT_W = 86;
const BAR_MAX_W = 42;

function axisOf(maxValue: number): { max: number; step: number } {
  if (maxValue <= 5) return { max: Math.max(1, maxValue), step: 1 };
  const raw = maxValue / 4;
  const step = raw <= 1 ? 1 : raw <= 2 ? 2 : raw <= 5 ? 5 : raw <= 10 ? 10 : raw <= 20 ? 20 : raw <= 50 ? 50 : 100;
  return { max: Math.max(step, Math.ceil(maxValue / step) * step), step };
}

function truncated(text: string, maxChars = 9): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1) + "…";
}

function RoleStageChart({ role, stats }: { readonly role: DashboardProjectRole; readonly stats: DashboardProjectRoleStats | undefined }) {
  const t = useT();
  const locale = useLocale();
  const people = stats?.people ?? [];
  if (people.length === 0) {
    return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  }
  const viewW = Math.max(MIN_VIEW_W, LEFT + RIGHT + people.length * SLOT_W);
  const plotW = viewW - LEFT - RIGHT;
  const slotW = plotW / people.length;
  const barW = Math.min(BAR_MAX_W, slotW * 0.52);
  const maxTotal = people.reduce((max, person) => Math.max(max, person.total), 0);
  const { max: tickMax, step } = axisOf(Math.max(maxTotal, 1));
  const unit = (AXIS_Y - PLOT_TOP) / tickMax;
  const ticks: number[] = [];
  for (let value = 0; value <= tickMax; value += step) ticks.push(value);
  return (
    <div className="hub-dash-role__scroll">
      <svg
        className="hub-dash-role"
        viewBox={"0 0 " + viewW + " " + VIEW_H}
        style={{ width: "100%", minWidth: viewW, height: "auto" }}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label={t("hub.dash.projects.role.aria", { role: t(ROLE_TITLE_KEYS[role]) })}
      >
        {ticks.map((value) => value > 0 ? (
          <line key={"grid-" + value} x1={LEFT} y1={AXIS_Y - value * unit} x2={viewW - RIGHT} y2={AXIS_Y - value * unit} stroke="#e8eaee" strokeDasharray="3 4" />
        ) : null)}
        <line x1={LEFT - 8} y1={AXIS_Y} x2={viewW - RIGHT + 8} y2={AXIS_Y} stroke="#b8bec6" />
        {ticks.map((value) => (
          <text key={"tick-" + value} x={LEFT - 12} y={AXIS_Y - value * unit + 4} textAnchor="end" fontSize={11.5} fill="#8a9099">{value}</text>
        ))}
        {people.map((person, personIndex) => {
          const center = LEFT + slotW * personIndex + slotW / 2;
          const x = center - barW / 2;
          const rawLabel = person.isUnassigned ? t("hub.dash.projects.unassigned") : person.name ?? t("hub.dash.projects.unknownPerson");
          const label = truncated(rawLabel);
          let cursorY = AXIS_Y;
          return (
            <g key={person.isUnassigned ? "unassigned" : person.personId ?? rawLabel}>
              {DASHBOARD_PROJECT_STAGE_BUCKETS.map((bucket, stageIndex) => {
                const count = person.stageCounts[stageIndex] ?? 0;
                if (count <= 0) return null;
                const height = count * unit;
                const y = cursorY - height;
                cursorY = y;
                const stageLabel = stageText(locale, dashboardProjectStageLabel(bucket));
                return (
                  <g key={bucket}>
                    <rect
                      className="hub-dash-role__segment"
                      style={{ animationDelay: personIndex * 45 + stageIndex * 18 + "ms" }}
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(height, 1.5)}
                      fill={DASHBOARD_PROJECT_STAGE_COLORS[bucket]}
                    >
                      <title>{rawLabel + " · " + stageLabel + " · " + count}</title>
                    </rect>
                    {height >= 11 ? (
                      <text x={center} y={y + height / 2 + 3.7} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={bucket === "purchase" || bucket === "trial" ? "#313033" : "#ffffff"} pointerEvents="none">{count}</text>
                    ) : null}
                  </g>
                );
              })}
              <text x={center} y={LABEL_Y} textAnchor="middle" fontSize={11.5} fill={person.isUnassigned ? "#9a5b13" : "#4b5563"}>
                <title>{rawLabel}</title>
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * 三类负责人 × 最新阶段：三张独立竖排堆叠柱状图，x = 人员，段色 = 最新阶段，段内写项目数。
 * 同一项目同一角色下同一人只计一次；未配置对应负责人的项目落「待分配」列。
 */
export function HubDashRoleStages({ insights }: { readonly insights: DashboardProjectInsights }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="hub-dash-role-section">
      <div className="hub-dash-role__legend" aria-label={t("hub.dash.projects.stageLegend")}>
        {DASHBOARD_PROJECT_STAGE_BUCKETS.map((bucket) => (
          <span key={bucket} className="hub-dash-role__legendItem">
            <i style={{ background: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }} />
            {stageText(locale, dashboardProjectStageLabel(bucket))}
          </span>
        ))}
      </div>
      <div className="hub-dash-role-list">
        {DASHBOARD_PROJECT_ROLES.map((role) => {
          const stats = insights.roles.find((item) => item.role === role);
          return (
            <section key={role} className="hub-dash-role-card" data-role={role}>
              <h4 className="hub-dash-role-card__title">{t(ROLE_TITLE_KEYS[role])}</h4>
              <RoleStageChart role={role} stats={stats} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
