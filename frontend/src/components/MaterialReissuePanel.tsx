import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api";
import {
  createMaterialReissueTracking,
  ensurePreviewOutcome,
  fetchProjectChanges,
  recordPreviewView,
  uploadFile,
  type ApiChangeRequest,
  type MaterialReissueSnapshot,
  type MaterialReissueTrackingEntry,
  type MaterialReissueTrackingStatus,
} from "../fileApi";
import type { Member } from "../data/members";
import type { ProjectTask } from "../data/tasks";
import { fieldText, textOf, useLocale, useT } from "../i18n";
import { materialReissueReasonText } from "../materialReissue";
import { formatDateTime } from "../projectApi";
import { lockBodyScroll } from "../scrollLock";
import { useLiveRefresh } from "../useLiveRefresh";
import { ChangeDetailModal, stageLabelOf } from "./ChangeDetailModal";
import { Loader } from "./Loader";
import { DateRangePicker } from "./DateRangePicker";
import { SearchInput } from "./SearchInput";
import { SearchSelect } from "./SearchSelect";
import { Toast } from "./Toast";

/**
 * 项目详情「物料补发」标签（2026-11-25）。
 *
 * 业务口径：任务抽屉「变更申请 → 物料变更补发」里的《补发物料清单》不再只存在于单条变更详情中；
 * 项目详情在「项目文件」旁新增同级页面，按申请单汇总展示本项目全部物料补发清单。
 *
 * 页面结构：
 * - 全部补发（默认）：保留原申请单卡片 + 七列物料清单形式，每行前增加复选框，可跨申请单勾选后批量登记发货；
 * - 补发追踪：展示已登记发货 / 已签收的物料行。
 *
 * 数据面：GET /projects/{id}/change-requests 返回 materialReissue 快照 + materialReissueTracking；
 * 发货登记 POST /projects/{id}/change-requests/material-reissue/tracking 一次写多个申请单的物料行。
 * 本页不新增独立读接口。权限沿用标签访问范围：项目编辑者 / 任务负责人（商务助理）可登记发货。
 */

type MaterialReissueLine = MaterialReissueSnapshot["materials"][number];

type MaterialReissueApplication = {
  id: string;
  appliedAt: string;
  appliedBy: string;
  stageKey: string | null;
  material: MaterialReissueSnapshot;
  tracking: readonly MaterialReissueTrackingEntry[];
};

type MaterialReissueView = "all" | "tracking";

type AllMaterialRow = {
  key: string;
  application: MaterialReissueApplication;
  lineIndex: number;
  line: MaterialReissueLine;
  tracking: MaterialReissueTrackingEntry | null;
  task: ProjectTask | undefined;
  canSelect: boolean;
};

type TrackingRow = {
  key: string;
  application: MaterialReissueApplication;
  lineIndex: number;
  line: MaterialReissueLine;
  entry: MaterialReissueTrackingEntry;
  task: ProjectTask | undefined;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; applications: MaterialReissueApplication[] };

type Notice = { kind: "ok" | "error" | "info"; text: string };

const PAGE_SIZE = 8;
const TRACKING_PAGE_SIZE = 20;
const MAX_SHIPMENT_ITEMS = 200;
const FIELD_CLASS = "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const LABEL_CLASS = "block text-xs font-medium text-zinc-600";

function trackingKey(changeRequestId: string, lineIndex: number): string {
  return changeRequestId + ":" + String(lineIndex);
}

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
    tracking: change.materialReissueTracking ?? [],
  };
}

function applicationTimeOf(application: MaterialReissueApplication): number {
  const time = Date.parse(application.appliedAt);
  return Number.isNaN(time) ? 0 : time;
}

function trackingTimeOf(entry: MaterialReissueTrackingEntry): number {
  const time = Date.parse(entry.shippedAt);
  return Number.isNaN(time) ? 0 : time;
}

function quantityText(value: number): string {
  return Number.isFinite(value) ? String(value) : "—";
}

function textOrDash(value: string | null): string {
  return value === null || value.trim() === "" ? "—" : value;
}

function statusBadgeClass(status: MaterialReissueTrackingStatus): string {
  return status === "received" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700";
}

export function MaterialReissuePanel({
  projectId,
  tasks,
  members,
  viewerId = null,
  canViewAll = false,
  canMark = false,
  canMarkAll = false,
}: {
  projectId: string;
  tasks: readonly ProjectTask[];
  members: readonly Member[];
  /** 当前账号本库 users.id（与任务 ownerIds 同口径）；用于商务助理只看自己负责任务的申请单。 */
  viewerId?: string | null;
  /** 项目经理 / 系统管理员 / 全部项目仅浏览或编辑 = true；否则只保留 viewerId 负责任务的申请单。 */
  canViewAll?: boolean;
  /** 是否可登记发货（项目编辑者或任务负责人）。 */
  canMark?: boolean;
  /** 是否可对本项目全部物料行登记发货；false = 只能选择本人负责任务的行。 */
  canMarkAll?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadTick, setReloadTick] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [trackingPage, setTrackingPage] = useState(1);
  const [activeView, setActiveView] = useState<MaterialReissueView>("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [shipmentOpen, setShipmentOpen] = useState(false);
  const [shipmentStatus, setShipmentStatus] = useState<MaterialReissueTrackingStatus>("shipped");
  const [shipmentTrackingNo, setShipmentTrackingNo] = useState("");
  const [shipmentEta, setShipmentEta] = useState("");
  const [shipmentNote, setShipmentNote] = useState("");
  const [shipmentImage, setShipmentImage] = useState<File | null>(null);
  const [shipmentImageUrl, setShipmentImageUrl] = useState<string | null>(null);
  const [shipmentBusy, setShipmentBusy] = useState(false);
  const [shipmentError, setShipmentError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [previewBusyKey, setPreviewBusyKey] = useState<string | null>(null);
  const pasteSinkRef = useRef<HTMLInputElement | null>(null);

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
    setTrackingPage(1);
  }, [keyword, projectId]);

  useEffect(() => {
    if (activeView === "all") {
      return;
    }
    setSelectedKeys(new Set());
    setShipmentOpen(false);
    setShipmentError(null);
  }, [activeView]);

  useEffect(() => {
    if (shipmentImage === null) {
      setShipmentImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(shipmentImage);
    setShipmentImageUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [shipmentImage]);

  useEffect(() => {
    if (!shipmentOpen && previewImage === null) {
      return;
    }
    return lockBodyScroll();
  }, [shipmentOpen, previewImage]);

  /** 发货登记弹窗打开时，Ctrl+V 粘贴剪贴板图片（与日报填写同一交互习惯）。 */
  useEffect(() => {
    if (!shipmentOpen) {
      return;
    }
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      const image = files.find((file) => file.type.startsWith("image/"));
      if (image === undefined) {
        return;
      }
      event.preventDefault();
      setShipmentImage(image);
      setShipmentError(null);
    };
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("paste", onPaste);
    };
  }, [shipmentOpen]);

  useEffect(() => {
    if (!shipmentOpen && previewImage === null) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.stopPropagation();
      if (previewImage !== null) {
        setPreviewImage(null);
      } else if (!shipmentBusy) {
        setShipmentOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, [shipmentOpen, previewImage, shipmentBusy]);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task] as const)), [tasks]);
  const applications = state.kind === "ready" ? state.applications : [];
  const visibleApplications = canViewAll
    ? applications
    : viewerId === null
      ? []
      : applications.filter((application) => {
          const task = taskById.get(application.material.taskId);
          return task !== undefined && task.ownerIds.includes(viewerId);
        });

  const trackingMap = useMemo(() => {
    const map = new Map<string, MaterialReissueTrackingEntry>();
    for (const application of visibleApplications) {
      for (const entry of application.tracking) {
        map.set(trackingKey(application.id, entry.lineIndex), entry);
      }
    }
    return map;
  }, [visibleApplications]);

  const allRows = useMemo<AllMaterialRow[]>(() => {
    const rows: AllMaterialRow[] = [];
    for (const application of visibleApplications) {
      const task = taskById.get(application.material.taskId);
      application.material.materials.forEach((line, lineIndex) => {
        const key = trackingKey(application.id, lineIndex);
        const tracking = trackingMap.get(key) ?? null;
        const ownsTask = viewerId !== null && task !== undefined && task.ownerIds.includes(viewerId);
        rows.push({
          key,
          application,
          lineIndex,
          line,
          tracking,
          task,
          canSelect: canMark && tracking === null && (canMarkAll || ownsTask),
        });
      });
    }
    return rows;
  }, [visibleApplications, taskById, trackingMap, viewerId, canMark, canMarkAll]);

  const trackingRows = useMemo<TrackingRow[]>(() => {
    const rows: TrackingRow[] = [];
    for (const row of allRows) {
      if (row.tracking === null) {
        continue;
      }
      rows.push({
        key: row.key,
        application: row.application,
        lineIndex: row.lineIndex,
        line: row.line,
        entry: row.tracking,
        task: row.task,
      });
    }
    return rows.sort((left, right) => trackingTimeOf(right.entry) - trackingTimeOf(left.entry));
  }, [allRows]);

  useEffect(() => {
    if (selectedKeys.size === 0) {
      return;
    }
    const available = new Set(allRows.filter((row) => row.canSelect).map((row) => row.key));
    setSelectedKeys((previous) => {
      let changed = false;
      const next = new Set<string>();
      for (const key of previous) {
        if (available.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [allRows, selectedKeys.size]);

  const normalizedKeyword = keyword.trim().toLocaleLowerCase(locale);
  const matchText = (parts: readonly (string | null | undefined)[]): boolean => {
    if (normalizedKeyword === "") {
      return true;
    }
    return parts
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join("\n")
      .toLocaleLowerCase(locale)
      .includes(normalizedKeyword);
  };
  const applicationParts = (application: MaterialReissueApplication): string[] => [
    application.material.taskTitle,
    application.material.applicantName,
    application.material.customerName ?? "",
    materialReissueReasonText(locale, application.material),
    ...application.material.materials.flatMap((line) => [line.materialCode, line.materialName, line.specification, line.unit, line.remark]),
  ];
  const rowParts = (row: AllMaterialRow | TrackingRow): string[] => [
    ...applicationParts(row.application),
    row.line.materialCode,
    row.line.materialName,
    row.line.specification,
    row.line.unit,
    row.line.remark,
  ];
  const statusLabel = (status: MaterialReissueTrackingStatus): string =>
    status === "received" ? t("pd.material.status.received") : t("pd.material.status.shipped");

  const filteredApplications = visibleApplications.filter((application) => matchText(applicationParts(application)));
  const filteredTrackingRows = trackingRows.filter((row) =>
    matchText([
      ...rowParts(row),
      statusLabel(row.entry.status),
      row.entry.trackingNo ?? "",
      row.entry.note ?? "",
    ]),
  );

  const totalPages = Math.max(1, Math.ceil(filteredApplications.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageApplications = filteredApplications.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const pageApplicationIds = new Set(pageApplications.map((application) => application.id));
  const selectablePageRows = allRows.filter((row) => pageApplicationIds.has(row.application.id) && row.canSelect);
  const selectablePageKeys = selectablePageRows.map((row) => row.key);
  const selectedOnPage = selectablePageKeys.filter((key) => selectedKeys.has(key)).length;
  const allPageSelected = selectablePageKeys.length > 0 && selectedOnPage === selectablePageKeys.length;
  const selectedRows = allRows.filter((row) => row.canSelect && row.tracking === null && selectedKeys.has(row.key));
  const allRowByKey = new Map(allRows.map((row) => [row.key, row] as const));

  const totalTrackingPages = Math.max(1, Math.ceil(filteredTrackingRows.length / TRACKING_PAGE_SIZE));
  const currentTrackingPage = Math.min(trackingPage, totalTrackingPages);
  const trackingPageRows = filteredTrackingRows.slice(
    (currentTrackingPage - 1) * TRACKING_PAGE_SIZE,
    currentTrackingPage * TRACKING_PAGE_SIZE,
  );

  const hasFilter = normalizedKeyword !== "";
  const allShippedCount = allRows.filter((row) => row.tracking !== null).length;
  const summaryText =
    activeView === "all"
      ? t("pd.material.allSummary", { total: allRows.length, shipped: allShippedCount })
      : t("pd.material.trackingSummary", { n: filteredTrackingRows.length });

  const detailApplication = detailId === null ? undefined : applications.find((application) => application.id === detailId);
  const detailTask = detailApplication === undefined ? undefined : taskById.get(detailApplication.material.taskId);

  const toggleRowSelection = (row: AllMaterialRow): void => {
    if (!row.canSelect) {
      return;
    }
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(row.key)) {
        next.delete(row.key);
        return next;
      }
      if (next.size >= MAX_SHIPMENT_ITEMS) {
        setNotice({ kind: "info", text: t("pd.material.selectionLimit", { n: MAX_SHIPMENT_ITEMS }) });
        return previous;
      }
      next.add(row.key);
      return next;
    });
  };

  const togglePageSelection = (): void => {
    if (selectablePageKeys.length === 0) {
      return;
    }
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (allPageSelected) {
        for (const key of selectablePageKeys) {
          next.delete(key);
        }
        return next;
      }
      const slots = Math.max(0, MAX_SHIPMENT_ITEMS - next.size);
      if (slots === 0) {
        setNotice({ kind: "info", text: t("pd.material.selectionLimit", { n: MAX_SHIPMENT_ITEMS }) });
        return previous;
      }
      if (selectablePageKeys.length > slots) {
        setNotice({ kind: "info", text: t("pd.material.selectionLimit", { n: MAX_SHIPMENT_ITEMS }) });
      }
      for (const key of selectablePageKeys.slice(0, slots)) {
        next.add(key);
      }
      return next;
    });
  };

  const resetShipmentForm = (): void => {
    setShipmentStatus("shipped");
    setShipmentTrackingNo("");
    setShipmentEta("");
    setShipmentNote("");
    setShipmentImage(null);
    setShipmentError(null);
  };

  const openShipment = (): void => {
    if (!canMark) {
      setNotice({ kind: "info", text: t("pd.material.onlyView") });
      return;
    }
    if (selectedRows.length === 0) {
      setNotice({ kind: "info", text: t("pd.material.noSelection") });
      return;
    }
    resetShipmentForm();
    setShipmentOpen(true);
  };

  const closeShipment = (): void => {
    if (shipmentBusy) {
      return;
    }
    setShipmentOpen(false);
    setShipmentError(null);
  };

  const submitShipment = async (): Promise<void> => {
    if (shipmentBusy) {
      return;
    }
    if (selectedRows.length === 0) {
      setShipmentError(t("pd.material.noSelection"));
      return;
    }
    setShipmentBusy(true);
    setShipmentError(null);
    try {
      let imageFileId: string | undefined;
      if (shipmentImage !== null) {
        const taskId = canMarkAll ? undefined : selectedRows[0]?.application.material.taskId;
        imageFileId = await uploadFile(projectId, shipmentImage, shipmentImage.name, taskId === undefined ? {} : { taskId });
      }
      await createMaterialReissueTracking(projectId, {
        items: selectedRows.map((row) => ({ changeRequestId: row.application.id, lineIndex: row.lineIndex })),
        status: shipmentStatus,
        trackingNo: shipmentTrackingNo.trim() === "" ? undefined : shipmentTrackingNo.trim(),
        estimatedArrivalDate: shipmentEta === "" ? undefined : shipmentEta,
        note: shipmentNote.trim() === "" ? undefined : shipmentNote.trim(),
        imageFileId,
      });
      const count = selectedRows.length;
      setShipmentOpen(false);
      setSelectedKeys(new Set());
      resetShipmentForm();
      setActiveView("tracking");
      setTrackingPage(1);
      setNotice({ kind: "ok", text: t("pd.material.shipmentSuccess", { n: count }) });
      setReloadTick((tick) => tick + 1);
    } catch (error) {
      setShipmentError(
        error instanceof Error && error.message !== "" ? error.message : t("pd.material.shipmentFailed"),
      );
    } finally {
      setShipmentBusy(false);
    }
  };

  const openTrackingImage = async (row: TrackingRow): Promise<void> => {
    if (row.entry.imageFileId === null || previewBusyKey !== null) {
      return;
    }
    setPreviewBusyKey(row.key);
    const outcome = await ensurePreviewOutcome(row.entry.imageFileId);
    setPreviewBusyKey(null);
    if (outcome.kind === "unavailable" || outcome.kind === "viewer") {
      setNotice({ kind: "error", text: outcome.kind === "unavailable" ? outcome.reason ?? t("pd.material.imageUnavailable") : t("pd.material.imageUnavailable") });
      return;
    }
    void recordPreviewView(row.entry.imageFileId);
    setPreviewImage({ url: outcome.url, name: t("pd.material.imageAlt") });
  };

  const pager = (total: number, current: number, pages: number, onPage: (page: number) => void) => (
    <footer
      data-project-material-reissue-pagination=""
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-xs text-zinc-500"
    >
      <span>{t("pd.material.pageInfo", { total, page: current, pages })}</span>
      <nav className="flex items-center gap-2" aria-label={t("pd.material.pagination")}>
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => {
            onPage(current - 1);
          }}
          className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-300"
        >
          {t("pd.material.pagePrev")}
        </button>
        <button
          type="button"
          disabled={current >= pages}
          onClick={() => {
            onPage(current + 1);
          }}
          className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-300"
        >
          {t("pd.material.pageNext")}
        </button>
      </nav>
    </footer>
  );

  return (
    <section data-project-material-reissue="" className={"mx-auto w-full space-y-4 " + (activeView === "tracking" ? "max-w-[1320px]" : "max-w-[1000px]")}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-900">{t("pd.material.title")}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span data-project-material-reissue-summary="">{summaryText}</span>
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
          {(["tracking", "all"] as const).map((view) => {
            const active = activeView === view;
            return (
              <button
                key={view}
                type="button"
                data-material-reissue-view={view}
                aria-pressed={active}
                onClick={() => {
                  setActiveView(view);
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

      {state.kind === "ready" && activeView === "all" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span data-project-material-reissue-selected={selectedRows.length}>{t("pd.material.selectedCount", { n: selectedRows.length })}</span>
              <span>{t("pd.material.batchHint")}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={selectablePageRows.length === 0}
                onClick={togglePageSelection}
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-300"
              >
                {allPageSelected ? t("pd.material.unselectAllPage") : t("pd.material.selectAllPage")}
              </button>
              <button
                type="button"
                disabled={selectedRows.length === 0}
                onClick={() => {
                  setSelectedKeys(new Set());
                }}
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-300"
              >
                {t("pd.material.clearSelection")}
              </button>
              <button
                type="button"
                data-material-reissue-mark-shipped="true"
                disabled={!canMark || selectedRows.length === 0}
                onClick={openShipment}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
              >
                {t("pd.material.markShipped")}
              </button>
            </div>
          </div>

          {!canMark ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("pd.material.onlyView")}</p>
          ) : null}

          {filteredApplications.length === 0 ? (
            <div data-project-material-reissue-empty="" className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center text-sm text-zinc-500">
              {hasFilter ? t("pd.material.empty.filter") : t("pd.material.empty")}
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {pageApplications.map((application) => {
                  const material = application.material;
                  const taskTitle = material.taskTitle !== "" ? material.taskTitle : application.material.taskId;
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
                            <h3 className="text-sm font-semibold text-zinc-900">{taskTitle}</h3>
                          </div>
                          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                            <span>{t("pd.material.applicant")}：{textOrDash(material.applicantName)}</span>
                            <span>{t("pd.material.appliedAt")}：{formatDateTime(application.appliedAt)}</span>
                            <span>{fieldText(locale, "补发类别")}：{materialReissueReasonText(locale, material)}</span>
                            <span>{fieldText(locale, "客户名称")}：{textOrDash(material.customerName)}</span>
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
                        <table className="w-full min-w-[904px] table-fixed border-collapse text-xs">
                          <colgroup>
                            <col className="w-[44px]" />
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
                              <th scope="col" className="border border-zinc-300 px-2 py-2 text-center font-semibold">
                                <span className="sr-only">{t("pd.material.selectAllPage")}</span>
                              </th>
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
                                <td colSpan={8} className="border border-zinc-200 px-3 py-6 text-center text-zinc-400">—</td>
                              </tr>
                            ) : (
                              material.materials.map((line, index) => {
                                const row = allRowByKey.get(trackingKey(application.id, index));
                                const tracked = row?.tracking !== null && row?.tracking !== undefined;
                                return (
                                  <tr
                                    key={row?.key ?? String(index)}
                                    data-material-reissue-line={String(index + 1)}
                                    className={tracked ? "bg-zinc-50/40 text-zinc-400" : "bg-white text-blue-600"}
                                  >
                                    <td className="border border-zinc-200 px-2 py-2 text-center align-middle">
                                      <input
                                        type="checkbox"
                                        checked={row !== undefined && selectedKeys.has(row.key)}
                                        disabled={row === undefined || !row.canSelect}
                                        aria-label={line.materialName}
                                        onChange={() => {
                                          if (row !== undefined) {
                                            toggleRowSelection(row);
                                          }
                                        }}
                                        className="h-4 w-4 cursor-pointer rounded border-zinc-300 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                                      />
                                    </td>
                                    <td className="border border-zinc-200 px-2 py-2 text-center align-middle tabular-nums">{index + 1}</td>
                                    <td className="break-words border border-zinc-200 px-2 py-2 align-middle">{textOrDash(line.materialCode)}</td>
                                    <td className="break-words border border-zinc-200 px-2 py-2 align-middle font-medium">{textOrDash(line.materialName)}</td>
                                    <td className="break-words border border-zinc-200 px-2 py-2 align-middle">{textOrDash(line.specification)}</td>
                                    <td className="border border-zinc-200 px-2 py-2 text-right align-middle tabular-nums">{quantityText(line.quantity)}</td>
                                    <td className="border border-zinc-200 px-2 py-2 text-center align-middle">{textOrDash(line.unit)}</td>
                                    <td className="break-words border border-zinc-200 px-2 py-2 align-middle">{textOrDash(line.remark)}</td>
                                  </tr>
                                );
                              })
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
              {pager(filteredApplications.length, currentPage, totalPages, setPage)}
            </>
          )}
        </>
      ) : null}

      {state.kind === "ready" && activeView === "tracking" ? (
        filteredTrackingRows.length === 0 ? (
          <div data-project-material-reissue-tracking-empty="" className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center text-sm text-zinc-500">
            {hasFilter ? t("pd.material.trackingEmpty.filter") : t("pd.material.trackingEmpty")}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
              <table className="w-full min-w-[1180px] table-fixed border-collapse text-xs">
                <colgroup>
                  <col className="w-[180px]" />
                  <col className="w-[140px]" />
                  <col className="w-[80px]" />
                  <col className="w-[120px]" />
                  <col className="w-[110px]" />
                  <col className="w-[180px]" />
                  <col className="w-[90px]" />
                  <col className="w-[90px]" />
                  <col />
                </colgroup>
                <thead className="bg-zinc-50 text-zinc-500">
                  <tr>
                    <th className="whitespace-nowrap border-b border-zinc-200 px-3 py-3 text-left font-medium">{fieldText(locale, "物料名称")}</th>
                    <th className="whitespace-nowrap border-b border-zinc-200 px-3 py-3 text-left font-medium">{fieldText(locale, "规格型号")}</th>
                    <th className="whitespace-nowrap border-b border-zinc-200 px-3 py-3 text-right font-medium">{fieldText(locale, "数量")}</th>
                    <th className="whitespace-nowrap border-b border-zinc-200 px-3 py-3 text-left font-medium">{t("pd.material.col.trackingNo")}</th>
                    <th className="whitespace-nowrap border-b border-zinc-200 px-3 py-3 text-left font-medium">{t("pd.material.col.eta")}</th>
                    <th className="whitespace-nowrap border-b border-zinc-200 px-3 py-3 text-left font-medium">{t("pd.material.col.shipNote")}</th>
                    <th className="whitespace-nowrap border-b border-zinc-200 px-3 py-3 text-center font-medium">{t("pd.material.col.status")}</th>
                    <th className="whitespace-nowrap border-b border-zinc-200 px-3 py-3 text-center font-medium">{t("pd.material.col.image")}</th>
                    <th className="whitespace-nowrap border-b border-zinc-200 px-3 py-3 text-left font-medium">{t("pd.material.col.source")}</th>
                  </tr>
                </thead>
                <tbody>
                  {trackingPageRows.map((row) => {
                    const sourceTitle = row.application.material.taskTitle !== "" ? row.application.material.taskTitle : row.task?.title ?? "—";
                    return (
                      <tr key={row.key} data-material-reissue-tracking-row={row.key} className="border-b border-zinc-100 last:border-b-0">
                        <td className="px-3 py-2 align-middle">
                          <div className="font-medium text-zinc-800">{textOrDash(row.line.materialName)}</div>
                          <div className="mt-0.5 text-[11px] text-zinc-400">{textOrDash(row.line.materialCode)}</div>
                        </td>
                        <td className="break-words px-3 py-2 align-middle text-zinc-700">{textOrDash(row.line.specification)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums text-zinc-700">{quantityText(row.line.quantity)} {textOrDash(row.line.unit)}</td>
                        <td className="break-words px-3 py-2 align-middle text-zinc-700">{textOrDash(row.entry.trackingNo)}</td>
                        <td className="whitespace-nowrap px-3 py-2 align-middle text-zinc-700">{row.entry.estimatedArrivalDate === null ? "—" : row.entry.estimatedArrivalDate.replace(/-/g, "/")}</td>
                        <td className="break-words px-3 py-2 align-middle text-zinc-600">{textOrDash(row.entry.note)}</td>
                        <td className="px-3 py-2 text-center align-middle">
                          <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + statusBadgeClass(row.entry.status)}>
                            {statusLabel(row.entry.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center align-middle">
                          {row.entry.imageFileId === null ? (
                            <span className="text-zinc-400">—</span>
                          ) : (
                            <button
                              type="button"
                              disabled={previewBusyKey !== null}
                              onClick={() => {
                                void openTrackingImage(row);
                              }}
                              className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {previewBusyKey === row.key ? t("common.loading") : t("pd.material.viewImage")}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 align-middle text-zinc-600">
                          <div>{sourceTitle}</div>
                          <div className="mt-0.5 text-[11px] text-zinc-400">{formatDateTime(row.application.appliedAt)} · {row.application.material.applicantName}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pager(filteredTrackingRows.length, currentTrackingPage, totalTrackingPages, setTrackingPage)}
          </>
        )
      ) : null}

      {notice === null ? null : (
        <Toast
          kind={notice.kind}
          text={notice.text}
          onClose={() => {
            setNotice(null);
          }}
          anchor={{ name: "data-material-reissue-notice", value: notice.kind }}
        />
      )}

      {shipmentOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("pd.material.shipmentTitle")}
          onClick={closeShipment}
        >
          <div
            className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-2xl bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-zinc-900">{t("pd.material.shipmentTitle")}</h3>
                <p className="mt-1 text-xs text-zinc-500">{t("pd.material.selectedCount", { n: selectedRows.length })}</p>
              </div>
              <button
                type="button"
                disabled={shipmentBusy}
                onClick={closeShipment}
                className="rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40"
              >
                {t("pd.material.close")}
              </button>
            </header>

            <div className="mt-4 space-y-3">
              <div>
                <div className={LABEL_CLASS}>{t("pd.material.shipmentImage")}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={shipmentBusy}
                    onClick={() => {
                      pasteSinkRef.current?.focus();
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                      <rect x="5" y="4" width="14" height="17" rx="2" />
                      <path d="M9 4.5h6v3H9zM8.5 11h7M8.5 15h7" />
                    </svg>
                    {t("pd.material.pasteImage")}
                  </button>
                  <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">
                    {t("pd.material.chooseImage")}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={shipmentBusy}
                      onChange={(event) => {
                        setShipmentImage(event.target.files?.[0] ?? null);
                        setShipmentError(null);
                      }}
                      className="sr-only"
                    />
                  </label>
                  <input
                    ref={pasteSinkRef}
                    value=""
                    onChange={() => {}}
                    tabIndex={-1}
                    aria-label={t("pd.material.pasteImage")}
                    className="pointer-events-none absolute h-px w-px opacity-0"
                  />
                </div>
                {shipmentImageUrl === null ? null : (
                  <div className="mt-2 flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                    <img src={shipmentImageUrl} alt={t("pd.material.imageAlt")} className="max-h-28 max-w-[180px] rounded object-contain" />
                    <button
                      type="button"
                      disabled={shipmentBusy}
                      onClick={() => {
                        setShipmentImage(null);
                      }}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-white disabled:opacity-40"
                    >
                      {t("pd.material.removeImage")}
                    </button>
                  </div>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className={LABEL_CLASS}>{t("pd.material.shipmentStatus")}</div>
                  <div className="mt-1">
                    <SearchSelect
                      mode="single"
                      ariaLabel={t("pd.material.shipmentStatus")}
                      value={shipmentStatus}
                      options={[
                        { value: "shipped", label: t("pd.material.status.shipped") },
                        { value: "received", label: t("pd.material.status.received") },
                      ]}
                      onChange={(value) => {
                        setShipmentStatus(value === "received" ? "received" : "shipped");
                      }}
                      placeholder={t("pd.material.shipmentStatus")}
                      searchPlaceholder={t("lib.filter.status.search")}
                      disabled={shipmentBusy}
                      menuZClass="z-[90]"
                    />
                  </div>
                </div>
                <div>
                  <div className={LABEL_CLASS}>{t("pd.material.shipmentEta")}</div>
                  <div className={"mt-1 " + (shipmentBusy ? "pointer-events-none opacity-50" : "")}>
                    <DateRangePicker
                      mode="single"
                      value={shipmentEta === "" ? null : { from: shipmentEta, to: shipmentEta }}
                      onChange={(range) => {
                        setShipmentEta(range === null ? "" : range.from);
                      }}
                      placeholder={t("pd.material.shipmentEta")}
                      ariaLabel={t("pd.material.shipmentEta")}
                      popoverZClass="z-[90]"
                    />
                  </div>
                </div>
              </div>
              <label className={LABEL_CLASS}>
                {t("pd.material.shipmentTrackingNo")}
                <input
                  value={shipmentTrackingNo}
                  maxLength={120}
                  disabled={shipmentBusy}
                  onChange={(event) => {
                    setShipmentTrackingNo(event.target.value);
                  }}
                  className={FIELD_CLASS + " mt-1"}
                />
              </label>
              <label className={LABEL_CLASS}>
                {t("pd.material.shipmentNote")}
                <textarea
                  value={shipmentNote}
                  rows={3}
                  maxLength={1000}
                  disabled={shipmentBusy}
                  onChange={(event) => {
                    setShipmentNote(event.target.value);
                  }}
                  className={FIELD_CLASS + " mt-1 resize-y"}
                />
              </label>
              {shipmentError === null ? null : (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{shipmentError}</p>
              )}
            </div>

            <footer className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={shipmentBusy}
                onClick={closeShipment}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-40"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={shipmentBusy || selectedRows.length === 0}
                onClick={() => {
                  void submitShipment();
                }}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
              >
                {shipmentBusy ? t("pd.material.shipmentSubmitting") : t("pd.material.shipmentSubmit")}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {previewImage === null ? null : (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-zinc-900/70 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={previewImage.name}
          onClick={() => {
            setPreviewImage(null);
          }}
        >
          <button
            type="button"
            onClick={() => {
              setPreviewImage(null);
            }}
            className="absolute right-5 top-5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow transition hover:bg-white"
          >
            {t("pd.material.close")}
          </button>
          <img
            src={previewImage.url}
            alt={previewImage.name}
            onClick={(event) => {
              event.stopPropagation();
            }}
            className="max-h-[86vh] max-w-[92vw] rounded-xl bg-white object-contain shadow-2xl"
          />
        </div>
      )}

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
