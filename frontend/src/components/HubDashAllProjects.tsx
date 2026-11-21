import type { MouseEvent as ReactMouseEvent } from "react";
import type { DashboardIssues } from "../data/dashboardProgress";
import type { DashboardProjectInsights } from "../data/dashboardProjectInsights";
import { useT } from "../i18n";
import { HubDashIssues, type DashboardIssueRow } from "./HubDashIssues";
import { HubDashProjectTypeYears } from "./HubDashProjectTypeYears";
import { HubDashRoleStages } from "./HubDashRoleStages";
import { HubDashStartYearStages } from "./HubDashStartYearStages";
import { Loader } from "./Loader";

type LoadingState = "idle" | "loading" | "ready" | "failed";

/**
 * 仪表盘「全部项目」专属长页（2026-11-21 业务口径）：
 * 1. 保留问题原因归纳图；
 * 2. 项目数量：启动年份 × T-sort / 3D分拣 / 飞箱；
 * 3. 项目经理 / 销售负责人 / 规划负责人 × 最新阶段（三张独立竖排堆叠柱状图）；
 * 4. 启动年份 × 最新阶段（堆叠柱状图 + 可切换年份的饼图）。
 *
 * 单项目视图完全沿用原仪表盘六视图；仅「全部项目」落这一页。页面内容纵向连续，由外层视口滚动。
 */
export function HubDashAllProjects({ issues, issuesState, insights, insightsState, onIssueTip, onIssueRowTip, onLeave }: {
  readonly issues: DashboardIssues | null;
  readonly issuesState: LoadingState;
  readonly insights: DashboardProjectInsights | null;
  readonly insightsState: LoadingState;
  readonly onIssueTip: (event: ReactMouseEvent<SVGRectElement>, state: string, category: string, count: number) => void;
  readonly onIssueRowTip: (event: ReactMouseEvent<SVGRectElement>, state: string, rows: readonly DashboardIssueRow[]) => void;
  readonly onLeave: () => void;
}) {
  const t = useT();
  const analyticsReady = insightsState === "ready" && insights !== null;
  return (
    <div className="hub-dash-all">
      <section className="hub-dash-all__section" data-section="issues">
        <div className="hub-dash-all__heading">
          <h3>{t("hub.dash.projects.issues.title")}</h3>
          <p>{t("hub.dash.projects.issues.subtitle")}</p>
        </div>
        <div className="hub-dash-all__chart hub-dash-all__chart--issues">
          {issuesState === "ready" && issues !== null ? (
            issues.totalIssues === 0 ? (
              <div className="hub-dash-state">{t("hub.dash.issues.empty")}</div>
            ) : (
              <HubDashIssues
                issues={issues}
                canDrill={false}
                onTip={onIssueTip}
                onRowTip={onIssueRowTip}
                onLeave={onLeave}
                onPick={() => undefined}
              />
            )
          ) : issuesState === "failed" ? (
            <div className="hub-dash-state">{t("hub.dash.failed")}</div>
          ) : (
            <div className="hub-dash-state"><Loader /></div>
          )}
        </div>
      </section>

      {!analyticsReady ? (
        <section className="hub-dash-all__section" data-section="analytics-state">
          {insightsState === "failed" ? (
            <div className="hub-dash-state">{t("hub.dash.failed")}</div>
          ) : (
            <div className="hub-dash-state"><Loader /></div>
          )}
        </section>
      ) : (
        <>
          <section className="hub-dash-all__section" data-section="project-types">
            <div className="hub-dash-all__heading">
              <h3>{t("hub.dash.projects.typeYear.title")}</h3>
              <p>{t("hub.dash.projects.typeYear.subtitle")}</p>
            </div>
            <div className="hub-dash-all__chart">
              <HubDashProjectTypeYears insights={insights} />
            </div>
          </section>

          <section className="hub-dash-all__section" data-section="role-stages">
            <div className="hub-dash-all__heading">
              <h3>{t("hub.dash.projects.role.title")}</h3>
              <p>{t("hub.dash.projects.role.subtitle")}</p>
            </div>
            <HubDashRoleStages insights={insights} />
          </section>

          <section className="hub-dash-all__section" data-section="start-year-stages">
            <div className="hub-dash-all__heading">
              <h3>{t("hub.dash.projects.startYear.title")}</h3>
              <p>{t("hub.dash.projects.startYear.subtitle")}</p>
            </div>
            <HubDashStartYearStages insights={insights} />
          </section>
        </>
      )}
    </div>
  );
}
