import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { lockBodyScroll } from "../scrollLock";
import { formatDateTime } from "../projectApi";
import { fetchProjectAiSummary, generateProjectAiSummary, type ProjectAiClaim, type ProjectAiSummary, type ProjectAiSummaryReport } from "../projectAiApi";
import { ProjectAiIcon } from "./ProjectAiIcon";
import { useFocusTrap } from "./useFocusTrap";

type ProjectAiSummaryModalProps = {
  project: { id: string; code: string; description: string };
  onClose: () => void;
};

/** 事实 / 推断 / 建议的视觉区分：推断与建议不能被读成既定事实。 */
function ClaimBadge({ type }: { type: ProjectAiClaim["type"] }) {
  const t = useT();
  const style = type === "fact"
    ? "bg-zinc-100 text-zinc-600"
    : type === "inference"
      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-100"
      : "bg-sky-50 text-sky-700 ring-1 ring-sky-100";
  const label = type === "fact" ? t("ai.claim.fact") : type === "inference" ? t("ai.claim.inference") : t("ai.claim.suggestion");
  return <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium " + style}>{label}</span>;
}

function SourceChips({ sources }: { sources: readonly string[] }) {
  const t = useT();
  const unique = Array.from(new Set(sources.filter((source) => source.trim() !== "")));
  if (unique.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-zinc-400">{t("ai.sources")}</span>
      {unique.map((source) => (
        <span key={source} className="rounded bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500 ring-1 ring-zinc-100">{source}</span>
      ))}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-zinc-100 pt-4">
      <h3 className="text-[13px] font-semibold tracking-wide text-zinc-800">{title}</h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function rangeText(range: { from: string | null; to: string | null }, empty: string): string {
  if (range.from === null && range.to === null) return empty;
  return (range.from ?? empty) + " ~ " + (range.to ?? empty);
}

function overviewValue(value: string | null | undefined, empty: string): string {
  return value === null || value === undefined || value.trim() === "" ? empty : value;
}

function mergeSources(claims: readonly ProjectAiClaim[]): string[] {
  return Array.from(new Set(claims.flatMap((claim) => claim.sources)));
}

function ReportBody({ report }: { report: ProjectAiSummaryReport }) {
  const t = useT();
  const empty = t("ai.noData");
  const progress = report.overview.progress;
  const summarySources = mergeSources(report.summary.claims);
  const resultSources = mergeSources(report.resultsAndRisks.claims.concat(report.resultsAndRisks.risks));
  return (
    <>
      <h2 data-ai-report-title="true" className="text-xl font-semibold tracking-tight text-zinc-900">{report.title}</h2>

      <div className="mt-2 rounded-xl bg-zinc-50/80 p-3.5 text-[13px] leading-6 text-zinc-700">
        <p className="whitespace-pre-wrap">{report.summary.text}</p>
        {summarySources.length === 0 ? null : <SourceChips sources={summarySources} />}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-100 p-3">
          <p className="text-[11px] text-zinc-400">{t("ai.status")}</p>
          <p className="mt-1 text-sm font-medium text-zinc-800">{overviewValue(report.overview.status, empty)}</p>
        </div>
        <div className="rounded-xl border border-zinc-100 p-3">
          <p className="text-[11px] text-zinc-400">{t("ai.startedAt")}</p>
          <p className="mt-1 text-sm font-medium text-zinc-800">{overviewValue(report.overview.startedAt, empty)}</p>
        </div>
        <div className="rounded-xl border border-zinc-100 p-3">
          <p className="text-[11px] text-zinc-400">{t("ai.managers")}</p>
          <p className="mt-1 truncate text-sm font-medium text-zinc-800" title={report.overview.managers.join("、")}>
            {report.overview.managers.length === 0 ? empty : report.overview.managers.join("、")}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-100 p-3">
          <p className="text-[11px] text-zinc-400">{t("ai.projectCode")}</p>
          <p className="mt-1 font-mono text-sm font-medium text-zinc-800">{overviewValue(report.overview.projectCode, empty)}</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-zinc-100 p-3.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[11px] text-zinc-400">{t("ai.progress")}</span>
          <span data-ai-progress="true" className="text-sm font-semibold text-zinc-800">
            {progress.done} / {progress.total}
            {progress.percent === null ? "" : " · " + String(progress.percent) + "%"}
          </span>
          <span className="ml-auto text-[11px] text-zinc-500">{t("ai.latestStage")}：{overviewValue(progress.latestStage, empty)}</span>
          <span className="text-[11px] text-zinc-500">{t("ai.slowestStage")}：{overviewValue(progress.slowestStage, empty)}</span>
        </div>
        {progress.percent === null ? null : (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-[#FF8F6B]" style={{ width: String(Math.max(0, Math.min(100, progress.percent))) + "%" }} />
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-500">
          <span>{t("ai.planRange")}：{rangeText(report.overview.planRange, empty)}</span>
          <span>{t("ai.reportRange")}：{rangeText(report.overview.reportRange, empty)}</span>
        </div>
      </div>

      <Section title={t("ai.timeline")}>
        {report.timeline.length === 0 ? (
          <p className="text-xs text-zinc-400">{empty}</p>
        ) : (
          <ol className="relative ml-1 border-l border-zinc-200">
            {report.timeline.map((item, index) => (
              <li key={String(index) + item.date} className="relative pb-4 pl-4 last:pb-0">
                <span className="absolute -left-[3.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-[#FF8F6B]" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-zinc-400">{item.date}</span>
                  <span className="text-[13px] font-medium text-zinc-800">{item.title}</span>
                  <ClaimBadge type={item.type} />
                </div>
                <p className="mt-1 text-[13px] leading-6 text-zinc-600">{item.text}</p>
                <SourceChips sources={item.sources} />
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={t("ai.issues")}>
        <div className="flex flex-wrap gap-2">
          {[
            { label: t("ai.issues.total"), value: report.issues.total },
            { label: t("ai.issues.done"), value: report.issues.done },
            { label: t("ai.issues.inProgress"), value: report.issues.inProgress },
            { label: t("ai.issues.open"), value: report.issues.open },
          ].map((entry) => (
            <span key={entry.label} className="rounded-lg bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-500 ring-1 ring-zinc-100">
              {entry.label} <span className="ml-1 font-semibold text-zinc-800">{entry.value}</span>
            </span>
          ))}
        </div>
        {report.issues.summary.trim() === "" ? null : <p className="mt-2 text-[13px] leading-6 text-zinc-600">{report.issues.summary}</p>}
        {report.issues.currentItems.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-400">{t("ai.issues.none")}</p>
        ) : (
          <ul className="mt-2.5 space-y-2.5">
            {report.issues.currentItems.map((item, index) => (
              <li key={String(index)} className="rounded-xl border border-zinc-100 p-3">
                <div className="flex items-start gap-2">
                  <ClaimBadge type={item.type} />
                  <p className="min-w-0 flex-1 text-[13px] leading-6 text-zinc-700">{item.text}</p>
                </div>
                <dl className="mt-2 grid gap-1 text-[11px] text-zinc-500 sm:grid-cols-3">
                  <div><dt className="inline text-zinc-400">{t("ai.issues.owner")}：</dt><dd className="inline">{item.owner}</dd></div>
                  <div><dt className="inline text-zinc-400">{t("ai.issues.handling")}：</dt><dd className="inline">{item.handling}</dd></div>
                  <div><dt className="inline text-zinc-400">{t("ai.issues.nextStep")}：</dt><dd className="inline">{item.nextStep}</dd></div>
                </dl>
                <SourceChips sources={item.sources} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("ai.results")}>
        <p className="text-[13px] leading-6 text-zinc-600">{report.resultsAndRisks.text}</p>
        {report.resultsAndRisks.risks.length === 0 ? null : (
          <ul className="mt-2.5 space-y-2">
            {report.resultsAndRisks.risks.map((risk, index) => (
              <li key={String(index)} className="rounded-xl bg-amber-50/60 p-3 ring-1 ring-amber-100">
                <div className="flex items-start gap-2">
                  <ClaimBadge type={risk.type} />
                  <p className="min-w-0 flex-1 text-[13px] leading-6 text-amber-900">{risk.text}</p>
                </div>
                <SourceChips sources={risk.sources} />
              </li>
            ))}
          </ul>
        )}
        {resultSources.length === 0 ? null : <SourceChips sources={resultSources} />}
      </Section>

      <Section title={t("ai.handoff")}>
        {report.handoff.existing.length === 0 ? (
          <p className="text-xs text-zinc-400">{t("ai.handoff.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {report.handoff.existing.map((item, index) => (
              <li key={String(index)} className="rounded-xl border border-zinc-100 p-3">
                <div className="flex items-start gap-2">
                  <ClaimBadge type={item.type} />
                  <p className="min-w-0 flex-1 text-[13px] leading-6 text-zinc-700">{item.text}</p>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">{t("ai.handoff.owner")}：{item.owner} · {t("ai.issues.nextStep")}：{item.nextStep}</p>
                <SourceChips sources={item.sources} />
              </li>
            ))}
          </ul>
        )}
        {report.handoff.suggestions.length === 0 ? null : (
          <>
            <p className="mt-4 text-[11px] font-medium text-zinc-500">{t("ai.handoff.suggestions")}</p>
            <ul className="mt-1.5 space-y-2">
              {report.handoff.suggestions.map((item, index) => (
                <li key={String(index)} className="rounded-xl border border-sky-100 bg-sky-50/40 p-3">
                  <div className="flex items-start gap-2">
                    <ClaimBadge type={item.type} />
                    <p className="min-w-0 flex-1 text-[13px] leading-6 text-zinc-700">{item.text}</p>
                    {item.needsHumanConfirmation ? (
                      <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] text-sky-700 ring-1 ring-sky-200">{t("ai.handoff.needsHuman")}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-500">{t("ai.handoff.reason")}：{item.reason}</p>
                  <p className="text-[11px] leading-5 text-zinc-500">{t("ai.issues.nextStep")}：{item.nextStep}</p>
                  <p className="text-[11px] leading-5 text-zinc-500">{t("ai.handoff.acceptance")}：{item.acceptance}</p>
                  <SourceChips sources={item.sources} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {report.notes.length === 0 ? null : (
        <Section title={t("ai.notes")}>
          <ul className="space-y-1.5">
            {report.notes.map((note, index) => (
              <li key={String(index)} className="text-xs leading-5 text-zinc-500">
                <ClaimBadge type={note.type} /> <span className="ml-1.5">{note.text}</span>
                <SourceChips sources={note.sources} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

export function ProjectAiSummaryModal({ project, onClose }: ProjectAiSummaryModalProps) {
  const t = useT();
  const trapRef = useFocusTrap<HTMLDivElement>();
  const [summary, setSummary] = useState<ProjectAiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"load" | "generate" | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => lockBodyScroll(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setErrorKind(null);
    fetchProjectAiSummary(project.id)
      .then((result) => { if (!cancelled) setSummary(result); })
      .catch(() => { if (!cancelled) { setError(t("ai.loadFailed")); setErrorKind("load"); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // t 随语言切换变化，但这里只在打开 / 重试时取一次；语言切换不影响已取到的报告。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, reloadTick]);

  const generate = async (force: boolean) => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setErrorKind(null);
    try {
      setSummary(await generateProjectAiSummary(project.id, force));
    } catch {
      setError(summary === null ? t("ai.failed") : t("ai.regenerateFailed"));
      setErrorKind("generate");
    } finally {
      setGenerating(false);
    }
  };

  const busy = loading || generating;
  return createPortal(
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("ai.aria")}
      data-ai-summary-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[75] flex items-center justify-center bg-zinc-900/40 p-4 sm:p-6"
    >
      <div
        onClick={(event) => { event.stopPropagation(); }}
        className="flex h-[86vh] w-[920px] max-w-[96vw] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
      >
        <header className="flex shrink-0 items-center gap-2.5 border-b border-zinc-100 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF1EB]">
            <ProjectAiIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-800">{t("ai.title")}</p>
            <p className="truncate text-[11px] text-zinc-400">{project.code} · {project.description}</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {summary === null || busy ? null : (
              <button
                type="button"
                data-ai-regenerate="true"
                onClick={() => { void generate(true); }}
                className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-50"
              >
                {t("ai.regenerate")}
              </button>
            )}
            <button
              type="button"
              aria-label={t("ai.close")}
              title={t("ai.close")}
              data-ai-close="true"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-400">
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 animate-spin" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <p className="text-xs">{t("ai.loading")}</p>
            </div>
          ) : generating ? (
            <div data-ai-generating="true" className="flex h-full flex-col items-center justify-center gap-3 text-zinc-400">
              <ProjectAiIcon className="h-9 w-9 animate-pulse" />
              <p className="text-sm font-medium text-zinc-600">{t("ai.generating")}</p>
              <p className="text-xs text-zinc-400">{t("ai.generatingHint")}</p>
            </div>
          ) : summary === null ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFF1EB]">
                <ProjectAiIcon className="h-8 w-8" />
              </span>
              <h2 className="mt-4 text-base font-semibold text-zinc-800">{t("ai.empty.title")}</h2>
              <p className="mt-1.5 max-w-[440px] text-xs leading-5 text-zinc-500">{t("ai.empty.hint")}</p>
              {error === null ? null : <p className="mt-2 text-xs text-rose-500">{error}</p>}
              <button
                type="button"
                data-ai-generate="true"
                onClick={() => {
                  if (errorKind === "load") setReloadTick((tick) => tick + 1);
                  else void generate(false);
                }}
                className="mt-5 rounded-xl bg-[#FF8F6B] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105"
              >
                {errorKind === "load" || error !== null ? t("common.retry") : t("ai.generate")}
              </button>
              <p className="mt-3 text-[11px] text-zinc-400">{t("ai.empty.privacy")}</p>
            </div>
          ) : (
            <>
              {error === null ? null : (
                <p data-ai-error="true" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>
              )}
              {summary.stale ? (
                <div data-ai-stale="true" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-100">
                  <span>{t("ai.stale")}</span>
                  <button
                    type="button"
                    onClick={() => { void generate(true); }}
                    className="rounded-md bg-white px-2 py-1 font-medium text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100"
                  >
                    {t("ai.regenerate")}
                  </button>
                </div>
              ) : null}
              <ReportBody report={summary.report} />
              <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-100 pt-3 text-[11px] text-zinc-400">
                <span>{t("ai.generatedAt", { time: formatDateTime(summary.generatedAt) })}</span>
                {summary.generatedByName === null ? null : <span>{t("ai.generatedBy", { name: summary.generatedByName })}</span>}
                {summary.modelId === null ? null : <span className="font-mono">{t("ai.model")}：{summary.modelId}</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
