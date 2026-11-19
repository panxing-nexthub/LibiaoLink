import { useId, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { Member } from "../data/members";
import { useT } from "../i18n";
import { MemberMultiSelect } from "./MemberSelect";
import { useFocusTrap } from "./useFocusTrap";

const INPUT_CLASS =
  "w-full rounded-lg border border-zinc-200/90 bg-white/75 px-3 py-2 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white";

export type TempTaskCreateValues = {
  title: string;
  titleEn: string;
  managerIds: string[];
};

type TempTaskCreateFormProps = {
  managerOptions: readonly Member[];
  onCreate: (values: TempTaskCreateValues) => Promise<string | null>;
  onClose: () => void;
};

/** 项目总览和看板共用的新建面板，固定在视口内。 */
export function TempTaskCreateForm({ managerOptions, onCreate, onClose }: TempTaskCreateFormProps) {
  const t = useT();
  const headingId = useId();
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const [title, setTitle] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const invalid = title.trim() === "" || managerIds.length === 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || busy) return;
    setBusy(true);
    try {
      const createdId = await onCreate({ title: title.trim(), titleEn: titleEn.trim(), managerIds });
      if (createdId !== null) onClose();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-40 grid place-items-center overflow-hidden bg-zinc-950/10 p-4"
      onPointerDown={(event) => { event.stopPropagation(); }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        const openPicker = dialogRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"][aria-expanded="true"]');
        if (openPicker) {
          openPicker.focus({ preventScroll: true });
          return;
        }
        event.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        data-temp-task-dialog="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-[400px] overflow-y-auto overscroll-contain rounded-2xl border border-white/80 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.98),rgba(255,255,255,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_12px_40px_rgba(15,23,42,0.22)] backdrop-blur-2xl backdrop-saturate-150"
      >
        <h2 id={headingId} className="mb-3 text-sm font-semibold text-zinc-800">{t("tt.formAria")}</h2>
        <form data-temp-task-form="true" onSubmit={submit}>
          <fieldset disabled={busy} className="grid min-w-0 gap-2">
            <input
              required
              maxLength={200}
              value={title}
              onChange={(event) => { setTitle(event.target.value); }}
              placeholder={t("tt.name")}
              aria-label={t("tt.nameAria")}
              className={INPUT_CLASS}
            />
            <input
              maxLength={200}
              value={titleEn}
              onChange={(event) => { setTitleEn(event.target.value); }}
              placeholder={t("tt.nameEn")}
              aria-label={t("tt.nameEnAria")}
              className={INPUT_CLASS}
            />
            <div data-temp-task-manager="true">
              <p className="mb-1 text-xs font-medium text-zinc-700">{t("tt.managerRequired")}</p>
              <MemberMultiSelect
                values={managerIds}
                onChange={setManagerIds}
                options={managerOptions}
                ariaLabel={t("tt.managerRequired")}
              />
            </div>
            <div className="mt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-zinc-200 bg-white/60 px-3 py-1.5 text-xs text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-800"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={invalid || busy}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
              >
                {t("tt.create")}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>,
    document.body,
  );
}
