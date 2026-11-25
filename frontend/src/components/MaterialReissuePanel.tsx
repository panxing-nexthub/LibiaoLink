import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api";
import { fetchProjectChanges, type ApiChangeRequest, type MaterialReissueSnapshot } from "../fileApi";
import { materialReissueReasonText } from "../materialReissue";
import { formatDateTime } from "../projectApi";
import { fieldText, textOf, useLocale, useT } from "../i18n";
import type { Member } from "../data/members";
import type { ProjectTask } from "../data/tasks";
import { useLiveRefresh } from "../useLiveRefresh";
import { ChangeDetailModal, stageLabelOf } from "./ChangeDetailModal";
import { Loader } from "./Loader";
import { SearchInput } from "./SearchInput";

/**
 * 项目详情「物料补发」标签（2026-11-25）。
 *
 * 业务口径：任务抽屉「变更申请 → 物料变更补发」里的《补发物料清单》不再只存在于单条变更详情中；
 * 项目详情在「项目文件」旁新增同级页面，按申请单汇总展示本项目全部物料补发清单，
 * 便于项目成员直接查看每种物料的编码 / 名称 / 规格型号 / 数量 / 单位 / 备注。
 *
 * 数据面：GET /projects/{id}/change-requests 中 changeType = material_reissue 的变更记录，
 * 清单取服务端提交时固化的 materialReissue.materials 快照；本页只读，不新增接口、字段或权限。
 * 申请单按 appliedAt 倒序；关键字可同时命中物料字段、任务、申请人、客户与补发类别。
 */

type MaterialReissueApplication = {
  id: string;
  appliedAt: string;
  appliedBy: string;
  stageKey: string | null;
  material: MaterialReissueSnapshot;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; applications: MaterialReissueApplication[] };

const PAGE_SIZE = 8;

/** 「补发追踪」「全部物料」暂只提供入口与占位，具体内容后续补充。 */
type MaterialReissueStubView = "tracking" | "all-materials";

function materialReissueApplicationOf(change: ApiChangeRequest): MaterialReissueApplication | null {
  if (change.changeType !== "material_reissue" || change.materialReissue === null) {
    return null;
  }
  return {
    id: change.id,
    appliedAt: change.appliedAt,
    appliedBy: change.appliedBy,
    stageKey: change.stageKey,
    material: change.materialReissue,
  };
}

function applicationTimeOf(application: MaterialReissueApplication): number {
  const time = Date.parse(application.appliedAt);
  return Number.isNaN(time) ? 0 : time;
}

function quantityText(value: number): string {
  return Number.isFinite(value) ? String(value) : "—";
}

function textOrDash(value: string): string {
  return value.trim() === "" ? "—" : value;
}

export function MaterialReissuePanel({ projectId, tasks, members, viewerId = null, canViewAll = false }: {
  projectId: string;
  tasks: readonly ProjectTask[];
  members: readonly Member[];
  /** 当前账号本库 users.id（与任务 ownerIds 同口径）；用于商务助理只看自己负责任务的申请单。 */
  viewerId?: string | null;
  /** 项目经理 / 系统管理员 / 全部项目仅浏览或编辑 = true；否则只保留 viewerId 负责任务的申请单。 */
  canViewAll?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadTick, setReloadTick] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [stubView, setStubView] = useState<MaterialReissueStubView | null>(null);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetchProjectChanges(projectId)
      .then((changes) => {
        if (!alive) {
          return;
        }
        const applications = changes
          .map(materialReissueApplicationOf)
          .filter((item): item is MaterialReissueApplication => item !== null)
          .sort((left, right) => applicationTimeOf(right) - applicationTimeOf(left));
        setState({ kind: "ready", applications });
      })
      .catch((error: unknown) => {
        if (!alive) {
          return;
        }
        const message =
          error instanceof ApiError && error.status === 403
            ? textOf(locale, "pd.material.loadForbidden")
            : error instanceof Error && error.message !== ""
              ? error.message
              : textOf(locale, "pd.material.loadFailed");
        setState({ kind: "error", message });
      });
    return () => {
      alive = false;
    };
  }, [projectId, reloadTick, locale]);

  useLiveRefresh(
    ["files", "tasks"],
    async () => {
      const changes = await fetchProjectChanges(projectId);
      const applications = changes
        .map(materialReissueApplicationOf)
        .filter((item): item is MaterialReissueApplication => item !== null)
        .sort((left, right) => applicationTimeOf(right) - applicationTimeOf(left));
      return () => {
        setState((previous) => (previous.kind === "ready" ? { kind: "ready", applications } : previous));
      };
    },
    projectId + ":" + String(reloadTick),
    state.kind === "ready",
    { readOnly: true },
  );

  useEffect(() => {
    setPage(1);
  }, [keyword, projectId]);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task] as const)), [tasks]);
  const applications = state.kind === "ready" ? state.applications : [];
  /** 页面数据范围：项目经理 / 管理员 / 全部项目范围可见全量；商务助理仅见自己负责任务的申请单。 */
  const visibleApplications = canViewAll
    ? applications
    : viewerId === null
      ? []
      : applications.filter((application) => {
          const task = taskById.get(application.material.taskId);
          return task !== undefined && task.ownerIds.includes(viewerId);
        });
  const normalizedKeyword = keyword.trim().toLocaleLowerCase(locale);

  const filteredApplications = visibleApplications.filter((application) => {
    if (normalizedKeyword === "") {
      return true;
    }
    const material = application.material;
    const task = taskById.get(material.taskId);
    const haystack = [
      material.taskTitle,
      task?.title ?? "",
      material.applicantName,
      material.customerName ?? "",
      materialReissueReasonText(locale, material),
      ...material.materials.flatMap((line) => [line.materialCode, line.materialName, line.specification, line.unit, line.remark]),
    ]
      .join("\n")
      .toLocaleLowerCase(locale);
    return haystack.includes(normalizedKeyword);
  });

  const totalPages = Math.max(1, Math.ceil(filteredApplications.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageApplications = filteredApplications.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const materialCount = filteredApplications.reduce((sum, application) => sum + application.material.materials.length, 0);
  const hasFilter = normalizedKeyword !== "";
  const detailApplication = detailId === null ? undefined : applications.find((application) => application.id === detailId);
  const detailTask = detailApplication === undefined ? undefined : taskById.get(detailApplication.material.taskId);

  return (
    <section data-project-material-reissue="" className="mx-auto w-full max-w-[1000px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-900">{t("pd.material.title")}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span data-project-material-reissue-summary="">
            {t("pd.material.summary", { applications: filteredApplications.length, items: materialCount })}
          </span>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
        <span data-project-material-reissue-filter="keyword" className="w-80 shrink-0">
          <SearchInput
            value={keyword}
            onChange={setKeyword}
            placeholder={t("pd.material.search")}
            className="w-full"
          />
        </span>
        {hasFilter ? (
          <button
            type="button"
            onClick={() => {
              setKeyword("");
            }}
            className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
          >
            {t("lib.clear")}
          </button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-1.5" role="group" aria-label={t("pd.material.tabsAria")}>
          {(["tracking", "all-materials"] as const).map((view) => {
            const active = stubView === view;
            return (
              <button
                key={view}
                type="button"
                data-material-reissue-view={view}
                aria-pressed={active}
                onClick={() => {
                  setStubView((previous) => (previous === view ? null : view));
                }}
                className={
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition " +
                  (active
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900")
                }
              >
                {view === "tracking" ? t("pd.material.tracking") : t("pd.material.allMaterials")}
              </button>
            );
          })}
        </div>
      </div>

      {state.kind === "loading" ? (
        <div className="flex justify-center rounded-xl border border-zinc-200 bg-white py-16">
          <Loader />
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{state.message}</span>
          <button
            type="button"
            onClick={() => {
              setReloadTick((tick) => tick + 1);
            }}
            className="ml-auto rounded-lg border border-rose-300 px-3 py-1 text-xs font-medium transition hover:bg-rose-100"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : null}

      {stubView === null ? null : (
        <div data-project-material-reissue-stub={stubView} className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
          <p className="text-sm font-semibold text-zinc-800">
            {stubView === "tracking" ? t("pd.material.tracking") : t("pd.material.allMaterials")}
          </p>
          <p className="mt-2 text-xs text-zinc-500">{t("pd.material.stubHint")}</p>
          <button
            type="button"
            onClick={() => {
              setStubView(null);
            }}
            className="mt-5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
          >
            {t("pd.material.backToList")}
          </button>
        </div>
      )}

      {stubView === null && state.kind === "ready" && filteredApplications.length === 0 ? (
        <div data-project-material-reissue-empty="" className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center text-sm text-zinc-500">
          {hasFilter ? t("pd.material.empty.filter") : t("pd.material.empty")}
        </div>
      ) : null}

      {stubView === null && state.kind === "ready" && pageApplications.length > 0 ? (
        <div className="space-y-4">
          {pageApplications.map((application) => {
            const material = application.material;
            const task = taskById.get(material.taskId);
            const taskTitle = material.taskTitle !== "" ? material.taskTitle : task?.title ?? "";
            return (
              <article
                key={application.id}
                data-material-reissue-application={application.id}
                className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
              >
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 bg-zinc-50/70 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                        {fieldText(locale, "物料变更补发")}
                      </span>
                      <h3 className="text-sm font-semibold text-zinc-900">
                        {taskTitle === "" ? t("pd.material.unassignedTask") : taskTitle}
                      </h3>
                    </div>
                    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>{t("pd.material.applicant")}：{textOrDash(material.applicantName)}</span>
                      <span>{t("pd.material.appliedAt")}：{formatDateTime(application.appliedAt)}</span>
                      <span>{fieldText(locale, "补发类别")}：{materialReissueReasonText(locale, material)}</span>
                      <span>{fieldText(locale, "客户名称")}：{textOrDash(material.customerName ?? "")}</span>
                      <span>{fieldText(locale, "要求出库时间")}：{textOrDash(material.requiredOutDate)}</span>
                      {application.stageKey === null ? null : (
                        <span>{fieldText(locale, "变更阶段")}：{stageLabelOf(locale, application.stageKey)}</span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailId(application.id);
                    }}
                    className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900"
                  >
                    {t("pd.material.viewDetail")}
                  </button>
                </header>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] table-fixed border-collapse text-xs">
                    <colgroup>
                      <col className="w-[56px]" />
                      <col className="w-[150px]" />
                      <col className="w-[190px]" />
                      <col className="w-[170px]" />
                      <col className="w-[76px]" />
                      <col className="w-[68px]" />
                      <col />
                    </colgroup>
                    <thead>
                      <tr className="bg-zinc-100 text-zinc-600">
                        <th scope="col" className="border border-zinc-300 px-2 py-2 text-center font-semibold">{t("header.seqNo")}</th>
                        <th scope="col" className="border border-zinc-300 px-2 py-2 text-center font-semibold">{fieldText(locale, "物料编码")}</th>
                        <th scope="col" className="border border-zinc-300 px-2 py-2 text-center font-semibold">{fieldText(locale, "物料名称")}</th>
                        <th scope="col" className="border border-zinc-300 px-2 py-2 text-center font-semibold">{fieldText(locale, "规格型号")}</th>
                        <th scope="col" className="border border-zinc-300 px-2 py-2 text-center font-semibold">{fieldText(locale, "数量")}</th>
                        <th scope="col" className="border border-zinc-300 px-2 py-2 text-center font-semibold">{fieldText(locale, "单位")}</th>
                        <th scope="col" className="border border-zinc-300 px-2 py-2 text-center font-semibold">{fieldText(locale, "备注")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {material.materials.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="border border-zinc-200 px-3 py-6 text-center text-zinc-400">—</td>
                        </tr>
                      ) : (
                        material.materials.map((line, index) => (
                          <tr key={String(index)} data-material-reissue-line={String(index + 1)} className="bg-white">
                            <td className="border border-zinc-200 px-2 py-2 text-center tabular-nums text-zinc-500">{index + 1}</td>
                            <td className="break-words border border-zinc-200 px-2 py-2 text-zinc-700">{textOrDash(line.materialCode)}</td>
                            <td className="break-words border border-zinc-200 px-2 py-2 font-medium text-zinc-800">{textOrDash(line.materialName)}</td>
                            <td className="break-words border border-zinc-200 px-2 py-2 text-zinc-700">{textOrDash(line.specification)}</td>
                            <td className="border border-zinc-200 px-2 py-2 text-right tabular-nums text-zinc-700">{quantityText(line.quantity)}</td>
                            <td className="border border-zinc-200 px-2 py-2 text-center text-zinc-700">{textOrDash(line.unit)}</td>
                            <td className="break-words border border-zinc-200 px-2 py-2 text-zinc-600">{textOrDash(line.remark)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50/50 px-4 py-2 text-[11px] text-zinc-500">
                  <span>{t("pd.material.items", { n: material.materials.length })}</span>
                </footer>
              </article>
            );
          })}
        </div>
      ) : null}

      {stubView === null && state.kind === "ready" && filteredApplications.length > 0 ? (
        <footer data-project-material-reissue-pagination="" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-xs text-zinc-500">
          <span>{t("pd.material.pageInfo", { total: filteredApplications.length, page: currentPage, pages: totalPages })}</span>
          <nav className="flex items-center gap-2" aria-label={t("pd.material.pagination")}>
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => {
                setPage((value) => Math.max(1, value - 1));
              }}
              className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-300"
            >
              {t("pd.material.pagePrev")}
            </button>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => {
                setPage((value) => Math.min(totalPages, value + 1));
              }}
              className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-300"
            >
              {t("pd.material.pageNext")}
            </button>
          </nav>
        </footer>
      ) : null}

      {detailId === null ? null : (
        <ChangeDetailModal
          changeId={detailId}
          linkedTaskTitle={detailApplication?.material.taskTitle ?? null}
          members={members}
          deliverableTypes={detailTask?.deliverableTypes ?? []}
          onClose={() => {
            setDetailId(null);
          }}
        />
      )}
    </section>
  );
}
