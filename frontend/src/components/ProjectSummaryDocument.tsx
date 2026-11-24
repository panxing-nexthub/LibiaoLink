import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import type { SummaryPhoto, SummaryView } from "../projectSummaryView";
import { PhotoStrip } from "./ReportIssuePanel";

type ProjectSummaryDocumentProps = {
  view: SummaryView;
  onPreviewOpenChange?: (open: boolean) => void;
  /** 人工替换布局图 / 三维图（P1）；不传则不显示替换入口。 */
  onReplaceImage?: (kind: "layout" | "three_d", file: File) => Promise<void>;
};

function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-zinc-200 pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-[15px] font-bold tracking-wide text-zinc-900">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SourceLine({ sources }: { sources: readonly string[] }) {
  const t = useT();
  if (sources.length === 0) return null;
  return (
    <p className="mt-2 text-[10px] text-zinc-400">
      {t("ai.sources")}：{sources.join(" / ")}
    </p>
  );
}

function Missing({ note }: { note?: string }) {
  const t = useT();
  return (
    <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/60 px-3 py-4 text-center text-[12px] text-zinc-400">
      {t("ai.doc.unrecognized")}
      {note === undefined ? null : <span className="ml-1 text-[10px] text-zinc-300">{note}</span>}
    </div>
  );
}

function dateOnly(value: string | null): string {
  if (value === null || value === "") return "—";
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function Gauge({ percent }: { percent: number | null }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const value = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="relative h-[116px] w-[116px] shrink-0" data-ai-progress-gauge="true">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#F4F4F5" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#FF8F6B"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={String((circumference * value) / 100) + " " + String(circumference)}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[15px] font-semibold text-zinc-800">
        {percent === null ? "—" : String(value) + "%"}
      </div>
    </div>
  );
}

function LayoutSlot({ label, kind, photo, onPreviewOpenChange, onReplace }: {
  label: string;
  kind: "layout" | "three_d";
  photo: SummaryPhoto | null;
  onPreviewOpenChange?: (open: boolean) => void;
  onReplace?: (kind: "layout" | "three_d", file: File) => Promise<void>;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pick = () => inputRef.current?.click();
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined || onReplace === undefined) return;
    setBusy(true);
    setFailed(false);
    try {
      await onReplace(kind, file);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-zinc-100 p-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-medium text-zinc-500">{label}</p>
        {onReplace === undefined ? null : (
          <>
            <button
              type="button"
              onClick={pick}
              disabled={busy}
              className="ml-auto rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-zinc-50 disabled:opacity-60"
            >
              {busy ? t("ai.doc.replacing") : t("ai.doc.replace")}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => { void onFile(event); }}
            />
          </>
        )}
      </div>
      {failed ? <p className="mt-1 text-[10px] text-rose-500">{t("ai.doc.replaceFailed")}</p> : null}
      <div className="mt-2">
        {photo === null || (photo.fileId === null && photo.url === null) ? (
          <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50/60 text-[12px] text-zinc-400">
            {t("ai.doc.unrecognized")}
          </div>
        ) : photo.fileId !== null ? (
          <PhotoStrip
            items={[{ fileId: photo.fileId, name: photo.name, url: photo.url }]}
            size="lg"
            strip={"summary-layout-" + label}
            previewZClass="z-[85]"
            onPreviewOpenChange={onPreviewOpenChange}
          />
        ) : (
          <a
            href={photo.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50/60"
            title={photo.name}
          >
            <img src={photo.url ?? undefined} alt={label} className="h-28 w-full object-contain" />
          </a>
        )}
      </div>
      {photo === null ? null : <p className="mt-1 truncate text-[10px] text-zinc-400" title={photo.name}>{photo.name}</p>}
    </div>
  );
}

function BasicRows({ items }: { items: Array<{ label: string; value: string | null }> }) {
  const t = useT();
  return (
    <dl className="divide-y divide-zinc-100 rounded-xl border border-zinc-100">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 px-3 py-2">
          <dt className="text-[12px] text-zinc-500">{item.label}</dt>
          <dd className={"text-[13px] " + (item.value === null ? "text-zinc-400" : "font-medium text-zinc-800")}>
            {item.value ?? t("ai.doc.unrecognized")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ProjectSummaryDocument({ view, onPreviewOpenChange, onReplaceImage }: ProjectSummaryDocumentProps) {
  const t = useT();
  const unidentified = t("ai.doc.unrecognized");

  const periodText = view.basic.periodText !== null
    ? view.basic.periodText
    : view.basic.period === null
      ? unidentified
      : t("ai.doc.plan") + " " +
        (view.basic.period.planFrom ?? unidentified) + " ~ " + (view.basic.period.planTo ?? unidentified) + " / " +
        t("ai.doc.actual") + " " +
        (view.basic.period.actualFrom ?? unidentified) + " ~ " +
        (view.basic.period.ongoing ? t("ai.doc.ongoing") : (view.basic.period.actualTo ?? unidentified));

  const memberText = view.basic.members.length === 0
    ? null
    : view.basic.members
        .map((member) => (member.role === "manager" ? member.name + "（" + t("ai.managers") + "）" : member.name))
        .join("、");

  const progressSummary = view.progress.text ?? t("ai.doc.progressSummary", {
    done: String(view.progress.done),
    total: String(view.progress.total),
    percent: view.progress.percent === null ? "—" : String(view.progress.percent),
    latest: view.progress.latestStage ?? unidentified,
    slowest: view.progress.slowestStage ?? unidentified,
  });

  return (
    <div data-ai-summary-document="true" className="space-y-5">
      <div className="text-center">
        <h2 data-ai-report-title="true" className="text-[20px] font-bold tracking-tight text-zinc-900">
          [{view.basic.code}] {view.basic.name} {t("ai.doc.titleSuffix")}
        </h2>
      </div>

      <DocSection title={t("ai.doc.basic")}>
        <BasicRows
          items={[
            { label: t("ai.projectCode"), value: view.basic.code },
            { label: t("ai.doc.projectName"), value: view.basic.name },
            { label: t("ai.doc.period"), value: periodText },
            { label: t("ai.doc.partyA"), value: view.basic.partyA },
            { label: t("ai.doc.customer"), value: view.basic.customer },
            { label: t("ai.doc.address"), value: view.basic.address },
            { label: t("ai.doc.members"), value: memberText },
          ]}
        />
        <SourceLine sources={view.basic.sources} />
      </DocSection>

      <DocSection title={t("ai.doc.layout")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LayoutSlot
            label={t("ai.doc.cad")}
            kind="layout"
            photo={view.layout.cad}
            onPreviewOpenChange={onPreviewOpenChange}
            onReplace={onReplaceImage}
          />
          <LayoutSlot
            label={t("ai.doc.threeD")}
            kind="three_d"
            photo={view.layout.threeD}
            onPreviewOpenChange={onPreviewOpenChange}
            onReplace={onReplaceImage}
          />
        </div>
        <SourceLine sources={view.layout.sources} />
      </DocSection>

      <DocSection title={t("ai.doc.background")}>
        {view.background.text === null ? (
          <Missing note={t("ai.doc.backgroundHint")} />
        ) : (
          <p className="whitespace-pre-wrap text-[13px] leading-7 text-zinc-700">{view.background.text}</p>
        )}
        <SourceLine sources={view.background.sources} />
      </DocSection>

      <DocSection title={t("ai.doc.equipment")}>
        {view.equipment.rows.length === 0 ? (
          <Missing />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12px]">
              <thead>
                <tr className="bg-zinc-50 text-left text-[11px] text-zinc-500">
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.category")}</th>
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.itemCount")}</th>
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.quantity")}</th>
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.representative")}</th>
                </tr>
              </thead>
              <tbody>
                {view.equipment.rows.map((row, index) => (
                  <tr key={row.category + "#" + String(index)} className="text-zinc-700">
                    <td className="border border-zinc-100 px-2 py-1.5 font-medium">{row.category}</td>
                    <td className="border border-zinc-100 px-2 py-1.5">{row.itemCount}</td>
                    <td className="border border-zinc-100 px-2 py-1.5">{row.quantityText === "" ? "—" : row.quantityText}</td>
                    <td className="border border-zinc-100 px-2 py-1.5">{row.representative === "" ? "—" : row.representative}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <SourceLine sources={view.equipment.source === null ? [] : [view.equipment.source]} />
      </DocSection>

      <DocSection title={t("ai.doc.progress")}>
        <div className="rounded-xl border border-zinc-100 p-4">
          <div className="flex flex-wrap items-center gap-5">
            <Gauge percent={view.progress.percent} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-6 text-zinc-700">{progressSummary}</p>
              <p className="mt-1 text-[11px] text-zinc-500">
                {t("ai.doc.overall")}：{view.progress.percent === null ? unidentified : String(view.progress.percent) + "%"}
                {" · "}{t("ai.progress")}：{view.progress.done} / {view.progress.total}
              </p>
            </div>
          </div>
          {view.progress.rows.length === 0 ? (
            <div className="mt-3"><Missing /></div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-[12px]">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[11px] text-zinc-500">
                    <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.stage")}</th>
                    <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.stageStatus")}</th>
                    <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.plannedRange")}</th>
                    <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.actualRange")}</th>
                    <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.taskDone")}</th>
                    <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.completion")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.progress.rows.map((row, index) => (
                    <tr key={row.stage + "#" + String(index)} className="text-zinc-700">
                      <td className="border border-zinc-100 px-2 py-1.5 font-medium">{row.stage}</td>
                      <td className="border border-zinc-100 px-2 py-1.5">{row.status === "done" ? t("ai.doc.stageDone") : row.status === "active" ? t("ai.doc.stageActive") : t("ai.doc.stagePending")}</td>
                      <td className="border border-zinc-100 px-2 py-1.5">{row.planText}</td>
                      <td className="border border-zinc-100 px-2 py-1.5">{row.actualText}</td>
                      <td className="border border-zinc-100 px-2 py-1.5">{row.done} / {row.total}</td>
                      <td className="border border-zinc-100 px-2 py-1.5">{row.percent === null ? "—" : String(row.percent) + "%"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <SourceLine sources={["系统任务与阶段记录"]} />
      </DocSection>

      <DocSection title={t("ai.doc.sitePhotos")}>
        {view.sitePhotos.length === 0 ? (
          <Missing />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {view.sitePhotos.map((item, index) => item.photo.fileId === null ? null : (
              <figure key={item.photo.fileId + "#" + String(index)} className="rounded-lg border border-zinc-100 p-2">
                <PhotoStrip
                  items={[{ fileId: item.photo.fileId, name: item.photo.name, url: item.photo.url }]}
                  size="lg"
                  strip={"summary-site-" + String(index)}
                  previewZClass="z-[85]"
                  onPreviewOpenChange={onPreviewOpenChange}
                />
                <figcaption className="mt-1 truncate text-[10px] text-zinc-500" title={item.caption}>{item.caption}</figcaption>
              </figure>
            ))}
          </div>
        )}
        <SourceLine sources={view.sitePhotos.length === 0 ? [] : ["日报现场附图"]} />
      </DocSection>

      <DocSection title={t("ai.doc.issues")}>
        {view.issues.stats.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-zinc-400">{t("ai.doc.topCategories")}：</span>
            {view.issues.stats.map((entry) => (
              <span
                key={entry.category}
                className={
                  "rounded px-1.5 py-0.5 text-[10px] " +
                  (view.issues.topTwo.includes(entry.category)
                    ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                    : "bg-zinc-50 text-zinc-500 ring-1 ring-zinc-100")
                }
              >
                {entry.category} · {entry.count}
              </span>
            ))}
          </div>
        )}
        {view.issues.summary === null ? null : (
          <p className="mt-2 text-[13px] leading-6 text-zinc-700">{view.issues.summary}</p>
        )}
        {view.issues.rows.length === 0 ? (
          <div className="mt-2"><Missing /></div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-[12px]">
              <thead>
                <tr className="bg-zinc-50 text-left text-[11px] text-zinc-500">
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.index")}</th>
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.issueTitle")}</th>
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.issueCategories")}</th>
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.stageStatus")}</th>
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.issueOwner")}</th>
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.raisedAt")}</th>
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.solution")}</th>
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.closedAt")}</th>
                  <th className="border border-zinc-100 px-2 py-1.5 font-medium">{t("ai.doc.issuePhotos")}</th>
                </tr>
              </thead>
              <tbody>
                {view.issues.rows.map((row) => {
                  const visible = row.photos
                    .slice(0, 3)
                    .filter((photo): photo is SummaryPhoto & { fileId: string } => photo.fileId !== null);
                  const more = row.photos.length - visible.length;
                  return (
                    <tr key={row.id} className="align-top text-zinc-700">
                      <td className="border border-zinc-100 px-2 py-1.5">{row.index}</td>
                      <td className="border border-zinc-100 px-2 py-1.5">{row.title}</td>
                      <td className="border border-zinc-100 px-2 py-1.5">{row.categories.join("、")}</td>
                      <td className="border border-zinc-100 px-2 py-1.5">{row.state === "done" ? t("ai.issues.done") : row.state === "in_progress" ? t("ai.issues.inProgress") : t("ai.issues.open")}</td>
                      <td className="border border-zinc-100 px-2 py-1.5">{row.owner === null || row.owner === "" ? t("ai.doc.unassigned") : row.owner}</td>
                      <td className="border border-zinc-100 px-2 py-1.5 whitespace-nowrap">{dateOnly(row.raisedAt)}</td>
                      <td className="border border-zinc-100 px-2 py-1.5">{row.solution === null || row.solution === "" ? "—" : row.solution}</td>
                      <td className="border border-zinc-100 px-2 py-1.5 whitespace-nowrap">{row.closedAt === null ? "—" : dateOnly(row.closedAt)}</td>
                      <td className="border border-zinc-100 px-2 py-1.5">
                        {visible.length === 0 ? (
                          <span className="text-zinc-300">—</span>
                        ) : (
                          <div>
                            <PhotoStrip
                              items={visible}
                              size="md"
                              strip={"summary-issue-" + row.id}
                              previewZClass="z-[85]"
                              onPreviewOpenChange={onPreviewOpenChange}
                            />
                            {more <= 0 ? null : <p className="mt-1 text-[10px] text-zinc-400">{t("ai.doc.photoMore", { n: String(more) })}</p>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <SourceLine sources={["问题记录"]} />
      </DocSection>

      <DocSection title={t("ai.doc.personal")}>
        {view.personal === null ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/60 px-3 py-4 text-[12px] text-zinc-400">
            {t("ai.doc.pending")}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-[13px] leading-7 text-zinc-700">{view.personal}</p>
        )}
      </DocSection>

      <DocSection title={t("ai.doc.sources")}>
        {view.sourceAppendix.length === 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {Array.from(new Set([
              "系统项目档案",
              "系统任务与阶段记录",
              ...(view.sitePhotos.length === 0 ? [] : ["日报现场附图"]),
              "问题记录",
              ...(view.layout.sources.length === 0 ? [] : ["技术协议"]),
              ...(view.equipment.source === null ? [] : [view.equipment.source]),
            ])).map((source) => (
              <span key={source} className="rounded bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500 ring-1 ring-zinc-100">{source}</span>
            ))}
          </div>
        ) : (
          <ul className="space-y-1 text-[11px] text-zinc-500">
            {view.sourceAppendix.map((item, index) => (
              <li key={item.fileName + "#" + String(index)}>
                {item.fileName}（{item.docType} · {item.version} · {item.date}）
              </li>
            ))}
          </ul>
        )}
      </DocSection>
    </div>
  );
}
