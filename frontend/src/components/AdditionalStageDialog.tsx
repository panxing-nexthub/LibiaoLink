import { useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { stageText, useLocale, useT } from "../i18n";
import { additionalStageName, projectTaskStageNames, stageKeyOfName, type AdditionalProjectStage } from "../taskApi";
import { SelectMenu } from "./SelectMenu";
import { ToastConfirm } from "./Toast";
import { useFocusTrap } from "./useFocusTrap";

type Props = {
  target: AdditionalProjectStage | null;
  onCreate: (stageKey: string) => Promise<string | null>;
  onRemove: (stageId: string) => Promise<string | null>;
  onClose: () => void;
};

export function AdditionalStageDialog({ target, onCreate, onRemove, onClose }: Props) {
  const t = useT();
  const locale = useLocale();
  const ref = useFocusTrap<HTMLDivElement>();
  const [stageKey, setStageKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (!busy) onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    const openMenu = ref.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"][aria-expanded="true"]');
    if (openMenu) {
      openMenu.focus({ preventScroll: true });
      return;
    }
    event.stopPropagation();
    close();
  };

  const save = async (write: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const message = await write();
      if (message === null) onClose();
      else setError(message);
    } finally {
      setBusy(false);
    }
  };

  const errorText = error === null ? null : <span role="alert" className="block text-xs text-red-700">{error}</span>;
  if (target !== null) {
    return (
      <div onKeyDown={handleKeyDown}>
        <ToastConfirm
          text={<>{t("board.additionalStage.removeConfirm", { stage: stageText(locale, additionalStageName(target)) })}{errorText}</>}
          ariaLabel={t("board.additionalStage.remove")}
          cancelLabel={t("common.cancel")}
          confirmLabel={t("common.delete")}
          onCancel={close}
          onConfirm={() => { void save(() => onRemove(target.id)); }}
          confirmDisabled={busy}
          containerRef={ref}
        />
      </div>
    );
  }

  const title = t("board.additionalStage.add");
  const field = t("board.additionalStage.after");
  const options = projectTaskStageNames().map((name) => ({
    value: stageKeyOfName(name) ?? "",
    label: stageText(locale, name),
  }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (stageKey !== "") void save(() => onCreate(stageKey));
  };

  return createPortal(
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-zinc-950/10 p-4"
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      onKeyDown={handleKeyDown}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-[400px] rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl">
        <h2 className="mb-3 text-sm font-semibold text-zinc-800">{title}</h2>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-zinc-700">{field}</span>
            <SelectMenu
              value={stageKey}
              options={options}
              onChange={setStageKey}
              ariaLabel={field}
              disabled={busy}
            />
          </div>
          {errorText}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} disabled={busy} className="rounded-lg border border-zinc-200 bg-white/60 px-3 py-1.5 text-xs text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-800">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy || stageKey === ""}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
            >
              {t("board.additionalStage.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
