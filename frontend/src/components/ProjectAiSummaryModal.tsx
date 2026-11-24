import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { lockBodyScroll } from "../scrollLock";
import { formatDateTime } from "../projectApi";
import {
  enqueueProjectDocumentAnalysis,
  fetchProjectAiContext,
  fetchProjectAiSummary,
  fetchProjectAiSummaryIssues,
  fetchProjectAiSummaryReports,
  fetchProjectDocumentAnalysis,
  generateProjectAiSummary,
  uploadProjectAiAgreementImage,
  deleteProjectAiAgreementImage,
  type ProjectAiContext,
  type ProjectAiSummary,
  type ProjectAiSummaryIssue,
  type ProjectAiSummaryReportEntry,
} from "../projectAiApi";
import { buildProjectSummaryView, type SummaryView } from "../projectSummaryView";
import { exportProjectSummaryPdf } from "../projectSummaryPdf";
import { ProjectAiIcon } from "./ProjectAiIcon";
import { ProjectSummaryDocument } from "./ProjectSummaryDocument";
import { useFocusTrap } from "./useFocusTrap";

type ProjectAiSummaryModalProps = {
  project: { id: string; code: string; description: string };
  onClose: () => void;
};

export function ProjectAiSummaryModal({ project, onClose }: ProjectAiSummaryModalProps) {
  const t = useT();
  const trapRef = useFocusTrap<HTMLDivElement>();
  /** 缩略图大图预览开着时，Esc 先关预览，不关总结弹窗。 */
  const previewOpenRef = useRef(false);
  const [summary, setSummary] = useState<ProjectAiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatePhase, setGeneratePhase] = useState<"files" | "summary">("files");
  const [analysisProgress, setAnalysisProgress] = useState<{ done: number; total: number } | null>(null);
  const [analysisWarning, setAnalysisWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"load" | "generate" | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [extras, setExtras] = useState<{
    context: ProjectAiContext | null;
    reports: ProjectAiSummaryReportEntry[];
    issues: ProjectAiSummaryIssue[];
  }>({ context: null, reports: [], issues: [] });

  useEffect(() => lockBodyScroll(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !previewOpenRef.current) onClose();
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

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchProjectAiContext(project.id).catch(() => null),
      fetchProjectAiSummaryReports(project.id).catch(() => [] as ProjectAiSummaryReportEntry[]),
      fetchProjectAiSummaryIssues(project.id).catch(() => [] as ProjectAiSummaryIssue[]),
    ]).then(([context, reports, issues]) => {
      if (!cancelled) setExtras({ context, reports, issues });
    });
    return () => { cancelled = true; };
  }, [project.id, reloadTick, summary?.generatedAt]);

  const documentView: SummaryView | null = summary === null
    ? null
    : buildProjectSummaryView({ context: extras.context, summary, reports: extras.reports, issues: extras.issues });

  const generate = async (force: boolean) => {
    if (generating) return;
    setGenerating(true);
    setGeneratePhase("files");
    setAnalysisProgress({ done: 0, total: 0 });
    setAnalysisWarning(null);
    setError(null);
    setErrorKind(null);
    try {
      let warning: string | null = null;
      try {
        const initial = await enqueueProjectDocumentAnalysis(project.id);
        setAnalysisProgress({ done: initial.succeededCount + initial.failedCount, total: initial.fileCount });
        let attempts = 0;
        for (;;) {
          const view = await fetchProjectDocumentAnalysis(project.id);
          const run = view.run ?? initial;
          setAnalysisProgress({ done: run.succeededCount + run.failedCount, total: run.fileCount });
          if (run.status === "succeeded" || run.status === "failed") {
            if (run.status === "failed" || run.failedCount > 0) warning = t("ai.files.partial");
            break;
          }
          if (attempts >= 300) {
            warning = t("ai.files.timeout");
            break;
          }
          attempts += 1;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
        }
      } catch {
        warning = t("ai.files.partial");
      }
      if (warning !== null) setAnalysisWarning(warning);
      setGeneratePhase("summary");
      setSummary(await generateProjectAiSummary(project.id, force));
    } catch {
      setError(summary === null ? t("ai.failed") : t("ai.regenerateFailed"));
      setErrorKind("generate");
    } finally {
      setGenerating(false);
      setAnalysisProgress(null);
    }
  };

  const replaceAgreementImage = async (kind: "layout" | "three_d", files: File[]) => {
    for (const file of files) {
      await uploadProjectAiAgreementImage(project.id, kind, file);
    }
    // 重新拉取上下文：人工图 URL 带版本参数，刷新后立即可见。
    setReloadTick((tick) => tick + 1);
  };

  const removeAgreementImage = async (kind: "layout" | "three_d", imageId: string) => {
    await deleteProjectAiAgreementImage(project.id, kind, imageId);
    setReloadTick((tick) => tick + 1);
  };

  const exportPdf = async () => {
    if (exporting) return;
    const root = scrollRef.current?.querySelector<HTMLElement>("[data-ai-summary-document]");
    if (root === null || root === undefined) return;
    setExporting(true);
    setError(null);
    setErrorKind(null);
    try {
      const code = summary?.report.overview.projectCode ?? project.code;
      const name = summary?.report.overview.projectName ?? project.description;
      await exportProjectSummaryPdf(root, "[" + code + "] " + name + " 项目总结");
    } catch {
      setError(t("ai.export.failed"));
      setErrorKind("generate");
    } finally {
      setExporting(false);
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
                data-ai-export-pdf="true"
                disabled={exporting}
                onClick={() => { void exportPdf(); }}
                className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exporting ? t("ai.export.running") : t("ai.export.pdf")}
              </button>
            )}
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

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-400">
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 animate-spin" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <p className="text-xs">{t("ai.loading")}</p>
            </div>
          ) : generating ? (
            <div data-ai-generating="true" data-ai-generate-phase={generatePhase} className="flex h-full flex-col items-center justify-center gap-3 text-zinc-400">
              <ProjectAiIcon className="h-9 w-9 animate-pulse" />
              <p className="text-sm font-medium text-zinc-600">{generatePhase === "files" ? t("ai.files.analyzing") : t("ai.generating")}</p>
              {generatePhase === "files" && analysisProgress !== null && analysisProgress.total > 0 ? (
                <div className="w-full max-w-[360px]" data-ai-files-progress="">
                  <div className="mb-2 flex justify-between text-[11px] text-zinc-500">
                    <span>{t("ai.files.progress", { done: analysisProgress.done, total: analysisProgress.total })}</span>
                    <span>{Math.round((analysisProgress.done / analysisProgress.total) * 100)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-[#FF8F6B] transition-[width]" style={{ width: String(Math.max(0, Math.min(100, Math.round((analysisProgress.done / analysisProgress.total) * 100)))) + "%" }} />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-zinc-400">{generatePhase === "files" ? t("ai.files.analyzingHint") : t("ai.generatingHint")}</p>
              )}
            </div>
          ) : summary === null ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFF1EB]">
                <ProjectAiIcon className="h-8 w-8" />
              </span>
              <h2 className="mt-4 text-base font-semibold text-zinc-800">{t("ai.empty.title")}</h2>
              <p className="mt-1.5 max-w-[440px] text-xs leading-5 text-zinc-500">{t("ai.empty.hint")}</p>
              {error === null ? null : <p className="mt-2 text-xs text-rose-500">{error}</p>}
              {analysisWarning === null ? null : <p className="mt-2 text-xs text-amber-600">{analysisWarning}</p>}
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
              {analysisWarning === null ? null : (
                <p data-ai-files-warning="true" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">{analysisWarning}</p>
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
              {documentView === null ? null : (
                <ProjectSummaryDocument
                  view={documentView}
                  onPreviewOpenChange={(open) => { previewOpenRef.current = open; }}
                  onReplaceImage={extras.context?.agreement == null ? undefined : replaceAgreementImage}
                  onRemoveImage={extras.context?.agreement == null ? undefined : removeAgreementImage}
                />
              )}
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
