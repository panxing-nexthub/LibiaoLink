import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../api";
import { stageText, useLocale, useT } from "../i18n";
import { sendStageCompletionNotice, stageNameOf, type ProjectStageNotice } from "../taskApi";
import { usePopover } from "./usePopover";

type StageCompletionNoticesProps = {
  projectId: string;
  notices: readonly ProjectStageNotice[];
  canSend: boolean;
  onRefresh: () => Promise<void>;
};

export function StageCompletionNotices({ projectId, notices, canSend, onRefresh }: StageCompletionNoticesProps) {
  const locale = useLocale();
  const t = useT();
  const panelId = useId();
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(360, 340);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const refreshRef = useRef(onRefresh);
  useEffect(() => { refreshRef.current = onRefresh; }, [onRefresh]);

  const unsent = notices.filter((notice) => notice.status !== "sent");
  const sent = notices.filter((notice) => notice.status === "sent");
  const sending = unsent.some((notice) => notice.status === "sending");
  const visible = open && position !== null;
  const stageLabel = (key: string) => stageText(locale, stageNameOf(key));
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai",
  });

  useEffect(() => {
    if (open) void refreshRef.current();
  }, [open]);

  useEffect(() => {
    if (!open || !sending) return;
    const timer = window.setInterval(() => { void refreshRef.current(); }, 3000);
    return () => { window.clearInterval(timer); };
  }, [open, sending]);

  useEffect(() => {
    if (visible) popoverRef.current?.focus();
  }, [visible, popoverRef]);

  async function send(stageKey: string): Promise<void> {
    setSubmitting(stageKey);
    setSendError(null);
    try {
      await sendStageCompletionNotice(projectId, stageKey);
    } catch (error) {
      const code = error instanceof ApiError ? error.details[0]?.code : undefined;
      const message = code === "stage_not_done" ? t("board.stageNotice.notDone")
        : code === "stage_documents_missing" ? t("board.stageNotice.missingFiles")
        : code === "stage_group_unavailable" ? t("board.stageNotice.groupUnavailable")
        : t("board.stageNotice.sendError");
      setSendError(message);
    } finally {
      await refreshRef.current();
      setSubmitting(null);
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => { setSendError(null); setOpen((previous) => !previous); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={visible ? panelId : undefined}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-600"
      >
        {t("board.stageNotice.title")}
        {unsent.length > 0 ? (
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 tabular-nums text-zinc-700">{unsent.length}</span>
        ) : null}
      </button>
      {open && position !== null ? createPortal(
        <div
          id={panelId}
          ref={popoverRef}
          role="dialog"
          aria-labelledby={panelId + "-title"}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") triggerRef.current?.focus();
          }}
          className="fixed z-[80] space-y-3 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-xl outline-none"
          style={{ top: position.top, left: position.left, width: position.width, maxWidth: "calc(100vw - 16px)", maxHeight: Math.max(0, Math.min(340, window.innerHeight - position.top - 8)) }}
        >
          <h2 id={panelId + "-title"} className="font-semibold text-zinc-900">{t("board.stageNotice.title")}</h2>
          {sendError !== null ? <p role="alert" className="rounded-lg bg-rose-50 px-2.5 py-2 text-xs text-rose-700">{sendError}</p> : null}
          <section aria-labelledby={panelId + "-unsent"}>
            <h3 id={panelId + "-unsent"} className="text-xs font-medium text-zinc-500">{t("board.stageNotice.unsent")}</h3>
            {unsent.length === 0 ? <p className="mt-1 text-xs text-zinc-500">{t("board.stageNotice.emptyUnsent")}</p> : (
              <ul className="mt-1 divide-y divide-zinc-100">
                {unsent.map((notice) => {
                  const inProgress = notice.status === "sending" || submitting === notice.stageKey;
                  return (
                    <li key={notice.stageKey} className="flex min-h-9 items-center justify-between gap-2 py-1.5">
                      <span className="font-medium text-zinc-800">{stageLabel(notice.stageKey)}</span>
                      {inProgress ? (
                        <span className="shrink-0 text-xs text-zinc-500" role="status">{t("board.stageNotice.sending")}</span>
                      ) : canSend ? (
                        <button
                          type="button"
                          aria-label={t("board.stageNotice.sendNamed", { stage: stageLabel(notice.stageKey) })}
                          onClick={() => { void send(notice.stageKey); }}
                          disabled={submitting !== null}
                          className="shrink-0 rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-600 disabled:opacity-50"
                        >
                          {notice.status === "failed" ? t("board.stageNotice.retry") : t("board.stageNotice.send")}
                        </button>
                      ) : (
                        <span className="shrink-0 text-xs text-zinc-500">{t("board.stageNotice.unsent")}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section aria-labelledby={panelId + "-sent"} className="border-t border-zinc-100 pt-3">
            <h3 id={panelId + "-sent"} className="text-xs font-medium text-zinc-500">{t("board.stageNotice.sent")}</h3>
            {sent.length === 0 ? <p className="mt-1 text-xs text-zinc-500">{t("board.stageNotice.emptySent")}</p> : (
              <ul className="mt-1 divide-y divide-zinc-100">
                {sent.map((notice) => (
                  <li key={notice.stageKey} className="flex min-h-9 items-center justify-between gap-2 py-1.5">
                    <span className="font-medium text-zinc-800">{stageLabel(notice.stageKey)}</span>
                    {notice.sentAt !== null ? (
                      <time dateTime={notice.sentAt} className="text-right text-xs tabular-nums text-zinc-500">{dateFormat.format(new Date(notice.sentAt))}</time>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
