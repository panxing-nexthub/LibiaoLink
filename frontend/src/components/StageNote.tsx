import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { useFocusTrap } from "./useFocusTrap";

type Props = {
  stageName: string;
  note: string;
  onSave?: (note: string) => Promise<string | null>;
};

/** 液体玻璃底：默认全透明，仅鼠标悬停 / 键盘聚焦时淡入（正常状态只留文字）。 */
const GLASS_SURFACE =
  "pointer-events-none absolute inset-0 rounded-[16px] bg-white/55 opacity-0 ring-1 ring-white/80 backdrop-blur-xl backdrop-saturate-150 " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-1px_0_rgba(255,255,255,0.5),0_10px_24px_-12px_rgba(15,23,42,0.35)] " +
  "transition-opacity duration-200 group-hover/note:opacity-100 group-focus-visible/note:opacity-100";

export function StageNote({ stageName, note, onSave }: Props) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(draft !== null && onSave !== undefined);
  const noteRef = useRef<HTMLSpanElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  // 打开输入框时光标自动落在已有文字末尾（点击「备注」后直接接着写，不用再点一下）。
  const editorOpen = draft !== null && onSave !== undefined;
  useEffect(() => {
    if (!editorOpen) return;
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.focus({ preventScroll: true });
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }, [editorOpen]);

  if (note === "" && onSave === undefined) return null;

  const title = t("board.stageNote.title", { stage: stageName });
  const addText = t("board.stageNote.add");
  const editText = t("board.stageNote.edit");
  const actionText = note === "" ? addText : editText;
  const toggleText = t(showFullNote ? "board.stageNote.collapse" : "board.stageNote.expand");
  const noteTextClassName = "min-w-0 max-w-[30rem] whitespace-pre-wrap break-words text-sm leading-5 text-zinc-700"
    + (showFullNote ? "" : " line-clamp-2");
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
      {onSave !== undefined ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={actionText + " · " + stageName}
          title={actionText}
          onClick={() => {
            setError(null);
            setDraft(note);
          }}
          className={"group/note relative flex min-w-0 items-center rounded-[16px] text-left outline-none transition-colors "
            + (note === ""
              ? "shrink-0 whitespace-nowrap px-1.5 py-1 text-xs text-zinc-600 hover:text-zinc-900 focus-visible:text-zinc-900"
              : "px-1 py-0.5 hover:text-zinc-900 focus-visible:text-zinc-900")}
        >
          <span className={GLASS_SURFACE} aria-hidden="true" />
          <span
            id={noteId}
            ref={noteRef}
            className={"relative " + (note === "" ? "whitespace-nowrap" : noteTextClassName)}
          >
            {note === "" ? addText : note}
          </span>
        </button>
      ) : note !== "" ? (
        <span id={noteId} ref={noteRef} className={noteTextClassName}>
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
                ref={textareaRef}
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
