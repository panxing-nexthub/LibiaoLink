import type { MouseEvent as ReactMouseEvent } from "react";
import type { DashboardIssues } from "../data/dashboardProgress";
import type { DashboardProjectInsights } from "../data/dashboardProjectInsights";
import { useT } from "../i18n";
import { HubDashIssues, type DashboardIssueRow } from "./HubDashIssues";
import { HubDashProjectTypeYears } from "./HubDashProjectTypeYears";
import { HubDashRoleStage } from "./HubDashRoleStages";
import { HubDashSlideDeck } from "./HubDashSlideDeck";
import { HubDashStartYearStages } from "./HubDashStartYearStages";
import { Loader } from "./Loader";

type LoadingState = "idle" | "loading" | "ready" | "failed";

/**
 * 仪表盘「全部项目」六屏滑轨（2026-11-21 第二轮业务口径：
 * 「现在全做成滑动的好吗 就像地图和仪表盘这样切换一样」）：
 * ① 问题原因归纳；② 项目数量；③ 项目经理阶段；④ 销售负责人阶段；⑤ 规划负责人阶段；
 * ⑥ 启动年份 × 最新阶段（柱 + 饼）。每屏占满内容区，滚轮 / 键盘 / 底部切换共同驱动同一刚体滑轨。
 */
export function HubDashAllProjects({ activeSlide, issues, issuesState, insights, insightsState, onIssueTip, onIssueRowTip, onLeave }: {
  readonly activeSlide: number;
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
  const analyticsFallback = insightsState === "failed"
    ? <div className="hub-dash-state">{t("hub.dash.failed")}</div>
    : <div className="hub-dash-state"><Loader /></div>;
  return (
    <HubDashSlideDeck activeIndex={activeSlide} allProjects>
      <section className="hub-dash-all__slide" data-section="issues">
        <div className="hub-dash-all__slideCard">
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
      </div>
      </section>

      <section className="hub-dash-all__slide" data-section="project-types">
        <div className="hub-dash-all__slideCard">
        <div className="hub-dash-all__heading">
          <h3>{t("hub.dash.projects.typeYear.title")}</h3>
          <p>{t("hub.dash.projects.typeYear.subtitle")}</p>
        </div>
        <div className="hub-dash-all__chart">
          {analyticsReady ? <HubDashProjectTypeYears insights={insights} /> : analyticsFallback}
        </div>
      </div>
      </section>

      <section className="hub-dash-all__slide" data-section="manager">
        <div className="hub-dash-all__slideCard">
        <div className="hub-dash-all__heading">
          <h3>{t("hub.dash.projects.role.manager")}</h3>
          <p>{t("hub.dash.projects.role.subtitle")}</p>
        </div>
        <div className="hub-dash-all__roleBody">
          {analyticsReady ? <HubDashRoleStage role="manager" insights={insights} /> : analyticsFallback}
        </div>
      </div>
      </section>

      <section className="hub-dash-all__slide" data-section="sales">
        <div className="hub-dash-all__slideCard">
        <div className="hub-dash-all__heading">
          <h3>{t("hub.dash.projects.role.sales")}</h3>
          <p>{t("hub.dash.projects.role.subtitle")}</p>
        </div>
        <div className="hub-dash-all__roleBody">
          {analyticsReady ? <HubDashRoleStage role="sales" insights={insights} /> : analyticsFallback}
        </div>
      </div>
      </section>

      <section className="hub-dash-all__slide" data-section="planning">
        <div className="hub-dash-all__slideCard">
        <div className="hub-dash-all__heading">
          <h3>{t("hub.dash.projects.role.planning")}</h3>
          <p>{t("hub.dash.projects.role.subtitle")}</p>
        </div>
        <div className="hub-dash-all__roleBody">
          {analyticsReady ? <HubDashRoleStage role="planning" insights={insights} /> : analyticsFallback}
        </div>
      </div>
      </section>

      <section className="hub-dash-all__slide" data-section="start-year-stages">
        <div className="hub-dash-all__slideCard">
        <div className="hub-dash-all__heading">
          <h3>{t("hub.dash.projects.startYear.title")}</h3>
          <p>{t("hub.dash.projects.startYear.subtitle")}</p>
        </div>
        <div className="hub-dash-all__startBody">
          {analyticsReady ? <HubDashStartYearStages insights={insights} /> : analyticsFallback}
        </div>
      </div>
      </section>
    </HubDashSlideDeck>
  );
}
