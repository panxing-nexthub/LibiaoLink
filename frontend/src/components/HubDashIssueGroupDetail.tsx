import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DASHBOARD_ISSUE_COLORS, type DashboardIssueRecord } from "../data/dashboardProgress";
import { ISSUE_STATE_NAMES } from "../reportApi";
import { fieldText, statusText, useLocale, useT } from "../i18n";
import { projectFocusHref } from "../useHashRoute";
import { PhotoTiles } from "./HubDashIssueDetail";
import { useFocusTrap } from "./useFocusTrap";

type IssueProjectGroup = {
  readonly projectId: string;
  readonly projectCode: string;
  readonly projectName: string;
  readonly issues: readonly DashboardIssueRecord[];
};

/**
 * 全部项目「问题归纳」柱的下钻：按项目折叠，展开后列出命中的问题。
 * 搜索有输入时自动展开命中项目；无输入时保持项目组折叠，由用户逐组展开。
 */
export function HubDashIssueGroupDetail({ rows, context, onClose }: {
  readonly rows: readonly DashboardIssueRecord[];
  readonly context: string;
  readonly onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const trapRef = useFocusTrap<HTMLDivElement>();
  const [keyword, setKeyword] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<readonly string[]>([]);
  const thumbPreviewOpenRef = useRef(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!thumbPreviewOpenRef.current) onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const query = keyword.trim().toLowerCase();
  const filtered = useMemo(() => rows.filter((issue) => {
    if (query === "") return true;
    const hay = [
      issue.projectCode,
      issue.projectName,
      issue.title,
      issue.ownerName ?? "",
      issue.reporterName ?? "",
      issue.raisedAt,
      issue.solution ?? "",
      ISSUE_STATE_NAMES[issue.state],
      ...issue.categories,
    ].join(" ").toLowerCase();
    return hay.includes(query);
  }), [query, rows]);
  const groups = useMemo(() => {
    const byProject = new Map<string, IssueProjectGroup>();
    for (const issue of filtered) {
      const current = byProject.get(issue.projectId);
      if (current === undefined) {
        byProject.set(issue.projectId, {
          projectId: issue.projectId,
          projectCode: issue.projectCode,
          projectName: issue.projectName,
          issues: [issue],
        });
      } else {
        byProject.set(issue.projectId, { ...current, issues: [...current.issues, issue] });
      }
    }
    return [...byProject.values()].sort((left, right) =>
      left.projectName.localeCompare(right.projectName, "zh-CN") || left.projectCode.localeCompare(right.projectCode)
    );
  }, [filtered]);
  const toggleProject = (projectId: string): void => {
    setExpandedProjects((current) => current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId]);
  };
  return createPortal(
    <div
      data-hub-detail-dialog="true"
      data-issue-group-detail="true"
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
        className="hub-dash-detail hub-dash-issue-group-detail"
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
            <span className="hub-dash-project-list-detail__count">{t("hub.dash.projects.issueCount", { n: filtered.length })}</span>
          </label>
          <div className="hub-dash-issue-group-detail__scroll">
            {groups.map((group) => {
              const expanded = query !== "" || expandedProjects.includes(group.projectId);
              return (
                <section key={group.projectId} className="hub-dash-issue-group-detail__group" data-expanded={expanded ? "true" : "false"}>
                  <button
                    type="button"
                    className="hub-dash-issue-group-detail__groupHead"
                    aria-expanded={expanded}
                    onClick={() => toggleProject(group.projectId)}
                  >
                    <svg className="hub-dash-issue-group-detail__chevron" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                      <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="hub-dash-issue-group-detail__projectName">{group.projectName}</span>
                    <span className="hub-dash-detail__chip">{group.projectCode}</span>
                    <span className="hub-dash-issue-group-detail__groupCount">{t("hub.dash.projects.issueCount", { n: group.issues.length })}</span>
                  </button>
                  {expanded ? (
                    <div className="hub-dash-issue-group-detail__issues">
                      {group.issues.map((issue) => (
                        <article key={issue.id} className="hub-dash-issue-group-detail__issue">
                          <a
                            className="hub-dash-issue-group-detail__issueLink"
                            href={projectFocusHref(issue.projectId, { kind: "issue", id: issue.id })}
                            aria-label={t("hub.dash.projects.issueDetail.open", { title: issue.title })}
                            title={t("hub.dash.projects.issueDetail.open", { title: issue.title })}
                          >
                            <div className="hub-dash-issue-group-detail__issueTop">
                              <span className="hub-dash-issue-group-detail__state" data-state={issue.state}>{statusText(locale, ISSUE_STATE_NAMES[issue.state])}</span>
                              <h4>{issue.title}</h4>
                              <span className="hub-dash-issue-group-detail__openHint" aria-hidden="true">›</span>
                            </div>
                            <div className="hub-dash-issue-group-detail__meta">
                              <span>{fieldText(locale, "责任人")}：{issue.ownerName === null || issue.ownerName === "" ? t("hub.dash.projects.unassigned") : issue.ownerName}</span>
                              <span>{t("hub.dash.projects.issueRaisedAt")}：<time dateTime={issue.raisedAt}>{issue.raisedAt}</time></span>
                            </div>
                            <div className="hub-dash-issue-group-detail__categories">
                              {issue.categories.map((category) => (
                                <span key={category} style={{ backgroundColor: DASHBOARD_ISSUE_COLORS[category] ?? "#c9ced6" }}>{fieldText(locale, category)}</span>
                              ))}
                            </div>
                            {issue.solution === null || issue.solution === "" ? null : (
                              <p className="hub-dash-issue-group-detail__solution"><b>{fieldText(locale, "解决方案或建议")}</b>：{issue.solution}</p>
                            )}
                          </a>
                          {issue.photos.length === 0 ? null : (
                            <div className="hub-dash-issue-group-detail__photos">
                              <b>{fieldText(locale, "问题附图")}</b>
                              <PhotoTiles photos={issue.photos} onPreviewOpenChange={(open) => { thumbPreviewOpenRef.current = open; }} />
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
            {groups.length === 0 ? <div className="hub-dash-project-list-detail__empty">{t("hub.dash.issueDetail.empty")}</div> : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
