import { useEffect, useId, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { Member } from "../data/members";
import { useT } from "../i18n";
import { fetchProjectGroup } from "../projectGroupApi";
import { MemberMultiSelect } from "./MemberSelect";
import { useFocusTrap } from "./useFocusTrap";

const INPUT_CLASS =
  "w-full rounded-lg border border-zinc-200/90 bg-white/75 px-3 py-2 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white";

export type TempTaskCreateValues = {
  title: string;
  titleEn: string;
  managerIds: string[];
  ownerIds: string[];
  syncToGroup: boolean;
};

type TempTaskCreateFormProps = {
  /** 项目群绑定查询用；缺省 = 不显示群同步入口。 */
  projectId?: string;
  stageName?: string;
  managerOptions: readonly Member[];
  ownerOptions: readonly Member[];
  /** 看板负责人列新建时预填该列负责人；仍可在表单里改选或清空为待定。 */
  initialOwnerIds?: readonly string[];
  onCreate: (values: TempTaskCreateValues) => Promise<string | null>;
  onClose: () => void;
};

/** 项目总览和看板共用的新建面板，固定在视口内。 */
export function TempTaskCreateForm({ projectId, stageName, managerOptions, ownerOptions, initialOwnerIds = [], onCreate, onClose }: TempTaskCreateFormProps) {
  const t = useT();
  const headingId = useId();
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const [title, setTitle] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [ownerIds, setOwnerIds] = useState<string[]>(() => [...initialOwnerIds]);
  const [syncToGroup, setSyncToGroup] = useState(false);
  const [groupSyncAvailable, setGroupSyncAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const invalid = title.trim() === "" || (stageName === undefined && managerIds.length === 0);

  useEffect(() => {
    if (projectId === undefined || projectId === "") {
      return;
    }
    const controller = new AbortController();
    void fetchProjectGroup(projectId, controller.signal)
      .then((binding) => {
        if (!controller.signal.aborted) {
          setGroupSyncAvailable(binding.bound && binding.activated);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setGroupSyncAvailable(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [projectId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || busy) return;
    setBusy(true);
    try {
      const createdId = await onCreate({
        title: title.trim(),
        titleEn: titleEn.trim(),
        managerIds,
        ownerIds,
        syncToGroup: syncToGroup && groupSyncAvailable,
      });
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
        const openPicker = dialogRef.current?.querySelector<HTMLButtonElement>("[aria-haspopup=\"listbox\"][aria-expanded=\"true\"]");
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
        <h2 id={headingId} className="mb-3 text-sm font-semibold text-zinc-800">{stageName === undefined ? t("tt.formAria") : t("board.additionalStage.addTask", { stage: stageName })}</h2>
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
            {stageName === undefined ? <div data-temp-task-manager="true">
              <p className="mb-1 text-xs font-medium text-zinc-700">{t("tt.managerRequired")}</p>
              <MemberMultiSelect
                values={managerIds}
                onChange={setManagerIds}
                options={managerOptions}
                ariaLabel={t("tt.managerRequired")}
              />
            </div> : null}
            <div data-temp-task-owner="true">
              <p className="mb-1 text-xs font-medium text-zinc-700">{t("tt.ownerOptional")}</p>
              <MemberMultiSelect
                values={ownerIds}
                onChange={setOwnerIds}
                options={ownerOptions}
                placeholder={t("tt.ownerPending")}
                ariaLabel={t("tt.ownerOptional")}
              />
            </div>
            {groupSyncAvailable ? (
              <label
                data-temp-task-group-sync="true"
                className="mt-1 flex cursor-pointer items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-2.5 py-2 text-xs text-zinc-700"
              >
                <input
                  type="checkbox"
                  checked={syncToGroup}
                  onChange={(event) => { setSyncToGroup(event.target.checked); }}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-zinc-900"
                />
                <span className="min-w-0 font-medium">{t("tt.syncToGroup")}</span>
              </label>
            ) : null}
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
