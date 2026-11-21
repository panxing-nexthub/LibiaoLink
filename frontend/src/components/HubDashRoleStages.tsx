import { useState } from "react";
import type { TextKey } from "../i18n";
import { stageText, useLocale, useT } from "../i18n";
import { usePersistentDashboardFilter } from "../dashboardFilterStorage";
import { dashboardAxisOf } from "../dashboardChartScale";
import { HubDashHoverTip, hoverTipAt, type DashboardHoverTip } from "./HubDashHoverTip";
import {
  DASHBOARD_PROJECT_STAGE_BUCKETS,
  DASHBOARD_PROJECT_STAGE_COLORS,
  dashboardProjectStageLabel,
  type DashboardProjectInsights,
  type DashboardProjectRole,
  type DashboardProjectRoleStats,
  type DashboardProjectStageBucket,
} from "../data/dashboardProjectInsights";

const ROLE_TITLE_KEYS: Readonly<Record<DashboardProjectRole, TextKey>> = {
  manager: "hub.dash.projects.role.manager",
  sales: "hub.dash.projects.role.sales",
  planning: "hub.dash.projects.role.planning",
};

export type DashboardRoleProjectPick = {
  readonly personId: string | null;
  readonly name: string | null;
  readonly isUnassigned: boolean;
  readonly stageBuckets: readonly DashboardProjectStageBucket[];
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

function truncated(text: string, maxChars = 9): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1) + "…";
}

function RoleStageChart({ role, stats, visibleStages, onPick }: {
  readonly role: DashboardProjectRole;
  readonly stats: DashboardProjectRoleStats | undefined;
  readonly visibleStages: readonly DashboardProjectStageBucket[];
  readonly onPick?: (pick: DashboardRoleProjectPick) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [tip, setTip] = useState<DashboardHoverTip | null>(null);
  const people = stats?.people ?? [];
  const visibleStageEntries = DASHBOARD_PROJECT_STAGE_BUCKETS
    .map((bucket, stageIndex) => ({ bucket, stageIndex }))
    .filter((entry) => visibleStages.includes(entry.bucket));
  const visibleStageIndexes = new Set(visibleStageEntries.map((entry) => entry.stageIndex));
  if (people.length === 0 || visibleStageEntries.length === 0) {
    return <div className="hub-dash-state">{t("hub.dash.projects.empty")}</div>;
  }
  const visibleTotals = people.map((person) => person.stageCounts.reduce(
    (sum, count, stageIndex) => visibleStageIndexes.has(stageIndex) ? sum + count : sum,
    0,
  ));
  const maxTotal = visibleTotals.reduce((max, total) => Math.max(max, total), 0);
  const { max: tickMax, step } = dashboardAxisOf(maxTotal);
  const unit = (AXIS_Y - PLOT_TOP) / tickMax;
  const viewW = Math.max(MIN_VIEW_W, LEFT + RIGHT + people.length * SLOT_W);
  const plotW = viewW - LEFT - RIGHT;
  const slotW = plotW / people.length;
  const barW = Math.min(BAR_MAX_W, slotW * 0.52);
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
        onMouseLeave={() => setTip(null)}
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
          const visibleTotal = visibleTotals[personIndex] ?? 0;
          const stageRows = visibleStageEntries.flatMap(({ bucket, stageIndex }) => {
            const count = person.stageCounts[stageIndex] ?? 0;
            return count > 0 ? [{ label: stageText(locale, dashboardProjectStageLabel(bucket)), value: count, color: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }] : [];
          });
          stageRows.push({ label: t("hub.dash.projects.total"), value: visibleTotal, color: "#94a3b8" });
          let cursorY = AXIS_Y;
          return (
            <g key={personKey}>
              <rect
                className="hub-dash-role__band"
                data-drill={onPick === undefined ? undefined : "true"}
                x={center - slotW / 2 + 5}
                y={PLOT_TOP - 6}
                width={Math.max(slotW - 10, 1)}
                height={AXIS_Y - PLOT_TOP + 6}
                rx={8}
                fill="transparent"
                onClick={onPick === undefined ? undefined : () => { onPick({ personId: person.personId, name: rawLabel, isUnassigned: person.isUnassigned, stageBuckets: visibleStageEntries.map((entry) => entry.bucket) }); }}
                onMouseEnter={(event) => setTip(hoverTipAt(event, rawLabel, stageRows, t(ROLE_TITLE_KEYS[role])))}
                onMouseMove={(event) => setTip(hoverTipAt(event, rawLabel, stageRows, t(ROLE_TITLE_KEYS[role])))}
              />
              {visibleStageEntries.map(({ bucket, stageIndex }) => {
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
                      data-drill={onPick === undefined ? undefined : "true"}
                      style={{ animationDelay: personIndex * 45 + stageIndex * 18 + "ms" }}
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(height, 1.5)}
                      fill={DASHBOARD_PROJECT_STAGE_COLORS[bucket]}
                      onClick={onPick === undefined ? undefined : () => { onPick({ personId: person.personId, name: rawLabel, isUnassigned: person.isUnassigned, stageBuckets: [bucket] }); }}
                      onMouseEnter={(event) => setTip(hoverTipAt(event, rawLabel, [{ label: t("hub.dash.projects.projectCount"), value: count, color: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }], stageLabel))}
                      onMouseMove={(event) => setTip(hoverTipAt(event, rawLabel, [{ label: t("hub.dash.projects.projectCount"), value: count, color: DASHBOARD_PROJECT_STAGE_COLORS[bucket] }], stageLabel))}
                    />
                    {height >= 11 ? (
                      <text x={center} y={y + height / 2 + 3.7} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={bucket === "purchase" ? "#313033" : "#ffffff"} pointerEvents="none">{count}</text>
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
      <HubDashHoverTip tip={tip} />
    </div>
  );
}

/** 十二个最新阶段色例：逐项点击显隐，最左侧「全选」一次开关全部阶段。 */
export function HubDashProjectStageLegend({ visibleStages, onToggleStage, onSelectAll }: {
  readonly visibleStages: readonly DashboardProjectStageBucket[];
  readonly onToggleStage: (stage: DashboardProjectStageBucket) => void;
  readonly onSelectAll: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const allSelected = visibleStages.length === DASHBOARD_PROJECT_STAGE_BUCKETS.length;
  return (
    <div className="hub-dash-role__legendBar">
      <button
        type="button"
        className="hub-dash-project-types__selectAll hub-dash-role__selectAll"
        data-active={allSelected ? "true" : "false"}
        aria-pressed={allSelected}
        onClick={onSelectAll}
      >{t("hub.dash.projects.selectAll")}</button>
      <div className="hub-dash-role__legend" role="group" aria-label={t("hub.dash.projects.stageLegend")}>
        {DASHBOARD_PROJECT_STAGE_BUCKETS.map((bucket) => {
          const active = visibleStages.includes(bucket);
          return (
            <button
              key={bucket}
              type="button"
              className="hub-dash-role__legendItem"
              data-active={active ? "true" : "false"}
              aria-pressed={active}
              onClick={() => onToggleStage(bucket)}
            >
              <i style={{ background: active ? DASHBOARD_PROJECT_STAGE_COLORS[bucket] : "#c9ced6" }} />
              <span>{stageText(locale, dashboardProjectStageLabel(bucket))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 单一角色的「人员 × 最新阶段」堆叠柱图，供全部项目滑轨的一屏使用。
 * 同一项目同一角色同一人去重；未配置对应负责人落「待分配」。
 * 阶段图例可逐项显隐，隐藏阶段不再绘制，合计与纵轴按可见阶段重算；
 * 点人员柱底或阶段分段按「负责人 × 阶段」下钻项目列表。
 */
export function HubDashRoleStage({ role, insights, onPick, storageKeyPrefix }: {
  readonly role: DashboardProjectRole;
  readonly insights: DashboardProjectInsights;
  /** 点人员柱底或阶段分段：按该负责人 × 阶段打开项目列表。 */
  readonly onPick?: (pick: DashboardRoleProjectPick) => void;
  /** 全部项目仪表盘传入时，按账号记住该角色页的阶段显隐。 */
  readonly storageKeyPrefix?: string;
}) {
  const stats = insights.roles.find((item) => item.role === role);
  const [visibleStages, setVisibleStages] = usePersistentDashboardFilter<DashboardProjectStageBucket[]>(
    storageKeyPrefix ? storageKeyPrefix + ".visibleStages" : null,
    () => [...DASHBOARD_PROJECT_STAGE_BUCKETS],
    (value): value is DashboardProjectStageBucket[] => Array.isArray(value)
      && value.every((item) => DASHBOARD_PROJECT_STAGE_BUCKETS.includes(item as DashboardProjectStageBucket)),
  );
  const allSelected = visibleStages.length === DASHBOARD_PROJECT_STAGE_BUCKETS.length;
  const toggleStage = (stage: DashboardProjectStageBucket): void => setVisibleStages((current) =>
    current.includes(stage) ? current.filter((item) => item !== stage) : [...current, stage]);
  return (
    <div className="hub-dash-role-section hub-dash-role-section--slide">
      <HubDashProjectStageLegend
        visibleStages={visibleStages}
        onToggleStage={toggleStage}
        onSelectAll={() => setVisibleStages(allSelected ? [] : [...DASHBOARD_PROJECT_STAGE_BUCKETS])}
      />
      <RoleStageChart role={role} stats={stats} visibleStages={visibleStages} onPick={onPick} />
    </div>
  );
}
