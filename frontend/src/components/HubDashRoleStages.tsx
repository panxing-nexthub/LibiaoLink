import { useState } from "react";
import type { TextKey } from "../i18n";
import { stageText, useLocale, useT } from "../i18n";
import { HubDashHoverTip, hoverTipAt, type DashboardHoverTip } from "./HubDashHoverTip";
import {
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
  const [tip, setTip] = useState<DashboardHoverTip | null>(null);
  const [hoverPerson, setHoverPerson] = useState<string | null>(null);
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
        onMouseLeave={() => { setTip(null); setHoverPerson(null); }}
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
          const personKey = person.isUnassigned ? "unassigned" : person.personId ?? rawLabel;
          const label = truncated(rawLabel);
          const stageRows = DASHBOARD_PROJECT_STAGE_BUCKETS.flatMap((bucket, stageIndex) => {
            const count = person.stageCounts[stageIndex] ?? 0;
            return count > 0 ? [{ label: stageText(locale, dashboardProjectStageLabel(bucket)), value: count, color: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }] : [];
          });
          stageRows.push({ label: t("hub.dash.projects.total"), value: person.total, color: "#94a3b8" });
          let cursorY = AXIS_Y;
          return (
            <g key={personKey}>
              <rect
                className="hub-dash-role__band"
                x={center - slotW / 2 + 5}
                y={PLOT_TOP - 6}
                width={Math.max(slotW - 10, 1)}
                height={AXIS_Y - PLOT_TOP + 6}
                rx={8}
                fill="transparent"
                onMouseEnter={(event) => { setHoverPerson(personKey); setTip(hoverTipAt(event, rawLabel, stageRows, t(ROLE_TITLE_KEYS[role]))); }}
                onMouseMove={(event) => { setHoverPerson(personKey); setTip(hoverTipAt(event, rawLabel, stageRows, t(ROLE_TITLE_KEYS[role]))); }}
              />
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
                      onMouseEnter={(event) => { setHoverPerson(null); setTip(hoverTipAt(event, rawLabel, [{ label: t("hub.dash.projects.projectCount"), value: count, color: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }], stageLabel)); }}
                      onMouseMove={(event) => { setHoverPerson(null); setTip(hoverTipAt(event, rawLabel, [{ label: t("hub.dash.projects.projectCount"), value: count, color: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }], stageLabel)); }}
                    />
                    {height >= 11 && hoverPerson !== personKey ? (
                      <text x={center} y={y + height / 2 + 3.7} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={bucket === "purchase" ? "#313033" : "#ffffff"} pointerEvents="none">{count}</text>
                    ) : null}
                  </g>
                );
              })}
              {hoverPerson === personKey ? (
                <text
                  className="hub-dash-role__hoverTotal"
                  x={center}
                  y={PLOT_TOP + 18}
                  textAnchor="middle"
                  fontSize={Math.max(18, Math.min(24, slotW * 0.14))}
                  fontWeight={700}
                  fill="#334155"
                  stroke="#ffffff"
                  strokeWidth={4}
                  paintOrder="stroke"
                  pointerEvents="none"
                >{person.total}</text>
              ) : null}
              <text x={center} y={LABEL_Y} textAnchor="middle" fontSize={11.5} fill={person.isUnassigned ? "#9a5b13" : "#4b5563"}>
                <title>{rawLabel}</title>
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <HubDashHoverTip tip={tip} />
    </div>
  );
}

/** 十二个最新阶段色例：负责人页与启动年份页共用（启动年份页自身也有一份，保持图内布局）。 */
export function HubDashProjectStageLegend() {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="hub-dash-role__legend" aria-label={t("hub.dash.projects.stageLegend")}>
      {DASHBOARD_PROJECT_STAGE_BUCKETS.map((bucket) => (
        <span key={bucket} className="hub-dash-role__legendItem">
          <i style={{ background: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }} />
          {stageText(locale, dashboardProjectStageLabel(bucket))}
        </span>
      ))}
    </div>
  );
}

/**
 * 单一角色的「人员 × 最新阶段」堆叠柱图，供全部项目滑轨的一屏使用。
 * 同一项目同一角色同一人去重；未配置对应负责人落「待分配」。
 */
export function HubDashRoleStage({ role, insights }: { readonly role: DashboardProjectRole; readonly insights: DashboardProjectInsights }) {
  const stats = insights.roles.find((item) => item.role === role);
  return (
    <div className="hub-dash-role-section hub-dash-role-section--slide">
      <HubDashProjectStageLegend />
      <RoleStageChart role={role} stats={stats} />
    </div>
  );
}
