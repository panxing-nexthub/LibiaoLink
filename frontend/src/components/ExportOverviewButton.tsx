import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  OVERVIEW_PREVIEW_FRAME_WIDTH as PREVIEW_FRAME_WIDTH,
  buildOverviewPreviewHtml,
  overviewExportTranslationRequest,
} from "../exportOverviewPdf";
import { cachedZhTo, translateZhTo, type TranslationTarget } from "../translateApi";
import { stageText, useLocale, useT } from "../i18n";
import {
  DEFAULT_OVERVIEW_TASK_COLUMNS,
  defaultOverviewExportName,
  resolvedOverviewExportName,
  type OverviewExportInput,
  type OverviewExportLanguage,
  type OverviewExportOptions,
  type OverviewExportStageOption,
  type OverviewTaskColumns,
} from "../overviewExportShared";
import { OverviewColumnSelector } from "./OverviewColumnSelector";

type ExportOverviewButtonProps = {
  /** 当前项目总览数据：设置面板左侧实时报告预览与最终导出共用。 */
  input: OverviewExportInput;
  /** 页面已分好组的阶段（含计数），用于逐阶段折叠设置。 */
  stages: readonly OverviewExportStageOption[];
  /** 确认导出时把最终预览 HTML 一并交给下载端，保证预览与 PDF 同源。 */
  onExport: (options: OverviewExportOptions, previewHtml: string) => void;
  /** 任务数据还在取 / 重取中：置灰不给点，避免导出半份数据。 */
  disabled?: boolean;
  /** 导出进行中（等项目名 / 任务名 / 进展描述译文，见 §6.16）：按钮转「生成中…」并防重复点击。 */
  busy?: boolean;
};

const EMPTY_PREVIEW_TRANSLATIONS: ReadonlyMap<string, string> = new Map();

/** 从会话缓存组装当前可用的预览译文；翻译逐条完成时也用它原位刷新。 */
function cachedTranslationMap(texts: readonly string[], target: TranslationTarget): Map<string, string> {
  const map = new Map<string, string>();
  for (const text of texts) {
    if (text.trim() === "") {
      continue;
    }
    const hit = cachedZhTo(text, target);
    if (hit !== null) {
      map.set(text, hit);
    }
  }
  return map;
}

const LANGUAGES: readonly {
  value: OverviewExportLanguage;
  labelKey: "export.primary.zh" | "export.primary.en" | "export.primary.ja" | "export.primary.ko";
  hintKey: "export.primary.zhHint" | "export.primary.enHint" | "export.primary.jaHint" | "export.primary.koHint";
}[] = [
  { value: "zh", labelKey: "export.primary.zh", hintKey: "export.primary.zhHint" },
  { value: "en", labelKey: "export.primary.en", hintKey: "export.primary.enHint" },
  { value: "ja", labelKey: "export.primary.ja", hintKey: "export.primary.jaHint" },
  { value: "ko", labelKey: "export.primary.ko", hintKey: "export.primary.koHint" },
];

/**
 * 「导出 PDF」按钮（项目总览工具区 · 业务口径 2026-10-09；2026-10-29 追加逐阶段 DIY 折叠与实时预览）。
 * 点击后打开居中设置面板：左侧预览，右侧主体语言 + 任务明细列显示开关 + 阶段显示开关与折叠 / 展开（默认全部展示、全部展开）；确认后才生成报告。
 * 预览与最终导出共用同一份报告 HTML；点面板外 / 按 Esc 收起。
 */
export function ExportOverviewButton({ input, stages, onExport, disabled = false, busy = false }: ExportOverviewButtonProps) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [primary, setPrimary] = useState<OverviewExportLanguage>("zh");
  const [collapsedStages, setCollapsedStages] = useState<readonly string[]>([]);
  const [hiddenStages, setHiddenStages] = useState<readonly string[]>([]);
  const [taskColumns, setTaskColumns] = useState<OverviewTaskColumns>({ ...DEFAULT_OVERVIEW_TASK_COLUMNS });
  const defaultExportName = useMemo(
    () => defaultOverviewExportName(input.project),
    [input.project.code, input.project.description],
  );
  const [exportName, setExportName] = useState(defaultExportName);
  const [previewBootHtml, setPreviewBootHtml] = useState("");
  const [previewTranslations, setPreviewTranslations] = useState<ReadonlyMap<string, string>>(EMPTY_PREVIEW_TRANSLATIONS);
  const [previewTranslating, setPreviewTranslating] = useState(false);
  const [previewTranslationProgress, setPreviewTranslationProgress] = useState<{ done: number; total: number } | null>(null);
  const [settledTranslationKey, setSettledTranslationKey] = useState<string | null>(null);
  const [previewBootReady, setPreviewBootReady] = useState(false);
  const [previewFrameReady, setPreviewFrameReady] = useState(false);
  const [previewPages, setPreviewPages] = useState({ current: 1, total: 1 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const sentPreviewHtmlRef = useRef("");
  const blocked = disabled || busy;
  const visibleStageCount = stages.filter((stage) => !hiddenStages.includes(stage.name)).length;

  const previewTranslationRequest = useMemo(
    () => overviewExportTranslationRequest(input, { primary, collapsedStages, hiddenStages, columns: taskColumns }),
    [input.project, input.tasks, input.summary, primary, collapsedStages, hiddenStages],
  );
  const previewTranslationKey = useMemo(
    () => previewTranslationRequest.target + "\u0000" + previewTranslationRequest.texts.join("\u0001"),
    [previewTranslationRequest],
  );
  const previewTranslationReady = settledTranslationKey === previewTranslationKey;
  const previewBusy = previewTranslating || !previewFrameReady || !previewTranslationReady;

  const previewHtml = useMemo(
    () => (open ? buildOverviewPreviewHtml(input, previewTranslations, primary, collapsedStages, taskColumns, hiddenStages) : ""),
    [open, input.project, input.tasks, input.summary, primary, collapsedStages, hiddenStages, taskColumns, previewTranslations],
  );

  /**
   * 预览与正式导出走同一条译文请求：中文、英文主体补英文，日韩主体补对应译文；
   * 先塞入会话缓存里已就绪的条目让画面立即接近成品，其余译文到达后再无闪烁地补全。
   * 120ms 防抖只挡连续切换语言 / 阶段，不会拖慢固定标签的即时切换。
   */
  useEffect(() => {
    if (!open) {
      setPreviewTranslating(false);
      setPreviewTranslationProgress(null);
      setSettledTranslationKey(null);
      return;
    }
    const request = previewTranslationRequest;
    const cached = cachedTranslationMap(request.texts, request.target);
    setPreviewTranslations(cached);
    setPreviewTranslationProgress(null);
    const allCached = request.texts.every((text) => text.trim() === "" || cached.has(text));
    if (allCached) {
      setPreviewTranslating(false);
      setSettledTranslationKey(previewTranslationKey);
      return;
    }
    let cancelled = false;
    setPreviewTranslating(true);
    const timer = window.setTimeout(() => {
      void translateZhTo(request.texts, request.target, (done, total) => {
        if (cancelled) {
          return;
        }
        setPreviewTranslationProgress({ done, total });
        setPreviewTranslations(cachedTranslationMap(request.texts, request.target));
      })
        .then((translated) => {
          if (cancelled) {
            return;
          }
          setPreviewTranslations(translated);
        })
        .catch(() => undefined)
        .finally(() => {
          if (cancelled) {
            return;
          }
          setPreviewTranslating(false);
          setPreviewTranslationProgress(null);
          setSettledTranslationKey(previewTranslationKey);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, previewTranslationKey, previewTranslationRequest]);

  useEffect(() => {
    if (!open) {
      sentPreviewHtmlRef.current = "";
      setPreviewBootHtml("");
      setPreviewBootReady(false);
      setPreviewPages({ current: 1, total: 1 });
      return;
    }
    setPreviewBootReady(false);
    setPreviewPages({ current: 1, total: 1 });
    setPreviewBootHtml(buildOverviewPreviewHtml(input, EMPTY_PREVIEW_TRANSLATIONS, "zh", [], taskColumns));
  }, [open]);

  useEffect(() => {
    setPreviewFrameReady(false);
  }, [open, previewHtml]);

  useEffect(() => {
    if (!open || !previewFrameReady || sentPreviewHtmlRef.current === previewHtml) {
      return;
    }
    const frameWindow = previewFrameRef.current?.contentWindow;
    if (frameWindow === null || frameWindow === undefined) {
      return;
    }
    frameWindow.postMessage({ type: "libiaolink:overview-preview-update", html: previewHtml }, "*");
    sentPreviewHtmlRef.current = previewHtml;
  }, [open, previewFrameReady, previewHtml]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== previewFrameRef.current?.contentWindow) {
        return;
      }
      const data = event.data as { type?: unknown; current?: unknown; total?: unknown } | null;
      if (
        data?.type !== "libiaolink:overview-preview-pages" ||
        typeof data.current !== "number" ||
        typeof data.total !== "number"
      ) {
        return;
      }
      const total = Math.max(1, Math.round(data.total));
      setPreviewPages({ current: Math.min(total, Math.max(1, Math.round(data.current))), total });
      setPreviewBootReady(true);
      setPreviewFrameReady(true);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      const inTrigger = rootRef.current?.contains(target) ?? false;
      const inDialog = dialogRef.current?.contains(target) ?? false;
      if (!inTrigger && !inDialog) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (blocked) {
      setOpen(false);
    }
  }, [blocked]);

  const togglePanel = () => {
    setOpen((previous) => {
      if (!previous) {
        setPrimary("zh");
        setCollapsedStages([]);
        setHiddenStages([]);
        setTaskColumns({ ...DEFAULT_OVERVIEW_TASK_COLUMNS });
        setExportName(defaultExportName);
      }
      return !previous;
    });
  };

  const toggleStage = (name: string) => {
    setCollapsedStages((previous) =>
      previous.includes(name) ? previous.filter((item) => item !== name) : [...previous, name],
    );
  };

  const toggleStageVisibility = (name: string) => {
    setHiddenStages((previous) => {
      if (previous.includes(name)) {
        return previous.filter((item) => item !== name);
      }
      const remaining = stages.filter((stage) => stage.name !== name && !previous.includes(stage.name)).length;
      return remaining === 0 ? previous : [...previous, name];
    });
  };

  const submit = () => {
    if (blocked) {
      return;
    }
    setOpen(false);
    onExport({
      primary,
      collapsedStages,
      hiddenStages,
      columns: taskColumns,
      exportName: resolvedOverviewExportName(input.project, exportName),
    }, previewHtml);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        data-export-overview=""
        className="export-docs-btn"
        aria-label={t("export.aria")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={busy}
        disabled={blocked}
        onClick={togglePanel}
      >
        <span className="export-docs-btn__face">
          <svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1={16} y1={13} x2={8} y2={13} />
            <line x1={16} y1={17} x2={8} y2={17} />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          {busy ? t("export.busy") : t("export.pdf")}
          {busy ? null : (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={"h-3 w-3 transition-transform " + (open ? "rotate-180" : "")}>
              <path d="M5.5 8l4.5 4.5L14.5 8" />
            </svg>
          )}
        </span>
      </button>
      {open ? createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label={t("export.close")}
            className="absolute inset-0 cursor-default bg-zinc-950/35 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="overview-export-dialog-title"
            data-export-overview-panel=""
            className="relative flex h-[min(920px,calc(100dvh-2rem))] w-full max-w-[1680px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-3.5">
              <div>
                <div id="overview-export-dialog-title" className="text-base font-semibold text-zinc-900">{t("export.dialog.title")}</div>
                <div className="mt-0.5 text-[11px] text-zinc-400">{t("export.preview.hint")}</div>
              </div>
              <button
                type="button"
                aria-label={t("export.close")}
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
              >
                <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
              <section className="hidden min-h-0 flex-col bg-zinc-100 lg:flex" aria-label={t("export.preview.title")}>
                <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
                  <span className="text-xs font-semibold text-zinc-700">{t("export.preview.title")}</span>
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-full border border-zinc-200 bg-white/80 px-2 py-0.5 text-[10px] font-medium tabular-nums text-zinc-500">
                      {previewPages.current} / {previewPages.total}
                    </span>
                    <span aria-live="polite" className="inline-flex items-center gap-1.5 text-[10px] text-zinc-400">
                      <span className={"h-1.5 w-1.5 rounded-full " + (previewBusy ? "animate-pulse bg-amber-400" : "bg-emerald-500")} />
                      {previewBusy
                        ? t("export.busy") + (previewTranslating && previewTranslationProgress !== null
                          ? " " + previewTranslationProgress.done + " / " + previewTranslationProgress.total
                          : "")
                        : t("export.preview.live")}
                    </span>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-5 pt-3">
                  <div className="mx-auto h-full shrink-0" style={{ width: PREVIEW_FRAME_WIDTH }}>
                    <div className="relative h-full w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
                      <iframe
                        ref={previewFrameRef}
                        data-export-preview-frame=""
                        title={t("export.preview.title")}
                        srcDoc={previewBootHtml}
                        tabIndex={-1}
                        referrerPolicy="no-referrer"
                        className="absolute left-0 top-0 h-full border-0 bg-white"
                        style={{ width: PREVIEW_FRAME_WIDTH }}
                      />
                      {!previewBootReady ? (
                        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/95">
                          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-sm">
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-800" />
                            {t("export.busy")}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>

              <section className="min-h-0 overflow-y-auto border-t border-zinc-200 p-4 lg:border-l lg:border-t-0">
                <div className="mb-4">
                  <label htmlFor="overview-export-name" className="mb-1.5 block px-0.5 text-xs font-medium text-zinc-500">{t("export.name.title")}</label>
                  <input
                    id="overview-export-name"
                    data-export-name=""
                    type="text"
                    value={exportName}
                    maxLength={160}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setExportName(event.target.value)}
                    aria-label={t("export.name.title")}
                    className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                  />
                </div>
                <div className="mb-1.5 px-0.5 text-xs font-medium text-zinc-500">{t("export.primary.title")}</div>
                <div role="radiogroup" aria-label={t("export.primary.title")} className="grid grid-cols-2 gap-1.5">
                  {LANGUAGES.map((language) => {
                    const selected = primary === language.value;
                    return (
                      <button
                        key={language.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        data-export-language={language.value}
                        onClick={() => setPrimary(language.value)}
                        className={
                          "flex min-h-14 flex-col items-start rounded-lg border px-2.5 py-2 text-left transition " +
                          (selected
                            ? "border-zinc-900 bg-zinc-50 text-zinc-900 ring-1 ring-zinc-900"
                            : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50")
                        }
                      >
                        <span className="text-sm font-medium">{t(language.labelKey)}</span>
                        <span className="mt-0.5 text-[11px] leading-4 text-zinc-400">{t(language.hintKey)}</span>
                      </button>
                    );
                  })}
                </div>

                <OverviewColumnSelector columns={taskColumns} onChange={setTaskColumns} />

                <div className="my-4 h-px bg-zinc-100" />
                <div className="mb-1 px-0.5 text-xs font-medium text-zinc-500">{t("export.content.title")}</div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    data-export-show-all-stages=""
                    onClick={() => setHiddenStages([])}
                    disabled={visibleStageCount === stages.length}
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                  >
                    {t("export.stage.allShown")}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-export-expand-all=""
                      onClick={() => setCollapsedStages([])}
                      className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                    >
                      {t("export.stage.allExpanded")}
                    </button>
                    <span className="text-zinc-300">/</span>
                    <button
                      type="button"
                      data-export-collapse-all=""
                      onClick={() => setCollapsedStages(stages.map((stage) => stage.name))}
                      className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                    >
                      {t("export.stage.allCollapsed")}
                    </button>
                  </div>
                </div>
                <div role="group" aria-label={t("export.content.title")} className="space-y-1 pr-0.5">
                  {stages.map((stage) => {
                    const visible = !hiddenStages.includes(stage.name);
                    const collapsed = collapsedStages.includes(stage.name);
                    const lastVisible = visible && visibleStageCount <= 1;
                    const count = stage.total === 0 ? t("export.stage.empty") : stage.done + " / " + stage.total;
                    const label = stageText(locale, stage.name);
                    return (
                      <div
                        key={stage.name}
                        data-export-stage-row={stage.name}
                        className={
                          "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 transition " +
                          (visible ? "border-zinc-200 bg-white" : "border-dashed border-zinc-200 bg-zinc-50/70")
                        }
                      >
                        <label
                          className={"flex min-w-0 flex-1 cursor-pointer items-center gap-2 " + (visible ? "text-zinc-800" : "text-zinc-400")}
                          title={lastVisible ? t("export.stage.lastVisible") : t("export.stage.showToggle", { stage: label })}
                        >
                          <input
                            type="checkbox"
                            data-export-stage-visible={stage.name}
                            checked={visible}
                            disabled={lastVisible}
                            aria-label={t("export.stage.showToggle", { stage: label })}
                            onChange={() => toggleStageVisibility(stage.name)}
                            className="h-3.5 w-3.5 shrink-0 accent-zinc-900 disabled:cursor-not-allowed"
                          />
                          <span className="min-w-0 truncate text-sm font-medium" title={label}>{label}</span>
                        </label>
                        <span className={"shrink-0 text-[11px] tabular-nums " + (visible ? "text-zinc-400" : "text-zinc-300")}>{count}</span>
                        <button
                          type="button"
                          data-export-stage-toggle={stage.name}
                          aria-label={t("export.stage.toggle", { stage: label })}
                          aria-pressed={collapsed}
                          disabled={!visible}
                          onClick={() => toggleStage(stage.name)}
                          className={
                            "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition " +
                            (!visible
                              ? "cursor-default bg-zinc-100 text-zinc-400"
                              : collapsed
                                ? "bg-zinc-900 text-white hover:bg-zinc-700"
                                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700")
                          }
                        >
                          {!visible
                            ? t("export.stage.hidden")
                            : collapsed ? t("export.stage.collapsed") : t("export.stage.expanded")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
              >
                {t("export.cancel")}
              </button>
              <button
                type="button"
                data-export-submit=""
                onClick={submit}
                className="rounded-lg bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
              >
                {t("export.submit")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
