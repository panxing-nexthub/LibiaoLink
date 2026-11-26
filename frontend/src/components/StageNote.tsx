import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { useFocusTrap } from "./useFocusTrap";

type Props = {
  stageName: string;
  note: string;
  onSave?: (note: string) => Promise<string | null>;
};

export function StageNote({ stageName, note, onSave }: Props) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(draft !== null && onSave !== undefined);
  const noteRef = useRef<HTMLSpanElement>(null);
  const noteId = useId();
  const [hasOverflow, setHasOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const showFullNote = hasOverflow && expanded;

  useLayoutEffect(() => {
    const text = noteRef.current;
    if (text === null) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
      setHasOverflow(text.scrollHeight > lineHeight * 2 + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [note]);

  if (note === "" && onSave === undefined) return null;

  const title = t("board.stageNote.title", { stage: stageName });
  const buttonText = t(note === "" ? "board.stageNote.add" : "common.edit");
  const toggleText = t(showFullNote ? "board.stageNote.collapse" : "board.stageNote.expand");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft === null || onSave === undefined || saving) return;
    setSaving(true);
    setError(null);
    try {
      const message = await onSave(draft.trim());
      if (message === null) {
        setDraft(null);
        setExpanded(false);
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {note !== "" ? (
        <span
          id={noteId}
          ref={noteRef}
          className={"min-w-0 max-w-[30rem] whitespace-pre-wrap break-words text-sm leading-5 text-zinc-700" + (showFullNote ? "" : " line-clamp-2")}
        >
          {note}
        </span>
      ) : null}
      {note !== "" && hasOverflow ? (
        <button
          type="button"
          aria-expanded={showFullNote}
          aria-controls={noteId}
          aria-label={toggleText + " · " + title}
          onClick={() => setExpanded((value) => !value)}
          className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900"
        >
          {toggleText}
        </button>
      ) : null}
      {onSave !== undefined ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={buttonText + " · " + stageName}
          onClick={() => { setError(null); setDraft(note); }}
          className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900"
        >
          {buttonText}
        </button>
      ) : null}
      {draft !== null && onSave !== undefined ? createPortal(
        <div className="fixed inset-0 z-40 grid place-items-center bg-zinc-950/10 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                event.stopPropagation();
                if (!saving) setDraft(null);
              }
            }}
            className="w-full max-w-[400px] rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl"
          >
            <h2 className="mb-3 text-sm font-semibold text-zinc-800">{title}</h2>
            <form onSubmit={(event) => { void submit(event); }} className="grid gap-3">
              <textarea
                aria-label={title}
                rows={3}
                maxLength={200}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                readOnly={saving}
                className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm leading-6 text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10"
              />
              {error !== null ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDraft(null)} disabled={saving} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-100">
                  {t("common.cancel")}
                </button>
                <button type="submit" disabled={saving || draft.trim() === note} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50">
                  {t(saving ? "common.saving" : "common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
