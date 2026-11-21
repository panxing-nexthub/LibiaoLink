import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DashboardProjectSummary } from "../data/dashboardProjectInsights";
import { dashboardProjectStageLabel } from "../data/dashboardProjectInsights";
import { stageText, useLocale, useT } from "../i18n";
import { projectViewHref } from "../useHashRoute";
import { useFocusTrap } from "./useFocusTrap";

/**
 * 全部项目图表的只读项目下钻列表。
 * - 项目统计：项目类型 / 编号 / 名称 / 项目经理 / 启动时间；
 * - 当前阶段与负责人页：补一列当前阶段；
 * - 固定长列表，不折叠；上方搜索跨全部可见字段筛选。
 */
export function HubDashProjectListDetail({ rows, context, showStage, onClose }: {
  readonly rows: readonly DashboardProjectSummary[];
  readonly context: string;
  readonly showStage: boolean;
  readonly onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const trapRef = useFocusTrap<HTMLDivElement>();
  const [keyword, setKeyword] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const query = keyword.trim().toLowerCase();
  const cards = rows.map((row) => {
    const managers = row.owners.manager
      .map((person) => person.name ?? t("hub.dash.projects.unknownPerson"))
      .join("、") || t("hub.dash.projects.unassigned");
    const types = row.projectTypes.length === 0 ? ["—"] : row.projectTypes;
    const stage = stageText(locale, dashboardProjectStageLabel(row.stageBucket));
    const startup = row.startupAt ?? t("hub.dash.projects.unknownYear");
    const hay = [row.code, row.name, managers, stage, startup, ...types].join(" ").toLowerCase();
    return { row, managers, types, stage, startup, hay };
  }).filter((card) => query === "" || card.hay.includes(query));
  return createPortal(
    <div
      data-hub-detail-dialog="true"
      data-project-list-detail="true"
      role="dialog"
      aria-modal="true"
      aria-label={t("hub.dash.detail.title")}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/45 p-6"
    >
      <div
        ref={trapRef}
        data-focus-container="true"
        tabIndex={-1}
        onClick={(event) => { event.stopPropagation(); }}
        className="hub-dash-detail hub-dash-project-list-detail"
      >
        <div className="hub-dash-detail__head">
          <div>
            <div className="hub-dash-detail__title">{t("hub.dash.detail.title")}</div>
            <div className="hub-dash-detail__from">
              <span>{t("hub.dash.detail.from")}</span>
              <span className="hub-dash-detail__project">{t("hub.dash.allProjects")}</span>
              {context === "" ? null : <span className="hub-dash-project-list-detail__context"> · {context}</span>}
            </div>
          </div>
          <button type="button" className="hub-dash-detail__close" aria-label={t("hub.dash.detail.close")} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="hub-dash-detail__box">
          <label className="hub-dash-detail__search">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16.2 16.2L20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("hub.dash.detail.search")} aria-label={t("hub.dash.detail.search")} />
            <span className="hub-dash-project-list-detail__count">{t("hub.dash.projects.detail.count", { n: cards.length })}</span>
          </label>
          <div className="hub-dash-project-list-detail__scroll">
            <div className="hub-dash-project-list-detail__grid" data-show-stage={showStage ? "true" : "false"}>
              <div className="hub-dash-project-list-detail__headRow">
                <span>{t("import.field.type")}</span>
                <span>{t("pm.column.code")}</span>
                <span>{t("pm.column.name")}</span>
                <span>{t("pm.column.manager")}</span>
                {showStage ? <span>{t("hub.dash.projects.currentStageShort")}</span> : null}
                <span>{t("hub.dash.projects.startupTime")}</span>
              </div>
              {cards.map((card) => (
                <a
                  key={card.row.id}
                  className="hub-dash-project-list-detail__row"
                  data-project-code={card.row.code}
                  href={projectViewHref(card.row.id, "overview")}
                  aria-label={t("ws.openProject.title", { name: card.row.name, code: card.row.code })}
                  title={t("ws.openProject.title", { name: card.row.name, code: card.row.code })}
                >
                  <span className="hub-dash-project-list-detail__cell hub-dash-project-list-detail__types">
                    {card.types.map((type) => <i key={type} data-type={type}>{type}</i>)}
                  </span>
                  <span className="hub-dash-project-list-detail__cell"><span className="hub-dash-detail__chip">{card.row.code}</span></span>
                  <span className="hub-dash-project-list-detail__cell hub-dash-project-list-detail__name">{card.row.name}</span>
                  <span className="hub-dash-project-list-detail__cell" title={card.managers}>{card.managers}</span>
                  {showStage ? <span className="hub-dash-project-list-detail__cell" title={card.stage}>{card.stage}</span> : null}
                  <span className="hub-dash-project-list-detail__cell hub-dash-detail__date">{card.startup}</span>
                </a>
              ))}
              {cards.length === 0 ? <div className="hub-dash-project-list-detail__empty">{t("hub.dash.pickEmpty")}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
