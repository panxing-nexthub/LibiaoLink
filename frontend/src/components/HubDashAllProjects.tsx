import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { fieldText, stageText, statusText, useLocale, useT } from "../i18n";
import {
  dashboardProjectStageLabel,
  type DashboardProjectInsights,
  type DashboardProjectRole,
  type DashboardProjectStageBucket,
  type DashboardProjectSummary,
  type DashboardProjectTypeCode,
} from "../data/dashboardProjectInsights";
import {
  isDashboardIssueRecordInCell,
  type DashboardIssueRecord,
  type DashboardIssues,
} from "../data/dashboardProgress";
import { dashboardFilterKey } from "../dashboardFilterStorage";
import { HubDashIssues, type DashboardIssueRow } from "./HubDashIssues";
import { HubDashIssueGroupDetail } from "./HubDashIssueGroupDetail";
import { HubDashProjectListDetail } from "./HubDashProjectListDetail";
import { HubDashProjectTypeYears, type DashboardProjectChartKind } from "./HubDashProjectTypeYears";
import { HubDashRoleStage, type DashboardRoleProjectPick } from "./HubDashRoleStages";
import { HubDashSlideDeck } from "./HubDashSlideDeck";
import { HubDashStartYearStages } from "./HubDashStartYearStages";
import { Loader } from "./Loader";

type LoadingState = "idle" | "loading" | "ready" | "failed";
type YearKey = number | null;

type AllProjectDetail =
  | {
      readonly kind: "projects";
      readonly rows: readonly DashboardProjectSummary[];
      readonly context: string;
      readonly showStage: boolean;
    }
  | {
      readonly kind: "issues";
      readonly rows: readonly DashboardIssueRecord[];
      readonly context: string;
    };

const ROLE_TITLE_KEYS: Readonly<Record<DashboardProjectRole, "hub.dash.projects.role.manager" | "hub.dash.projects.role.sales" | "hub.dash.projects.role.planning">> = {
  manager: "hub.dash.projects.role.manager",
  sales: "hub.dash.projects.role.sales",
  planning: "hub.dash.projects.role.planning",
};

/**
 * 仪表盘「全部项目」五屏滑轨（2026-11-21：项目统计与项目当前阶段合并为同一屏上下排布）：
 * ① 项目统计 + 项目当前阶段；② 问题归纳；③ 项目经理阶段；④ 销售负责人阶段；⑤ 规划负责人阶段。
 * 每屏占满内容区，滚轮 / 键盘 / 底部切换共同驱动同一刚体滑轨。
 *
 * 2026-11-21 下钻：项目统计、当前阶段、负责人与问题柱点击后打开只读「数据详情」；
 * 项目列表固定长列表不折叠，问题列表按项目折叠、展开后显示对应问题。
 */
export function HubDashAllProjects({ viewerId, activeSlide, issues, issueRecords, issuesState, insights, insightsState, onIssueTip, onIssueRowTip, onLeave }: {
  readonly viewerId: string;
  readonly activeSlide: number;
  readonly issues: DashboardIssues | null;
  readonly issueRecords: readonly DashboardIssueRecord[];
  readonly issuesState: LoadingState;
  readonly insights: DashboardProjectInsights | null;
  readonly insightsState: LoadingState;
  readonly onIssueTip: (event: ReactMouseEvent<SVGRectElement>, state: string, category: string, count: number) => void;
  readonly onIssueRowTip: (event: ReactMouseEvent<SVGRectElement>, state: string, rows: readonly DashboardIssueRow[]) => void;
  readonly onLeave: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [projectChartType, setProjectChartType] = useState<DashboardProjectChartKind>("bar");
  const [detail, setDetail] = useState<AllProjectDetail | null>(null);
  const lineExpanded = projectChartType === "line";
  const analyticsReady = insightsState === "ready" && insights !== null;
  const analyticsFallback = insightsState === "failed"
    ? <div className="hub-dash-state">{t("hub.dash.failed")}</div>
    : <div className="hub-dash-state"><Loader /></div>;
  const yearText = (year: YearKey): string => year === null ? t("hub.dash.projects.unknownYear") : String(year);
  const stageLabel = (bucket: DashboardProjectStageBucket): string => stageText(locale, dashboardProjectStageLabel(bucket));
  const openProjects = (rows: readonly DashboardProjectSummary[], context: string, showStage: boolean): void => {
    onLeave();
    setDetail({ kind: "projects", rows, context, showStage });
  };
  const pickProjectType = (year: YearKey, type: DashboardProjectTypeCode): void => {
    if (insights === null) return;
    const rows = insights.projects.filter((project) => project.startupYear === year && project.projectTypes.includes(type));
    openProjects(rows, type + " · " + yearText(year), false);
  };
  const pickProjectStage = (bucket: DashboardProjectStageBucket, years: readonly YearKey[]): void => {
    if (insights === null) return;
    const rows = insights.projects.filter((project) => project.stageBucket === bucket && years.includes(project.startupYear));
    const yearContext = years.length === 0 ? "" : years.map(yearText).join(" / ");
    openProjects(rows, [stageLabel(bucket), yearContext].filter((part) => part !== "").join(" · "), true);
  };
  const pickRoleProjects = (role: DashboardProjectRole, pick: DashboardRoleProjectPick): void => {
    if (insights === null) return;
    const rows = insights.projects.filter((project) => {
      if (!pick.stageBuckets.includes(project.stageBucket)) return false;
      const owners = project.owners[role];
      if (pick.isUnassigned) return owners.length === 0;
      return pick.personId !== null && owners.some((person) => person.personId === pick.personId);
    });
    const person = pick.isUnassigned ? t("hub.dash.projects.unassigned") : pick.name ?? t("hub.dash.projects.unknownPerson");
    const stageContext = pick.stageBuckets.length === 1 ? stageLabel(pick.stageBuckets[0]) : "";
    openProjects(rows, [t(ROLE_TITLE_KEYS[role]) + "：" + person, stageContext].filter((part) => part !== "").join(" · "), true);
  };
  const pickIssueCell = (state: string, category: string): void => {
    const rows = issueRecords.filter((issue) => isDashboardIssueRecordInCell(issue, state, category));
    onLeave();
    setDetail({
      kind: "issues",
      rows,
      context: [statusText(locale, state), fieldText(locale, category)].join(" · "),
    });
  };
  return (
    <>
      <HubDashSlideDeck activeIndex={activeSlide} allProjects>
        <section className="hub-dash-all__slide" data-section="project-stats">
          <div className="hub-dash-all__slideCard hub-dash-all__slideCard--stacked">
            <div className="hub-dash-combined" data-line-expanded={lineExpanded ? "true" : "false"}>
              <section className="hub-dash-combined__panel" data-panel="project-count">
                <div className="hub-dash-all__heading">
                  <h3>{t("hub.dash.projects.typeYear.title")}</h3>
                </div>
                <div className="hub-dash-combined__chart">
                  {analyticsReady ? <HubDashProjectTypeYears insights={insights} expanded={lineExpanded} onChartTypeChange={setProjectChartType} onPick={pickProjectType} storageKeyPrefix={dashboardFilterKey(viewerId, "project")} /> : analyticsFallback}
                </div>
              </section>
              <section className="hub-dash-combined__panel" data-panel="project-stage" aria-hidden={lineExpanded}>
                <div className="hub-dash-all__heading">
                  <h3>{t("hub.dash.projects.startYear.title")}</h3>
                </div>
                <div className="hub-dash-combined__chart">
                  {analyticsReady ? <HubDashStartYearStages insights={insights} onPick={pickProjectStage} storageKeyPrefix={dashboardFilterKey(viewerId, "stage")} /> : analyticsFallback}
                </div>
              </section>
            </div>
          </div>
        </section>

        <section className="hub-dash-all__slide" data-section="issues">
          <div className="hub-dash-all__slideCard">
            <div className="hub-dash-all__heading">
              <h3>{t("hub.dash.projects.issues.title")}</h3>
            </div>
            <div className="hub-dash-all__chart hub-dash-all__chart--issues">
              {issuesState === "ready" && issues !== null ? (
                issues.totalIssues === 0 ? (
                  <div className="hub-dash-state">{t("hub.dash.issues.empty")}</div>
                ) : (
                  <HubDashIssues
                    issues={issues}
                    canDrill
                    filterStorageKey={dashboardFilterKey(viewerId, "issues.categories")}
                    onTip={onIssueTip}
                    onRowTip={onIssueRowTip}
                    onLeave={onLeave}
                    onPick={pickIssueCell}
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

        <section className="hub-dash-all__slide" data-section="manager">
          <div className="hub-dash-all__slideCard">
            <div className="hub-dash-all__heading">
              <h3>{t("hub.dash.projects.role.manager")}</h3>
            </div>
            <div className="hub-dash-all__roleBody">
              {analyticsReady ? <HubDashRoleStage role="manager" insights={insights} onPick={(pick) => { pickRoleProjects("manager", pick); }} storageKeyPrefix={dashboardFilterKey(viewerId, "role.manager")} /> : analyticsFallback}
            </div>
          </div>
        </section>

        <section className="hub-dash-all__slide" data-section="sales">
          <div className="hub-dash-all__slideCard">
            <div className="hub-dash-all__heading">
              <h3>{t("hub.dash.projects.role.sales")}</h3>
            </div>
            <div className="hub-dash-all__roleBody">
              {analyticsReady ? <HubDashRoleStage role="sales" insights={insights} onPick={(pick) => { pickRoleProjects("sales", pick); }} storageKeyPrefix={dashboardFilterKey(viewerId, "role.sales")} /> : analyticsFallback}
            </div>
          </div>
        </section>

        <section className="hub-dash-all__slide" data-section="planning">
          <div className="hub-dash-all__slideCard">
            <div className="hub-dash-all__heading">
              <h3>{t("hub.dash.projects.role.planning")}</h3>
            </div>
            <div className="hub-dash-all__roleBody">
              {analyticsReady ? <HubDashRoleStage role="planning" insights={insights} onPick={(pick) => { pickRoleProjects("planning", pick); }} storageKeyPrefix={dashboardFilterKey(viewerId, "role.planning")} /> : analyticsFallback}
            </div>
          </div>
        </section>
      </HubDashSlideDeck>
      {detail?.kind === "projects" ? (
        <HubDashProjectListDetail rows={detail.rows} context={detail.context} showStage={detail.showStage} onClose={() => { setDetail(null); }} />
      ) : null}
      {detail?.kind === "issues" ? (
        <HubDashIssueGroupDetail rows={detail.rows} context={detail.context} onClose={() => { setDetail(null); }} />
      ) : null}
    </>
  );
}
