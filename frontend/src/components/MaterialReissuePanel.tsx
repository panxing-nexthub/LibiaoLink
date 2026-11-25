import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ApiError } from "../api";
import { mediumCardBorderOf, mediumCardTintOf, vividCardBorderOf, vividCardTintOf, type TintedTier } from "../backgroundTier";
import {
  createMaterialReissueTracking,
  fetchProjectChanges,
  updateMaterialReissueTracking,
  uploadFile,
  type ApiChangeRequest,
  type MaterialReissueSnapshot,
  type MaterialReissueTrackingEntry,
  type MaterialReissueTrackingStatus,
  type UpdateMaterialReissueTrackingInput,
} from "../fileApi";
import type { Member } from "../data/members";
import type { ProjectTask } from "../data/tasks";
import { fieldText, textOf, useLocale, useT } from "../i18n";
import { materialReissueReasonText } from "../materialReissue";
import { formatDateTime } from "../projectApi";
import { lockBodyScroll } from "../scrollLock";
import { useLiveRefresh } from "../useLiveRefresh";
import { ChangeDetailModal, stageLabelOf } from "./ChangeDetailModal";
import { PhotoStrip } from "./ReportIssuePanel";
import type { ReportPhoto } from "../data/reports";
import { Loader } from "./Loader";
import { DateRangePicker } from "./DateRangePicker";
import { SearchInput } from "./SearchInput";
import { SearchSelect } from "./SearchSelect";
import { InlineDateCell, InlineOptionCell, InlineTextCell } from "./InlineEdit";
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

type MaterialRowStatus = MaterialReissueTrackingStatus | "pending";

/** 补发追踪 / 全部补发的行铺色色相：未发货蓝、已发货绿、已签收天蓝。 */
const MATERIAL_ROW_TINT_BASE: Record<MaterialRowStatus, string> = {
  pending: "#3b82f6",
  shipped: "#10b981",
  received: "#0ea5e9",
};

/** 按背景档位取行底色 / 悬停色（适中 / 炫彩）。 */
function materialRowTintOf(tier: TintedTier, status: MaterialRowStatus): { tint: string; hover: string } {
  const base = MATERIAL_ROW_TINT_BASE[status];
  return tier === "vivid"
    ? { tint: vividCardTintOf(base) ?? "", hover: vividCardBorderOf(base) ?? "" }
    : { tint: mediumCardTintOf(base) ?? "", hover: mediumCardBorderOf(base) ?? "" };
}

/** 铺色档下状态字色（行底色已承载颜色，徽标撤底只留深色字）。 */
function materialStatusTextClass(status: MaterialRowStatus): string {
  return status === "pending" ? "text-blue-800" : status === "received" ? "text-sky-800" : "text-emerald-800";
}

type GalleryImage = { url: string; name: string };

/** 发货凭证多图预览（上一张 / 下一张 / 关闭）。 */
function ImageGalleryOverlay({ images, index, onChange, onClose }: {
  images: readonly GalleryImage[];
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const current = images[index];
  if (current === undefined) {
    return null;
  }
  return (
    <div
      data-image-gallery=""
      className="fixed inset-0 z-[95] flex items-center justify-center bg-zinc-900/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow transition hover:bg-white"
      >
        {t("pd.material.close")}
      </button>
      {images.length <= 1 ? null : (
        <button
          type="button"
          aria-label={t("pd.material.pagePrev")}
          onClick={(event) => {
            event.stopPropagation();
            onChange((index - 1 + images.length) % images.length);
          }}
          className="absolute left-5 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-2xl leading-none text-zinc-700 shadow transition hover:bg-white"
        >
          ‹
        </button>
      )}
      <img
        src={current.url}
        alt={current.name}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="max-h-[86vh] max-w-[92vw] rounded-xl bg-white object-contain shadow-2xl"
      />
      {images.length <= 1 ? null : (
        <>
          <button
            type="button"
            aria-label={t("pd.material.pageNext")}
            onClick={(event) => {
              event.stopPropagation();
              onChange((index + 1) % images.length);
            }}
            className="absolute right-5 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-2xl leading-none text-zinc-700 shadow transition hover:bg-white"
          >
            ›
          </button>
          <span className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-zinc-700 shadow">
            {index + 1} / {images.length}
          </span>
        </>
      )}
    </div>
  );
}

/** 直接读取剪贴板中的全部图片（HTTPS + 用户点击手势下可用）；不支持或无图返回空数组。 */
async function readClipboardImageFiles(): Promise<File[]> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.read !== "function") {
    return [];
  }
  const items = await clipboard.read();
  const files: File[] = [];
  for (const item of items) {
    for (const type of item.types) {
      if (!type.startsWith("image/")) {
        continue;
      }
      const blob = await item.getType(type);
      const extension = type.split("/")[1]?.split("+")[0] ?? "png";
      files.push(new File([blob], "clipboard-" + String(Date.now()) + "-" + String(files.length + 1) + "." + extension, { type }));
    }
  }
  return files;
}

/** 兼容旧记录：优先多图数组，没有时回落单图字段。 */
function imageIdsOf(entry: MaterialReissueTrackingEntry): string[] {
  const ids = entry.imageFileIds ?? [];
  return ids.length > 0 ? [...ids] : entry.imageFileId === null ? [] : [entry.imageFileId];
}

type TrackingMergeKey = "trackingNo" | "eta" | "note" | "status" | "images" | "source";

function trackingMergeValueOf(row: TrackingRow, key: TrackingMergeKey): string {
  const batch = row.entry.shippedAt;
  switch (key) {
    case "trackingNo":
      return batch + "|" + (row.entry.trackingNo ?? "");
    case "eta":
      return batch + "|" + (row.entry.estimatedArrivalDate ?? "");
    case "note":
      return batch + "|" + (row.entry.note ?? "");
    case "status":
      return batch + "|" + row.entry.status;
    case "images":
      return batch + "|" + imageIdsOf(row.entry).join(",");
    case "source":
      return batch + "|" + row.application.id;
  }
}

/** 计算某一列的合并行跨度：0 = 被上一行 rowSpan 覆盖，非 0 = 本行是合并块起点（值 = 跨度）。 */
function trackingSpansOf(rows: readonly TrackingRow[], key: TrackingMergeKey): number[] {
  const spans = rows.map(() => 0);
  let start = 0;
  while (start < rows.length) {
    const value = trackingMergeValueOf(rows[start], key);
    let end = start + 1;
    while (end < rows.length && trackingMergeValueOf(rows[end], key) === value) {
      end += 1;
    }
    spans[start] = end - start;
    start = end;
  }
  return spans;
}

/** 补发批次（按 shippedAt）的行跨度与顺序编号：NO.1 / NO.2 …，每批只在首行出一个合并格。 */
function trackingBatchesOf(rows: readonly TrackingRow[]): { spans: number[]; numbers: number[] } {
  const spans = rows.map(() => 0);
  const numbers = rows.map(() => 0);
  let start = 0;
  let number = 0;
  while (start < rows.length) {
    number += 1;
    const batch = rows[start].entry.shippedAt;
    let end = start + 1;
    while (end < rows.length && rows[end].entry.shippedAt === batch) {
      end += 1;
    }
    spans[start] = end - start;
    numbers[start] = number;
    start = end;
  }
  return { spans, numbers };
}

export function MaterialReissuePanel({
  projectId,
  tasks,
  members,
  viewerId = null,
  canViewAll = false,
  canMark = false,
  canMarkAll = false,
  tierTint = false,
  view,
  onChangeView,
  tabs,
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
  /** 背景档位铺色档：simple = false；适中 / 炫彩 = 行铺色。 */
  tierTint?: TintedTier | false;
  /** 当前页内子视图（由地址 `?view=material-reissue&sub=` 控制）；缺省 all。 */
  view?: MaterialReissueView;
  /** 切换页内子视图（写回地址）。 */
  onChangeView?: (view: MaterialReissueView) => void;
  /** 嵌入「项目文件」页时的内部切换控件（标题右侧）。 */
  tabs?: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadTick, setReloadTick] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [internalView, setInternalView] = useState<MaterialReissueView>("all");
  const activeView = view ?? internalView;
  const changeActiveView = (next: MaterialReissueView): void => {
    setInternalView(next);
    onChangeView?.(next);
  };
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [shipmentOpen, setShipmentOpen] = useState(false);
  const [shipmentStatus, setShipmentStatus] = useState<MaterialReissueTrackingStatus>("shipped");
  const [shipmentTrackingNo, setShipmentTrackingNo] = useState("");
  const [shipmentEta, setShipmentEta] = useState("");
  const [shipmentNote, setShipmentNote] = useState("");
  const [shipmentImages, setShipmentImages] = useState<Array<{ file: File; url: string }>>([]);
  const shipmentImagesRef = useRef(shipmentImages);
  shipmentImagesRef.current = shipmentImages;

  const appendShipmentImages = (files: File[]): void => {
    if (files.length === 0) {
      return;
    }
    setShipmentImages((previous) => [
      ...previous,
      ...files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
    setShipmentError(null);
  };

  const removeShipmentImage = (index: number): void => {
    setShipmentImages((previous) => {
      const target = previous[index];
      if (target !== undefined) {
        URL.revokeObjectURL(target.url);
      }
      return previous.filter((_, current) => current !== index);
    });
  };
  const [shipmentBusy, setShipmentBusy] = useState(false);
  const [shipmentError, setShipmentError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [trackingSavingKey, setTrackingSavingKey] = useState<string | null>(null);
  const [imageGallery, setImageGallery] = useState<{ items: GalleryImage[]; index: number } | null>(null);

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
    if (activeView === "all") {
      return;
    }
    setSelectedKeys(new Set());
    setShipmentOpen(false);
    setShipmentError(null);
  }, [activeView]);

  /** 卸载时回收表单缩略图的 object URL。 */
  useEffect(() => {
    return () => {
      for (const image of shipmentImagesRef.current) {
        URL.revokeObjectURL(image.url);
      }
    };
  }, []);

  useEffect(() => {
    if (!shipmentOpen && imageGallery === null) {
      return;
    }
    return lockBodyScroll();
  }, [shipmentOpen, imageGallery]);

  /** 发货登记弹窗打开时，Ctrl+V 粘贴剪贴板图片（与日报填写同一交互习惯）。 */
  useEffect(() => {
    if (!shipmentOpen) {
      return;
    }
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      appendShipmentImages(files);
    };
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("paste", onPaste);
    };
  }, [shipmentOpen]);

  useEffect(() => {
    if (!shipmentOpen && imageGallery === null) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.stopPropagation();
      if (imageGallery !== null) {
        setImageGallery(null);
      } else if (!shipmentBusy) {
        setShipmentOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, [shipmentOpen, imageGallery, shipmentBusy]);

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
    // 已发货优先排在前面，已签收自动往下排；同状态内仍按登记时间倒序。
    const rankOf = (status: string): number => (status === "shipped" ? 0 : 1);
    return rows.sort((left, right) => {
      const rankDiff = rankOf(left.entry.status) - rankOf(right.entry.status);
      return rankDiff !== 0 ? rankDiff : trackingTimeOf(right.entry) - trackingTimeOf(left.entry);
    });
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

  const trackingSpans = {
    trackingNo: trackingSpansOf(filteredTrackingRows, "trackingNo"),
    eta: trackingSpansOf(filteredTrackingRows, "eta"),
    note: trackingSpansOf(filteredTrackingRows, "note"),
    status: trackingSpansOf(filteredTrackingRows, "status"),
    images: trackingSpansOf(filteredTrackingRows, "images"),
    source: trackingSpansOf(filteredTrackingRows, "source"),
  };
  const trackingBatches = trackingBatchesOf(filteredTrackingRows);
  const trackingGroupOf = (index: number, key: TrackingMergeKey): TrackingRow[] => {
    const span = trackingSpans[key][index] ?? 0;
    return span === 0 ? [] : filteredTrackingRows.slice(index, index + span);
  };

  const filteredApplicationIds = new Set(filteredApplications.map((application) => application.id));
  const selectableRows = allRows.filter((row) => filteredApplicationIds.has(row.application.id) && row.canSelect);
  const selectableKeys = selectableRows.map((row) => row.key);
  const selectedSelectableCount = selectableKeys.filter((key) => selectedKeys.has(key)).length;
  const allSelected = selectableKeys.length > 0 && selectedSelectableCount === selectableKeys.length;
  const selectedRows = allRows.filter((row) => row.canSelect && row.tracking === null && selectedKeys.has(row.key));
  const allRowByKey = new Map(allRows.map((row) => [row.key, row] as const));

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

  const toggleSelection = (): void => {
    if (selectableKeys.length === 0) {
      return;
    }
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (allSelected) {
        for (const key of selectableKeys) {
          next.delete(key);
        }
        return next;
      }
      const slots = Math.max(0, MAX_SHIPMENT_ITEMS - next.size);
      if (slots === 0) {
        setNotice({ kind: "info", text: t("pd.material.selectionLimit", { n: MAX_SHIPMENT_ITEMS }) });
        return previous;
      }
      if (selectableKeys.length > slots) {
        setNotice({ kind: "info", text: t("pd.material.selectionLimit", { n: MAX_SHIPMENT_ITEMS }) });
      }
      for (const key of selectableKeys.slice(0, slots)) {
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
    setShipmentImages((previous) => {
      for (const image of previous) {
        URL.revokeObjectURL(image.url);
      }
      return [];
    });
    setShipmentError(null);
  };

  const pasteFromClipboard = async (): Promise<void> => {
    if (shipmentBusy) {
      return;
    }
    setShipmentError(null);
    try {
      const files = await readClipboardImageFiles();
      if (files.length === 0) {
        setShipmentError(t("pd.material.clipboardNoImage"));
        return;
      }
      appendShipmentImages(files);
    } catch {
      setShipmentError(t("pd.material.clipboardReadFailed"));
    }
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
      const imageFileIds: string[] = [];
      if (shipmentImages.length > 0) {
        const taskId = canMarkAll ? undefined : selectedRows[0]?.application.material.taskId;
        for (const image of shipmentImages) {
          imageFileIds.push(await uploadFile(projectId, image.file, image.file.name, taskId === undefined ? {} : { taskId }));
        }
      }
      await createMaterialReissueTracking(projectId, {
        items: selectedRows.map((row) => ({ changeRequestId: row.application.id, lineIndex: row.lineIndex })),
        status: shipmentStatus,
        trackingNo: shipmentTrackingNo.trim() === "" ? undefined : shipmentTrackingNo.trim(),
        estimatedArrivalDate: shipmentEta === "" ? undefined : shipmentEta,
        note: shipmentNote.trim() === "" ? undefined : shipmentNote.trim(),
        imageFileIds,
      });
      const count = selectedRows.length;
      setShipmentOpen(false);
      setSelectedKeys(new Set());
      resetShipmentForm();
      changeActiveView("tracking");
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

  /** 补发追踪行内修改：同一合并单元格内的所有物料行一起更新。 */
  const patchTracking = async (
    rows: readonly TrackingRow[],
    patch: Omit<UpdateMaterialReissueTrackingInput, "changeRequestId" | "lineIndex">,
  ): Promise<void> => {
    if (!canMark || trackingSavingKey !== null || rows.length === 0) {
      return;
    }
    setTrackingSavingKey(rows[0].key);
    try {
      const results = await Promise.all(
        rows.map((row) =>
          updateMaterialReissueTracking(projectId, {
            changeRequestId: row.application.id,
            lineIndex: row.lineIndex,
            ...patch,
          }),
        ),
      );
      const updates = results.flatMap((result) => result.items);
      if (updates.length === 0) {
        setNotice({ kind: "error", text: t("pd.material.trackingSaveFailed") });
        return;
      }
      const updateByKey = new Map(updates.map((entry) => [entry.changeRequestId + ":" + String(entry.lineIndex), entry] as const));
      setState((previous) =>
        previous.kind !== "ready"
          ? previous
          : {
              kind: "ready",
              applications: previous.applications.map((application) => {
                const tracking = application.tracking.map(
                  (entry) => updateByKey.get(entry.changeRequestId + ":" + String(entry.lineIndex)) ?? entry,
                );
                return tracking === application.tracking ? application : { ...application, tracking };
              }),
            },
      );
      setNotice({ kind: "ok", text: t("pd.material.trackingSaved") });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error && error.message !== "" ? error.message : t("pd.material.trackingSaveFailed"),
      });
    } finally {
      setTrackingSavingKey(null);
    }
  };

  return (
    // 页面内容最大宽度 1740px 居中、两侧留白（2026-11-25 业务口径：宽屏不铺满整行，小屏动态收窄）；
    // 屏幕小于 1740px 时由 w-full 自动收窄，表格横向滚动兜底不变。
    // 全部补发追求紧凑：内容列最大 1140px，表格只留备注列吸收少量余量；补发追踪列更多，放宽到 1680px 并随窗口自适应。
    // 小屏时随容器收窄，表格自身横向滚动兜底（2026-11-25 口径「整体表格长度缩减」）。
    <section data-project-material-reissue="" className="mx-auto w-full max-w-[1680px] space-y-4">
      <header data-files-tabs-sticky="true" className="sticky top-[123px] z-10 flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200/70 bg-[#f5f6f8]/95 py-2 backdrop-blur">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {tabs ?? <h2 className="text-lg font-semibold text-zinc-900">{t("pd.material.title")}</h2>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span data-project-material-reissue-summary="">{summaryText}</span>
        </div>
      </header>

      <div className="sticky top-[171px] z-[9] flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white/95 px-3 py-2.5 backdrop-blur">
        {state.kind === "ready" && activeView === "all" ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span data-project-material-reissue-selected={selectedRows.length}>{t("pd.material.selectedCount", { n: selectedRows.length })}</span>
            <span className="hidden lg:inline">{t("pd.material.batchHint")}</span>
            <button
              type="button"
              disabled={selectableRows.length === 0}
              onClick={toggleSelection}
              className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-300"
            >
              {allSelected ? t("pd.material.unselectAllPage") : t("pd.material.selectAllPage")}
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
        ) : null}
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
                {filteredApplications.map((application) => {
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
                        <table className="w-full table-fixed border-collapse text-left text-sm">
                          <colgroup>
                            <col className="w-[52px]" />
                            <col className="w-[56px]" />
                            <col className="w-[130px]" />
                            <col />
                            <col />
                            <col className="w-[72px]" />
                            <col className="w-[60px]" />
                            <col />
                            <col className="w-[88px]" />
                          </colgroup>
                          <thead className="bg-zinc-50 text-zinc-500">
                            <tr>
                              <th scope="col" className="whitespace-nowrap border-b border-zinc-200 px-3 py-3.5 text-center font-medium">
                                <span className="sr-only">{t("pd.material.selectAllPage")}</span>
                              </th>
                              <th scope="col" className="whitespace-nowrap border-b border-zinc-200 px-3 py-3.5 text-center font-medium">{t("header.seqNo")}</th>
                              <th scope="col" className="whitespace-nowrap border-b border-zinc-200 px-3 py-3.5 text-left font-medium">{fieldText(locale, "物料编码")}</th>
                              <th scope="col" className="whitespace-nowrap border-b border-zinc-200 px-3 py-3.5 text-left font-medium">{fieldText(locale, "物料名称")}</th>
                              <th scope="col" className="whitespace-nowrap border-b border-zinc-200 px-3 py-3.5 text-left font-medium">{fieldText(locale, "规格型号")}</th>
                              <th scope="col" className="whitespace-nowrap border-b border-zinc-200 px-3 py-3.5 text-right font-medium">{fieldText(locale, "数量")}</th>
                              <th scope="col" className="whitespace-nowrap border-b border-zinc-200 px-3 py-3.5 text-center font-medium">{fieldText(locale, "单位")}</th>
                              <th scope="col" className="whitespace-nowrap border-b border-zinc-200 px-3 py-3.5 text-left font-medium">{fieldText(locale, "备注")}</th>
                              <th scope="col" className="whitespace-nowrap border-b border-zinc-200 px-3 py-3.5 text-center font-medium">{t("pd.material.col.status")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {material.materials.length === 0 ? (
                              <tr>
                                <td colSpan={9} className="border-b border-zinc-100 px-3 py-10 text-center text-sm text-zinc-400">—</td>
                              </tr>
                            ) : (
                              material.materials.map((line, index) => {
                                const row = allRowByKey.get(trackingKey(application.id, index));
                                const rowStatus: MaterialRowStatus = row?.tracking?.status ?? "pending";
                                const rowTint = materialRowTintOf(tierTint === "vivid" ? "vivid" : "medium", rowStatus);
                                return (
                                  <tr
                                    key={row?.key ?? String(index)}
                                    data-material-reissue-line={String(index + 1)}
                                    data-material-reissue-row-status={rowStatus}
                                    className="task-row-tint transition"
                                    style={{ "--row-tint": rowTint.tint, "--row-tint-hover": rowTint.hover } as CSSProperties}
                                  >
                                    <td className="border-b border-zinc-100 px-3 py-3.5 text-center align-middle">
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
                                    <td className="border-b border-zinc-100 px-3 py-3.5 text-center align-middle tabular-nums text-zinc-500">{index + 1}</td>
                                    <td className="break-words border-b border-zinc-100 px-3 py-3.5 align-middle text-zinc-700">{textOrDash(line.materialCode)}</td>
                                    <td className="break-words border-b border-zinc-100 px-3 py-3.5 align-middle font-medium text-zinc-800">{textOrDash(line.materialName)}</td>
                                    <td className="break-words border-b border-zinc-100 px-3 py-3.5 align-middle text-zinc-700">{textOrDash(line.specification)}</td>
                                    <td className="border-b border-zinc-100 px-3 py-3.5 text-right align-middle tabular-nums text-zinc-700">{quantityText(line.quantity)}</td>
                                    <td className="border-b border-zinc-100 px-3 py-3.5 text-center align-middle text-zinc-700">{textOrDash(line.unit)}</td>
                                    <td className="break-words border-b border-zinc-100 px-3 py-3.5 align-middle text-zinc-600">{textOrDash(line.remark)}</td>
                                    <td className="whitespace-nowrap border-b border-zinc-100 px-3 py-3.5 text-center align-middle">
                                      <span className={"text-[11px] font-bold " + materialStatusTextClass(rowStatus)}>
                                        {rowStatus === "pending" ? t("pd.material.status.pending") : statusLabel(rowStatus)}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>

                    </article>
                  );
                })}
              </div>
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
              <table className="w-full min-w-[1480px] table-fixed border-collapse border border-zinc-200 text-left text-sm">
                <colgroup>
                  <col className="w-[96px]" />
                  <col className="w-[220px]" />
                  <col />
                  <col className="w-[90px]" />
                  <col className="w-[140px]" />
                  <col className="w-[120px]" />
                  <col className="w-[180px]" />
                  <col className="w-[90px]" />
                  <col className="w-[164px]" />
                  <col className="w-[220px]" />
                </colgroup>
                <thead className="bg-zinc-50 text-zinc-500">
                  <tr>
                    <th className="whitespace-nowrap border border-zinc-200 px-4 py-3.5 text-center font-medium">{t("pd.material.col.reissueNo")}</th>
                    <th className="whitespace-nowrap border border-zinc-200 px-4 py-3.5 text-left font-medium">{fieldText(locale, "物料名称")}</th>
                    <th className="whitespace-nowrap border border-zinc-200 px-4 py-3.5 text-left font-medium">{fieldText(locale, "规格型号")}</th>
                    <th className="whitespace-nowrap border border-zinc-200 px-4 py-3.5 text-right font-medium">{fieldText(locale, "数量")}</th>
                    <th className="whitespace-nowrap border border-zinc-200 px-4 py-3.5 text-left font-medium">{t("pd.material.col.trackingNo")}</th>
                    <th className="whitespace-nowrap border border-zinc-200 px-4 py-3.5 text-left font-medium">{t("pd.material.col.eta")}</th>
                    <th className="whitespace-nowrap border border-zinc-200 px-4 py-3.5 text-left font-medium">{t("pd.material.col.shipNote")}</th>
                    <th className="whitespace-nowrap border border-zinc-200 px-4 py-3.5 text-center font-medium">{t("pd.material.col.status")}</th>
                    <th className="whitespace-nowrap border border-zinc-200 px-4 py-3.5 text-center font-medium">{t("pd.material.col.image")}</th>
                    <th className="whitespace-nowrap border border-zinc-200 px-4 py-3.5 text-left font-medium">{t("pd.material.col.source")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrackingRows.map((row, index) => {
                    const sourceTitle = row.application.material.taskTitle !== "" ? row.application.material.taskTitle : row.task?.title ?? "—";
                    const imageIds = imageIdsOf(row.entry);
                    const rowTint = tierTint === false ? null : materialRowTintOf(tierTint, row.entry.status);
                    const batchStart = index > 0 && filteredTrackingRows[index - 1]?.entry.shippedAt !== row.entry.shippedAt;
                    const batchSpan = trackingBatches.spans[index] ?? 0;
                    const batchNo = trackingBatches.numbers[index] ?? 0;
                    const spanOf = (key: TrackingMergeKey): number => trackingSpans[key][index] ?? 0;
                    const groupOf = (key: TrackingMergeKey): TrackingRow[] => trackingGroupOf(index, key);
                    return (
                      <tr
                        key={row.key}
                        data-material-reissue-tracking-row={row.key}
                        data-material-reissue-row-status={row.entry.status}
                        className={(rowTint === null ? "" : "task-row-tint-static ") + (batchStart ? "tracking-batch-start" : "")}
                        style={rowTint === null ? undefined : ({ "--row-tint": rowTint.tint, "--row-tint-hover": rowTint.hover } as CSSProperties)}
                      >
                        {batchSpan === 0 ? null : (
                          <td rowSpan={batchSpan} className="border border-zinc-200 px-4 py-4 text-center align-middle font-medium tabular-nums text-zinc-600">
                            NO.{batchNo}
                          </td>
                        )}
                        <td className="border border-zinc-200 px-4 py-4 align-middle">
                          <div className="font-medium text-zinc-800">{textOrDash(row.line.materialName)}</div>
                          <div className="mt-0.5 text-[11px] text-zinc-400">{textOrDash(row.line.materialCode)}</div>
                        </td>
                        <td className="break-words border border-zinc-200 px-4 py-4 align-middle text-zinc-700">{textOrDash(row.line.specification)}</td>
                        <td className="whitespace-nowrap border border-zinc-200 px-4 py-4 text-right align-middle tabular-nums text-zinc-700">{quantityText(row.line.quantity)} {textOrDash(row.line.unit)}</td>
                        {spanOf("trackingNo") === 0 ? null : (
                          <td rowSpan={spanOf("trackingNo")} className="break-words border border-zinc-200 px-4 py-4 align-middle text-zinc-700">
                            <InlineTextCell
                              value={row.entry.trackingNo ?? ""}
                              ariaLabel={t("pd.material.col.trackingNo")}
                              placeholder={t("pd.material.col.trackingNo")}
                              rows={1}
                              disabled={!canMark || trackingSavingKey !== null}
                              disabledHint={t("pd.material.editLocked")}
                              triggerClassName="break-words text-left text-zinc-700"
                              display={row.entry.trackingNo === null ? <span className="text-zinc-400">—</span> : row.entry.trackingNo}
                              onSave={(value) => {
                                const next = value.trim();
                                void patchTracking(groupOf("trackingNo"), { trackingNo: next === "" ? null : next });
                              }}
                            />
                          </td>
                        )}
                        {spanOf("eta") === 0 ? null : (
                          <td rowSpan={spanOf("eta")} className="whitespace-nowrap border border-zinc-200 px-4 py-4 align-middle text-zinc-700">
                            <InlineDateCell
                              valueIso={row.entry.estimatedArrivalDate ?? ""}
                              ariaLabel={t("pd.material.col.eta")}
                              disabled={!canMark || trackingSavingKey !== null}
                              disabledHint={t("pd.material.editLocked")}
                              triggerClassName="tabular-nums text-zinc-700"
                              display={row.entry.estimatedArrivalDate === null ? <span className="text-zinc-400">—</span> : row.entry.estimatedArrivalDate.replace(/-/g, "/")}
                              onChange={(iso) => {
                                void patchTracking(groupOf("eta"), { estimatedArrivalDate: iso === "" ? null : iso });
                              }}
                            />
                          </td>
                        )}
                        {spanOf("note") === 0 ? null : (
                          <td rowSpan={spanOf("note")} className="break-words border border-zinc-200 px-4 py-4 align-middle text-zinc-600">
                            <InlineTextCell
                              value={row.entry.note ?? ""}
                              ariaLabel={t("pd.material.col.shipNote")}
                              placeholder={t("pd.material.col.shipNote")}
                              rows={2}
                              disabled={!canMark || trackingSavingKey !== null}
                              disabledHint={t("pd.material.editLocked")}
                              triggerClassName="break-words text-left text-zinc-600"
                              display={row.entry.note === null ? <span className="text-zinc-400">—</span> : row.entry.note}
                              onSave={(value) => {
                                const next = value.trim();
                                void patchTracking(groupOf("note"), { note: next === "" ? null : next });
                              }}
                            />
                          </td>
                        )}
                        {spanOf("status") === 0 ? null : (
                        <td rowSpan={spanOf("status")} className="border border-zinc-200 px-4 py-4 text-center align-middle">
                            <InlineOptionCell
                              value={row.entry.status}
                              options={[
                                { value: "shipped", label: t("pd.material.status.shipped") },
                                { value: "received", label: t("pd.material.status.received") },
                              ]}
                              ariaLabel={t("pd.material.col.status")}
                              disabled={!canMark || trackingSavingKey !== null}
                              disabledHint={t("pd.material.editLocked")}
                              bare
                              display={
                                <span
                                  className={
                                    rowTint === null
                                      ? "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + statusBadgeClass(row.entry.status)
                                      : "text-[11px] font-bold " + materialStatusTextClass(row.entry.status)
                                  }
                                >
                                  {statusLabel(row.entry.status)}
                                </span>
                              }
                              onPick={(value) => {
                                if (value !== row.entry.status) {
                                  void patchTracking(groupOf("status"), { status: value === "received" ? "received" : "shipped" });
                                }
                              }}
                            />
                        </td>
                        )}
                        {spanOf("images") === 0 ? null : (
                          <td rowSpan={spanOf("images")} className="border border-zinc-200 px-4 py-4 align-middle">
                            {imageIds.length === 0 ? (
                              <span className="text-zinc-400">—</span>
                            ) : (
                              <PhotoStrip
                                items={imageIds.map((fileId, imageIndex): ReportPhoto => ({
                                  fileId,
                                  name: t("pd.material.imageN", { n: imageIndex + 1 }),
                                  url: null,
                                }))}
                                size="lg"
                                strip={"material-reissue-" + row.key}
                              />
                            )}
                          </td>
                        )}
                        {spanOf("source") === 0 ? null : (
                          <td rowSpan={spanOf("source")} className="border border-zinc-200 px-4 py-4 align-middle text-zinc-600">
                            <button
                              type="button"
                              onClick={() => {
                                setDetailId(row.application.id);
                              }}
                              aria-label={t("pd.material.viewDetail")}
                              title={t("pd.material.viewDetail")}
                              className="group w-full text-left transition hover:text-zinc-900"
                            >
                              <div className="group-hover:underline">{sourceTitle}</div>
                              <div className="mt-0.5 text-[11px] text-zinc-400">{formatDateTime(row.application.appliedAt)} · {row.application.material.applicantName}</div>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
                      void pasteFromClipboard();
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
                      multiple
                      disabled={shipmentBusy}
                      onChange={(event) => {
                        appendShipmentImages(Array.from(event.currentTarget.files ?? []));
                        event.currentTarget.value = "";
                      }}
                      className="sr-only"
                    />
                  </label>
                </div>
                {shipmentImages.length === 0 ? null : (
                  <div className="mt-2 flex flex-wrap gap-3">
                    {shipmentImages.map((image, index) => (
                      <div key={image.url} className="relative">
                        <button
                          type="button"
                          disabled={shipmentBusy}
                          onClick={() => {
                            setImageGallery({
                              items: shipmentImages.map((item) => ({ url: item.url, name: item.file.name })),
                              index,
                            });
                          }}
                          className="block overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 p-1 transition hover:border-zinc-300"
                        >
                          <img src={image.url} alt={image.file.name} className="h-24 w-24 rounded object-cover" />
                        </button>
                        <button
                          type="button"
                          disabled={shipmentBusy}
                          aria-label={t("pd.material.removeImage")}
                          title={t("pd.material.removeImage")}
                          onClick={() => {
                            removeShipmentImage(index);
                          }}
                          className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-xs font-semibold leading-none text-white shadow transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          ×
                        </button>
                      </div>
                    ))}
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

      {imageGallery === null ? null : (
        <ImageGalleryOverlay
          images={imageGallery.items}
          index={imageGallery.index}
          onChange={(index) => {
            setImageGallery((previous) => (previous === null ? previous : { ...previous, index }));
          }}
          onClose={() => {
            setImageGallery(null);
          }}
        />
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
