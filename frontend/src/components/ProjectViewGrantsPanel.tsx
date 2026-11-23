import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { copyTextToClipboard } from "../clipboard";
import { useT } from "../i18n";
import {
  addProjectViewGrants, listProjectViewGrants, previewProjectViewGrants, revokeProjectViewGrant,
  type ProjectViewGrantList, type ProjectViewGrantPreview,
} from "../projectViewGrantApi";
import { projectViewHref } from "../useHashRoute";
import { ToastConfirm } from "./Toast";

type Grant = ProjectViewGrantList["items"][number];
type PreviewRow = ProjectViewGrantPreview["items"][number];
type DirectoryUser = PreviewRow["candidates"][number];

const BUTTON = "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50";
const PRIMARY_BUTTON = "rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50";

function userLabel(user: DirectoryUser): string {
  return [user.displayName, user.username, user.email].filter(Boolean).join(" · ");
}

export function ProjectViewGrantsPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<Grant | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error?: true } | null>(null);
  const userIds = [...new Set(choices.filter(Boolean))];

  useEffect(() => {
    let current = true;
    setListFailed(false);
    void listProjectViewGrants(projectId).then(
      (response) => { if (current) setGrants(response.items); },
      () => { if (current) setListFailed(true); },
    );
    return () => { current = false; };
  }, [projectId, revision]);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setFeedback(null);
    try {
      await action();
    } catch (error) {
      setFeedback({ text: error instanceof ApiError ? error.message : t("pd.grants.failed"), error: true });
    } finally {
      setPending(false);
    }
  }

  function choose(index: number, userId: string) {
    setChoices((previous) => previous.map((value, at) => at === index ? userId : value));
  }

  async function preview() {
    const response = await previewProjectViewGrants(projectId, text);
    setRows(response.items);
    setChoices(response.items.map((row) => row.status === "matched" ? row.candidates[0]?.id ?? "" : ""));
  }

  async function add() {
    const response = await addProjectViewGrants(projectId, userIds);
    setText("");
    setRows(null);
    setChoices([]);
    setFeedback({ text: t(response.added > 0 ? "pd.grants.added" : "pd.grants.alreadyAdded", { n: response.added }) });
    setRevision((value) => value + 1);
  }

  async function revoke(grant: Grant) {
    await revokeProjectViewGrant(projectId, grant.user.id);
    setConfirm(null);
    setGrants((previous) => previous?.filter((item) => item.user.id !== grant.user.id) ?? null);
    setFeedback({ text: t("pd.grants.revoked", { name: grant.user.displayName }) });
    setRevision((value) => value + 1);
  }

  async function copyLink() {
    const link = new URL(projectViewHref(projectId, "overview"), window.location.href);
    link.search = "";
    const copied = await copyTextToClipboard(link.href);
    setFeedback(copied ? { text: t("pd.grants.copied") } : { text: t("pd.grants.copyFailed"), error: true });
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-5 py-4">
      <section aria-labelledby="project-grant-import" className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
        <h2 id="project-grant-import" className="text-base font-semibold text-zinc-900">{t("pd.grants.import")}</h2>
        <textarea
          aria-label={t("pd.grants.members")}
          className="my-3 w-full resize-y rounded-lg border border-zinc-300 p-3 text-sm"
          rows={4}
          value={text}
          disabled={pending}
          onChange={(event) => { setText(event.target.value); setRows(null); setChoices([]); setFeedback(null); }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BUTTON} disabled={pending || !text.trim()} onClick={() => void run(preview)}>{t("pd.grants.preview")}</button>
          {rows !== null && (
            <button type="button" className={PRIMARY_BUTTON} disabled={pending || userIds.length === 0} onClick={() => void run(add)}>
              {t("pd.grants.add", { n: userIds.length })}
            </button>
          )}
        </div>
        {rows !== null && (
          <div className="mt-4 space-y-4">
            <ul className="divide-y divide-zinc-100 text-sm">
              {rows.map((row, index) => row.status === "unmatched" ? null : (
                <li key={index} className="py-2">
                  {row.status === "matched" ? (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" disabled={pending} checked={choices[index] !== ""}
                        onChange={(event) => choose(index, event.target.checked ? row.candidates[0]?.id ?? "" : "")} />
                      <span>{userLabel(row.candidates[0]!)} <span className="text-zinc-500">({row.text})</span></span>
                    </label>
                  ) : (
                    <label className="flex flex-wrap items-center gap-2">
                      <span>{row.text}</span>
                      <select className="max-w-full rounded-lg border border-zinc-300 p-1.5" disabled={pending} value={choices[index]}
                        onChange={(event) => choose(index, event.target.value)}>
                        <option value="">{t("pd.grants.confirmAccount")}</option>
                        {row.candidates.map((user) => <option key={user.id} value={user.id}>{userLabel(user)}</option>)}
                      </select>
                    </label>
                  )}
                </li>
              ))}
            </ul>
            {rows.some((row) => row.status === "unmatched") && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <h3 className="font-medium">{t("pd.grants.unmatched")}</h3>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {rows.map((row, index) => row.status === "unmatched" && <li key={index} className="break-all">{row.text}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="project-grant-list" className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="project-grant-list" className="text-base font-semibold text-zinc-900">{t("pd.grants.list")}</h2>
            <p className="mt-1 text-sm text-zinc-600">{t("pd.grants.linkHint")}</p>
          </div>
          <button type="button" className={BUTTON} onClick={() => void copyLink()}>{t("pd.grants.copy")}</button>
        </div>
        {listFailed ? (
          <div className="mt-3 flex items-center gap-2 text-sm" role="alert">
            <span>{t("pd.grants.loadFailed")}</span>
            <button type="button" className={BUTTON} onClick={() => setRevision((value) => value + 1)}>{t("common.retry")}</button>
          </div>
        ) : grants === null ? (
          <p className="mt-3 text-sm text-zinc-600">{t("common.loading")}</p>
        ) : grants.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">{t("pd.grants.empty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {grants.map((grant) => (
              <li key={grant.user.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="break-all">{userLabel(grant.user)}{grant.user.status === "disabled" ? " · " + t("pd.grants.disabled") : ""}</span>
                <button type="button" className={BUTTON} disabled={pending} onClick={() => setConfirm(grant)}>{t("pd.grants.revoke")}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {feedback !== null && (
        <p role={feedback.error ? "alert" : "status"} className={feedback.error ? "text-sm text-red-700" : "text-sm text-emerald-700"}>
          {feedback.text}
        </p>
      )}
      {confirm !== null && (
        <ToastConfirm text={t("pd.grants.confirmRevoke", { name: confirm.user.displayName })}
          ariaLabel={t("pd.grants.revoke")} cancelLabel={t("common.cancel")} confirmLabel={t("pd.grants.revoke")}
          onCancel={() => setConfirm(null)} confirmDisabled={pending} onConfirm={() => void run(() => revoke(confirm))} />
      )}
    </div>
  );
}
