import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "./api";
import { AppHeader } from "./components/AppHeader";
import { InlineCell, InlineDateCell, InlineOptionCell } from "./components/InlineEdit";
import { MemberSearchList, type SearchListStatusButton } from "./components/MemberSelect";
import { ScrollArea } from "./components/ScrollArea";
import { FixedHorizontalScrollbar } from "./components/FixedHorizontalScrollbar";
import { STAGE_TAG_CLASS } from "./components/TaskKanban";
import { RegionSelect } from "./components/RegionSelect";
import type { SelectOption } from "./components/SelectMenu";
import { Toast, ToastConfirm, type ToastKind } from "./components/Toast";
import { tableGridTemplate, tableMinWidth } from "./components/TaskBoard";
import { usePopover } from "./components/usePopover";
import type { Member } from "./data/members";
import { directoryMemberOptions, type DirectoryUser } from "./directory";
import { dictLabel, type Dicts } from "./dicts";
import { fullDateText, stageText, useLocale, useT, type TextKey } from "./i18n";
import type { ProjectManagerCandidate } from "./projectManagerCandidates";
import { PROJECT_BASE_HASH } from "./useHashRoute";
import { stageNameOf } from "./taskApi";
import {
  createProjectManagementRecord,
  deleteProjectManagementRecord,
  fetchProjectManagementRecords,
  updateProjectManagementRecord,
  type ProjectManagementMethod,
  type ProjectManagementRecord,
  type ProjectManagementWriteInput,
} from "./projectManagementApi";
import type { MeResponse } from "./types";

type PmColumnKey =
  | "code"
  | "name"
  | "manager"
  | "engineer"
  | "method"
  | "stage"
  | "startup"
  | "risk"
  | "arrival"
  | "location"
  | "start"
  | "end"
  | "days";


type PmTextColumnKey = "code" | "name" | "stage";
type PmMultiColumnKey = "manager" | "engineer" | "location";
type PmDateColumnKey = "startup" | "arrival" | "start" | "end";
type PmDateSort = { key: PmDateColumnKey; direction: "asc" | "desc" };
type PmDateOverrideKey =
  | "startupCompletedAtOverride"
  | "arrivalDateOverride"
  | "plannedStartDateOverride"
  | "plannedEndDateOverride";
type PmFilterKind = "text" | "multi" | "method" | "date" | "none";
type PmFilterOption = { value: string; label: string };
type PmColumn = {
  key: PmColumnKey;
  labelKey: TextKey;
  width: string;
  min: number;
};

const ROW_NUMBER_WIDTH = 48;
const CODE_MIN_WIDTH = 150;
const PM_TABLE_NAME_WIDTH = 200;
const PM_TABLE_RISK_WIDTH = 160;
const MIN_TRAILING_EMPTY_ROWS = 5;
const MIN_TABLE_ROWS = 6;
const TEXT_AUTOSAVE_DELAY_MS = 450;
const SNAPSHOT_REFRESH_INTERVAL_MS = 30_000;
const NO_USED_REGIONS: Readonly<Record<string, number>> = {};

const PM_STAGE_KEYS = [
  "not_started",
  "presale",
  "design",
  "purchase",
  "assembly",
  "install",
  "deploy",
  "trial",
  "production",
  "acceptance",
  "archived",
  "terminated",
] as const;

const PM_EXTRA_STAGE_NAMES: Record<string, string> = {
  not_started: "立项未启动",
  archived: "已归档",
  terminated: "终止",
};

const PM_EXTRA_STAGE_TAG_CLASS: Record<string, string> = {
  "立项未启动": "bg-amber-100 text-amber-800",
  "已归档": "bg-zinc-200 text-zinc-700",
  "终止": "bg-rose-100 text-rose-800",
};

const pmStageNameOf = (stageKey: string | null): string =>
  stageKey === null ? "" : (PM_EXTRA_STAGE_NAMES[stageKey] ?? stageNameOf(stageKey));

const pmStageTagClass = (stageName: string): string =>
  PM_EXTRA_STAGE_TAG_CLASS[stageName] ?? STAGE_TAG_CLASS[stageName] ?? "bg-zinc-200 text-zinc-600";

const PM_VIEW_TABS = [
  { key: "table", labelKey: "pm.view.table" },
  { key: "implementationGantt", labelKey: "pm.view.implementationGantt" },
] as const;
type PmViewTabKey = (typeof PM_VIEW_TABS)[number]["key"];

const COLUMNS: readonly PmColumn[] = [
  { key: "code", labelKey: "pm.column.code", width: CODE_MIN_WIDTH + "px", min: CODE_MIN_WIDTH },
  { key: "name", labelKey: "pm.column.name", width: PM_TABLE_NAME_WIDTH + "px", min: PM_TABLE_NAME_WIDTH },
  { key: "manager", labelKey: "pm.column.manager", width: "120px", min: 120 },
  { key: "engineer", labelKey: "pm.column.engineer", width: "130px", min: 130 },
  { key: "method", labelKey: "pm.column.method", width: "120px", min: 120 },
  { key: "stage", labelKey: "pm.column.stage", width: "110px", min: 110 },
  { key: "startup", labelKey: "pm.column.started", width: "100px", min: 100 },
  { key: "risk", labelKey: "pm.column.risk", width: PM_TABLE_RISK_WIDTH + "px", min: PM_TABLE_RISK_WIDTH },
  { key: "arrival", labelKey: "pm.column.arrival", width: "100px", min: 100 },
  { key: "location", labelKey: "pm.column.location", width: "100px", min: 100 },
  { key: "start", labelKey: "pm.column.planStart", width: "110px", min: 110 },
  { key: "end", labelKey: "pm.column.planEnd", width: "110px", min: 110 },
  { key: "days", labelKey: "pm.column.days", width: "72px", min: 72 },
];


const FILTER_KIND_BY_COLUMN: Record<PmColumnKey, PmFilterKind> = {
  code: "text",
  name: "text",
  manager: "multi",
  engineer: "multi",
  method: "method",
  stage: "text",
  startup: "date",
  risk: "none",
  arrival: "date",
  location: "multi",
  start: "date",
  end: "date",
  days: "none",
};
// 当前可选值；旧两种安装指导仅保留在 METHOD_META 中，用于历史记录展示。
const METHOD_KEYS: readonly ProjectManagementMethod[] = [
  "installation_delivery",
  "remote_guidance",
  "onsite_guidance",
];

const METHOD_META: Record<ProjectManagementMethod, { labelKey: TextKey; chipClass: string }> = {
  onsite_installation_guidance: {
    labelKey: "pm.method.onsiteInstallationGuidance",
    chipClass: "bg-[#c7d2fe] text-[#1e3a8a]",
  },
  remote_installation_guidance: {
    labelKey: "pm.method.remoteInstallationGuidance",
    chipClass: "bg-sky-200 text-sky-900",
  },
  installation_delivery: {
    labelKey: "pm.method.installationDelivery",
    chipClass: "bg-emerald-200 text-emerald-900",
  },
  remote_guidance: {
    labelKey: "pm.method.remoteGuidance",
    chipClass: "bg-zinc-200 text-zinc-700",
  },
  onsite_guidance: {
    labelKey: "pm.method.onsiteGuidance",
    chipClass: "bg-rose-200 text-rose-900",
  },
};

const PM_PARALLEL_METHODS: ReadonlySet<ProjectManagementMethod> = new Set([
  "remote_guidance",
  "remote_installation_guidance",
]);

type PmGanttResourceMode = "blocking" | "parallel";

const pmGanttResourceModeOf = (row: PmRow): PmGanttResourceMode =>
  row.implementationMethod !== "" && PM_PARALLEL_METHODS.has(row.implementationMethod)
    ? "parallel"
    : "blocking";

type RowSaveState = "idle" | "dirty" | "saving" | "error";

type PmSnapshotFields = {
  projectId: string | null;
  currentStage: string | null;
  startupCompletedAt: string | null;
  arrivalDate: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  implementationDays: number | null;
};

type PmOverrideFields = {
  currentStageOverride: string | null;
  startupCompletedAtOverride: string | null;
  arrivalDateOverride: string | null;
  plannedStartDateOverride: string | null;
  plannedEndDateOverride: string | null;
  implementationDaysOverride: number | null;
};

type PmRow = PmSnapshotFields & PmOverrideFields & {
  clientId: string;
  recordId: string | null;
  version: number | null;
  code: string;
  name: string;
  managerIds: string[];
  managerNames: Array<string | null>;
  implementationEngineerIds: string[];
  implementationEngineerNames: Array<string | null>;
  implementationHandedOver: boolean;
  implementationMethod: ProjectManagementMethod | "";
  riskReminder: string;
  region: string;
  revision: number;
  savedRevision: number;
  saveState: RowSaveState;
  saveMessage: string | null;
};

let localRowSequence = 0;
const nextLocalRowId = (): string => {
  localRowSequence += 1;
  return "pm-local-" + String(localRowSequence);
};

const createEmptyRow = (clientId: string = nextLocalRowId()): PmRow => ({
  clientId,
  recordId: null,
  version: null,
  code: "",
  name: "",
  managerIds: [],
  managerNames: [],
  implementationEngineerIds: [],
  implementationEngineerNames: [],
  implementationHandedOver: false,
  implementationMethod: "",
  riskReminder: "",
  region: "",
  ...emptySnapshotFields(),
  ...emptyOverrideFields(),
  revision: 0,
  savedRevision: 0,
  saveState: "idle",
  saveMessage: null,
});

const createEmptyRows = (): PmRow[] => Array.from({ length: MIN_TABLE_ROWS }, () => createEmptyRow());

const emptySnapshotFields = (): PmSnapshotFields => ({
  projectId: null,
  currentStage: null,
  startupCompletedAt: null,
  arrivalDate: null,
  plannedStartDate: null,
  plannedEndDate: null,
  implementationDays: null,
});

const emptyOverrideFields = (): PmOverrideFields => ({
  currentStageOverride: null,
  startupCompletedAtOverride: null,
  arrivalDateOverride: null,
  plannedStartDateOverride: null,
  plannedEndDateOverride: null,
  implementationDaysOverride: null,
});

const snapshotFieldsOf = (record: ProjectManagementRecord): PmSnapshotFields => ({
  projectId: record.projectId,
  currentStage: record.currentStage,
  startupCompletedAt: record.startupCompletedAt,
  arrivalDate: record.arrivalDate,
  plannedStartDate: record.plannedStartDate,
  plannedEndDate: record.plannedEndDate,
  implementationDays: record.implementationDays,
});

const overrideFieldsOf = (record: ProjectManagementRecord): PmOverrideFields => ({
  currentStageOverride: record.currentStageOverride,
  startupCompletedAtOverride: record.startupCompletedAtOverride,
  arrivalDateOverride: record.arrivalDateOverride,
  plannedStartDateOverride: record.plannedStartDateOverride,
  plannedEndDateOverride: record.plannedEndDateOverride,
  implementationDaysOverride: record.implementationDaysOverride,
});


const isTextColumnKey = (key: PmColumnKey): key is PmTextColumnKey =>
  key === "code" || key === "name" || key === "stage";

const isMultiColumnKey = (key: PmColumnKey): key is PmMultiColumnKey =>
  key === "manager" || key === "engineer" || key === "location";

const isDateColumnKey = (key: PmColumnKey): key is PmDateColumnKey =>
  key === "startup" || key === "arrival" || key === "start" || key === "end";

const collectMemberFilterOptions = (
  rows: readonly PmRow[],
  idsOf: (row: PmRow) => readonly string[],
  namesOfRow: (row: PmRow) => ReadonlyArray<string | null>,
  directory: readonly DirectoryUser[],
  locale: string,
): PmFilterOption[] => {
  const labels = new Map<string, string>();
  rows.forEach((row) => {
    const ids = idsOf(row);
    const rowNames = namesOfRow(row);
    ids.forEach((id, index) => {
      if (!labels.has(id)) {
        labels.set(id, rowNames[index] ?? directory.find((user) => user.id === id)?.displayName ?? id);
      }
    });
  });
  return Array.from(labels, ([value, label]) => ({ value, label })).sort((left, right) =>
    left.label.localeCompare(right.label, locale),
  );
};

const effectiveStageOf = (row: PmRow): string | null => row.currentStageOverride ?? row.currentStage;

const effectiveDateOf = (row: PmRow, key: PmDateColumnKey): string | null => {
  if (key === "startup") {
    return row.startupCompletedAtOverride ?? row.startupCompletedAt;
  }
  if (key === "arrival") {
    return row.arrivalDateOverride ?? row.arrivalDate;
  }
  if (key === "start") {
    return row.plannedStartDateOverride ?? row.plannedStartDate;
  }
  return row.plannedEndDateOverride ?? row.plannedEndDate;
};

const inclusiveDaysBetween = (fromIso: string, toIso: string): number => {
  const from = Date.parse(fromIso + "T00:00:00Z");
  const to = Date.parse(toIso + "T00:00:00Z");
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
    return 0;
  }
  return Math.round((to - from) / 86_400_000) + 1;
};

const effectiveDaysOf = (row: PmRow): number | null => {
  if (row.implementationDaysOverride !== null) {
    return row.implementationDaysOverride;
  }
  const start = effectiveDateOf(row, "start");
  const end = effectiveDateOf(row, "end");
  if (row.plannedStartDateOverride !== null || row.plannedEndDateOverride !== null) {
    return start === null || end === null ? null : inclusiveDaysBetween(start, end);
  }
  return row.implementationDays;
};

const dateFilterValueOf = (row: PmRow, key: PmDateColumnKey): string | null => effectiveDateOf(row, key);

const includesFilterText = (value: string, query: string): boolean =>
  value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
const MEMBER_FILTER_TONES = [
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
  "bg-lime-100 text-lime-800",
  "bg-orange-100 text-orange-800",
  "bg-cyan-100 text-cyan-800",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-blue-100 text-blue-700",
];
const PM_TABLE_TAG_CLASS = "inline-block max-w-full truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium";
const PM_GANTT_TAG_CLASS = "inline-block max-w-full truncate whitespace-nowrap rounded-full px-1 py-0 text-[length:var(--pm-gantt-tag-size,9px)] leading-[var(--pm-gantt-tag-leading,16px)] font-normal";

const memberFilterToneOf = (value: string): string => {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % MEMBER_FILTER_TONES.length;
  }
  return MEMBER_FILTER_TONES[hash] ?? MEMBER_FILTER_TONES[0];
};

const rowFromRecord = (record: ProjectManagementRecord): PmRow => ({
  clientId: "pm-record-" + record.id,
  recordId: record.id,
  version: record.version,
  code: record.code,
  name: record.name,
  managerIds: record.managerIds.slice(),
  managerNames: record.managerNames.slice(),
  implementationEngineerIds: record.implementationEngineerIds.slice(),
  implementationEngineerNames: record.implementationEngineerNames.slice(),
  implementationHandedOver: record.implementationHandedOver,
  implementationMethod: record.implementationMethod ?? "",
  riskReminder: record.riskReminder ?? "",
  region: record.region,
  ...snapshotFieldsOf(record),
  ...overrideFieldsOf(record),
  revision: 0,
  savedRevision: 0,
  saveState: "idle",
  saveMessage: null,
});

const isEmptyRow = (row: PmRow): boolean =>
  row.code.trim() === "" &&
  row.name.trim() === "" &&
  row.managerIds.length === 0 &&
  row.implementationEngineerIds.length === 0 &&
  !row.implementationHandedOver &&
  row.implementationMethod === "" &&
  row.riskReminder.trim() === "" &&
  (row.region.trim() === "" || row.region === "未分类") &&
  row.currentStageOverride === null &&
  row.startupCompletedAtOverride === null &&
  row.arrivalDateOverride === null &&
  row.plannedStartDateOverride === null &&
  row.plannedEndDateOverride === null &&
  row.implementationDaysOverride === null;

const keepTrailingEmptyRows = (rows: PmRow[]): PmRow[] => {
  let firstTrailingEmpty = rows.length;
  while (firstTrailingEmpty > 0 && isEmptyRow(rows[firstTrailingEmpty - 1])) {
    firstTrailingEmpty -= 1;
  }

  if (firstTrailingEmpty === 0) {
    const kept = rows.slice(0, MIN_TABLE_ROWS);
    return [...kept, ...Array.from({ length: MIN_TABLE_ROWS - kept.length }, () => createEmptyRow())];
  }

  const dataRows = rows.slice(0, firstTrailingEmpty);
  const trailingRows = rows.slice(firstTrailingEmpty, firstTrailingEmpty + MIN_TRAILING_EMPTY_ROWS);
  return [
    ...dataRows,
    ...trailingRows,
    ...Array.from({ length: MIN_TRAILING_EMPTY_ROWS - trailingRows.length }, () => createEmptyRow()),
  ];
};

const normalizeRows = (rows: PmRow[]): PmRow[] => {
  if (rows.length === 0) {
    return createEmptyRows();
  }
  const withTrailing = keepTrailingEmptyRows(rows);
  if (withTrailing.length >= MIN_TABLE_ROWS) {
    return withTrailing;
  }
  return [...withTrailing, ...Array.from({ length: MIN_TABLE_ROWS - withTrailing.length }, () => createEmptyRow())];
};

const namesOf = (ids: readonly string[], current: ReadonlyArray<string | null>, directory: readonly DirectoryUser[]): Array<string | null> =>
  ids.map((id, index) => current[index] ?? directory.find((user) => user.id === id)?.displayName ?? null);

const displayNamesOf = (
  ids: readonly string[],
  current: ReadonlyArray<string | null>,
  directory: readonly DirectoryUser[],
): string[] =>
  namesOf(ids, current, directory).filter((name): name is string => name !== null && name !== "—" && name.trim() !== "");

const joinedNames = (
  ids: readonly string[],
  names: ReadonlyArray<string | null>,
  directory: readonly DirectoryUser[],
): string => {
  if (ids.length === 0) {
    return "";
  }
  return ids
    .map((id, index) => names[index] ?? directory.find((user) => user.id === id)?.displayName ?? "—")
    .join("、");
};

const inputOf = (row: PmRow): ProjectManagementWriteInput => ({
  code: row.code.trim(),
  name: row.name.trim(),
  region: row.region.trim() === "" || row.region === "未分类" ? "未分类" : row.region,
  managerIds: row.managerIds,
  implementationEngineerIds: row.implementationEngineerIds,
  implementationHandedOver: row.implementationHandedOver,
  implementationMethod: row.implementationMethod === "" ? null : row.implementationMethod,
  riskReminder: row.riskReminder.trim() === "" ? null : row.riskReminder,
  currentStageOverride: row.currentStageOverride,
  startupCompletedAtOverride: row.startupCompletedAtOverride,
  arrivalDateOverride: row.arrivalDateOverride,
  plannedStartDateOverride: row.plannedStartDateOverride,
  plannedEndDateOverride: row.plannedEndDateOverride,
  implementationDaysOverride: row.implementationDaysOverride,
});


function PmViewTabIcon({ view }: { view: PmViewTabKey }) {
  const className = "h-[18px] w-[18px] shrink-0";
  if (view === "table") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M9 9v11" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h4M10 12h7M7 16h5" />
      <circle cx="16" cy="8" r="1" />
    </svg>
  );
}

type TextCellProps = {
  value: string;
  readOnly: boolean;
  ariaLabel: string;
  align: "left" | "center";
  multilineOnFocus: boolean;
  allowLineBreaks?: boolean;
  cellKey: string;
  isCode?: boolean;
  maxLength?: number;
  projectHref?: string | null;
  projectOpenLabel?: string;
  projectOpenHint?: string;
  onInput: (value: string) => void;
  onBlur: () => void;
};

const PM_EDITABLE_CARET_ANCHOR = "\u200b";

const pmStripEditableAnchor = (text: string): string => text.replaceAll(PM_EDITABLE_CARET_ANCHOR, "");

const pmReadEditableText = (node: HTMLElement, multiline: boolean): string =>
  pmStripEditableAnchor(multiline ? node.innerText : node.textContent ?? "");

function TextCell({
  value,
  readOnly,
  ariaLabel,
  align,
  multilineOnFocus,
  allowLineBreaks = false,
  cellKey,
  isCode = false,
  maxLength,
  projectHref = null,
  projectOpenLabel,
  projectOpenHint,
  onInput,
  onBlur,
}: TextCellProps) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const [linkedEditing, setLinkedEditing] = useState(false);
  const linked = !readOnly && projectHref !== null && projectHref !== "" && value.trim() !== "";

  const clearOpenTimer = (): void => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };

  useEffect(() => clearOpenTimer, []);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (node === null) {
      return;
    }
    if (document.activeElement !== node && node.textContent !== value) {
      node.textContent = value;
    }
    if (linked && linkedEditing && document.activeElement !== node) {
      node.focus();
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(node);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [value, linked, linkedEditing]);

  if (readOnly) {
    return (
      <div
        className={
          "min-h-11 truncate px-2 py-3 text-xs leading-5 text-zinc-400 " +
          (align === "left" ? "text-left " : "text-center ")
        }
      >
        {value}
      </div>
    );
  }

  const openProject = (): void => {
    if (projectHref !== null && projectHref !== "") {
      window.location.assign(projectHref);
    }
  };

  if (linked && !linkedEditing) {
    return (
      <div
        key="project-link-display"
        data-project-management-cell={cellKey}
        data-project-management-code={isCode ? "" : undefined}
        onClick={() => {
          setLinkedEditing(true);
        }}
        className={
          "min-h-11 cursor-text truncate px-2 py-3 text-xs leading-5 text-zinc-700 transition hover:bg-zinc-50 " +
          (align === "left" ? "text-left " : "text-center ")
        }
      >
        <span
          role="link"
          tabIndex={0}
          aria-label={projectOpenLabel === undefined ? ariaLabel : ariaLabel + " " + projectOpenLabel}
          title={projectOpenHint}
          data-project-management-project-link=""
          onClick={(event) => {
            event.stopPropagation();
            if (event.detail > 1) {
              clearOpenTimer();
              return;
            }
            clearOpenTimer();
            openTimerRef.current = window.setTimeout(() => {
              openTimerRef.current = null;
              const selection = window.getSelection();
              if (selection === null || selection.isCollapsed) {
                openProject();
              }
            }, 240);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            clearOpenTimer();
            setLinkedEditing(true);
          }}
          onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openProject();
            } else if (event.key === "F2") {
              event.preventDefault();
              setLinkedEditing(true);
            }
          }}
          className={
            "inline-block max-w-full cursor-pointer truncate align-bottom text-blue-700 outline-none transition hover:text-blue-800 focus:rounded-sm focus:bg-blue-50/60 focus:ring-2 focus:ring-blue-500 " +
            (align === "left" ? "text-left " : "text-center ")
          }
        >
          {value}
        </span>
      </div>
    );
  }

  return (
    <div
      key="project-link-editor"
      ref={nodeRef}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={allowLineBreaks}
      aria-label={ariaLabel}
      spellCheck={false}
      data-project-management-cell={cellKey}
      data-project-management-code={isCode ? "" : undefined}
      onInput={(event) => {
        const raw = pmReadEditableText(event.currentTarget, allowLineBreaks);
        const text = maxLength === undefined ? raw : raw.slice(0, maxLength);
        if (text !== raw) {
          event.currentTarget.textContent = text;
          const range = document.createRange();
          const selection = window.getSelection();
          range.selectNodeContents(event.currentTarget);
          range.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
        onInput(text);
      }}
      onBlur={() => {
        onBlur();
        if (linked) {
          setLinkedEditing(false);
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const pasted = event.clipboardData.getData("text/plain");
        const normalized = allowLineBreaks
          ? pasted
          : pasted.replace(/\s*\r?\n\s*/g, " ");
        const text = maxLength === undefined ? normalized : normalized.slice(0, maxLength);
        document.execCommand("insertText", false, text);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Enter") {
          return;
        }
        if (!allowLineBreaks) {
          event.preventDefault();
          event.currentTarget.blur();
          return;
        }
        event.preventDefault();
        const selection = window.getSelection();
        if (selection === null || selection.rangeCount === 0) {
          return;
        }
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const lineBreak = document.createElement("br");
        const caretAnchor = document.createTextNode(PM_EDITABLE_CARET_ANCHOR);
        range.insertNode(lineBreak);
        lineBreak.parentNode?.insertBefore(caretAnchor, lineBreak.nextSibling);
        range.setStart(caretAnchor, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        const raw = pmReadEditableText(event.currentTarget, allowLineBreaks);
        const text = maxLength === undefined ? raw : raw.slice(0, maxLength);
        if (text !== raw) {
          event.currentTarget.textContent = text;
        }
        onInput(text);
      }}
      className={
        "min-h-11 truncate px-2 py-3 text-xs leading-5 outline-none transition focus:absolute focus:left-0 focus:right-0 focus:top-0 focus:z-20 focus:min-h-full focus:overflow-visible focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 " +
        (multilineOnFocus ? "focus:whitespace-pre-wrap focus:break-words " : "focus:whitespace-nowrap ") +
        (align === "left" ? "cursor-text text-left text-zinc-700 " : "cursor-text text-center text-zinc-700 ")
      }
    />
  );
}

type MemberCellProps = {
  label: string;
  names: readonly string[];
  placeholder: string;
  ariaLabel: string;
  disabled: boolean;
  options: readonly Member[];
  selectedIds: readonly string[];
  multiple: boolean;
  cellKey: string;
  topStatusButton?: SearchListStatusButton;
  onChange: (ids: string[]) => void;
};

function MemberCell({
  label,
  names,
  placeholder,
  ariaLabel,
  disabled,
  options,
  selectedIds,
  multiple,
  cellKey,
  topStatusButton,
  onChange,
}: MemberCellProps) {
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(300, topStatusButton === undefined ? 286 : 326);
  const statusActive = topStatusButton?.active ?? false;

  if (disabled) {
    return (
      <div
        data-project-management-cell={cellKey}
        className="flex min-h-11 min-w-0 items-center justify-start overflow-hidden px-2 py-3 text-left"
      >
        {statusActive ? (
          <span className={PM_TABLE_TAG_CLASS + " bg-[#f02b2b] font-semibold text-white"}>{label}</span>
        ) : label === "" ? null : (
          <PmMemberChips names={names} max={6} />
        )}
      </div>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-project-management-cell={cellKey}
        onClick={() => {
          setOpen((previous) => !previous);
        }}
        className="flex min-h-11 w-full min-w-0 items-center justify-start gap-1 px-2 py-3 text-left text-xs leading-5 outline-none transition hover:bg-blue-50/40 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500"
      >
        {statusActive ? (
          <span className={PM_TABLE_TAG_CLASS + " bg-[#f02b2b] font-semibold text-white"}>{label}</span>
        ) : label === "" ? (
          <span className="min-w-0 truncate text-zinc-300">{placeholder}</span>
        ) : (
          <PmMemberChips names={names} max={6} />
        )}
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3 w-3 shrink-0 text-zinc-300">
          <path d="M6 9.5l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && position !== null
        ? createPortal(
            <div
              ref={popoverRef}
              data-focus-scope="true"
              className="fixed z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
              style={{ top: position.top, left: position.left, width: position.width }}
            >
              <MemberSearchList
                options={options}
                value=""
                selectedIds={selectedIds}
                ariaLabel={ariaLabel}
                topStatusButton={
                  topStatusButton === undefined
                    ? undefined
                    : {
                        ...topStatusButton,
                        onToggle: () => {
                          topStatusButton.onToggle();
                          setOpen(false);
                        },
                      }
                }
                onPick={(member) => {
                  if (multiple) {
                    onChange(
                      selectedIds.includes(member.id)
                        ? selectedIds.filter((id) => id !== member.id)
                        : [...selectedIds, member.id],
                    );
                    return;
                  }
                  onChange([member.id]);
                  setOpen(false);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

type MethodCellProps = {
  value: ProjectManagementMethod | "";
  label: string;
  placeholder: string;
  ariaLabel: string;
  disabled: boolean;
  cellKey: string;
  labelOf: (value: ProjectManagementMethod) => string;
  onChange: (value: ProjectManagementMethod) => void;
};

function MethodCell({
  value,
  label,
  placeholder,
  ariaLabel,
  disabled,
  cellKey,
  labelOf,
  onChange,
}: MethodCellProps) {
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(200, 250);

  if (disabled) {
    return (
      <div data-project-management-cell={cellKey} className="flex min-h-11 items-center justify-start px-2 py-3 text-left text-xs leading-5">
        {value === "" ? null : (
          <span className={PM_TABLE_TAG_CLASS + " " + METHOD_META[value].chipClass}>
            {label}
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-project-management-cell={cellKey}
        onClick={() => {
          setOpen((previous) => !previous);
        }}
        className="flex min-h-11 w-full min-w-0 items-center justify-start gap-1 px-2 py-3 text-left text-xs leading-5 outline-none transition hover:bg-blue-50/40 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500"
      >
        {value === "" ? (
          <span className="truncate text-zinc-300">{placeholder}</span>
        ) : (
          <span className={PM_TABLE_TAG_CLASS + " " + METHOD_META[value].chipClass}>
            {label}
          </span>
        )}
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3 w-3 shrink-0 text-zinc-300">
          <path d="M6 9.5l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && position !== null
        ? createPortal(
            <div
              ref={popoverRef}
              role="listbox"
              aria-label={ariaLabel}
              className="fixed z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
              style={{ top: position.top, left: position.left, width: position.width }}
            >
              {METHOD_KEYS.map((key) => {
                const selected = value === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(key);
                      setOpen(false);
                    }}
                    className={"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition " + (selected ? "bg-blue-50" : "hover:bg-zinc-100")}
                  >
                    <span className={"truncate rounded px-1.5 py-0.5 text-[11px] font-medium " + METHOD_META[key].chipClass}>
                      {labelOf(key)}
                    </span>
                    {selected ? (
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ml-auto h-3.5 w-3.5 shrink-0 text-blue-600">
                        <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function BlankCell({ label, cellKey }: { label: string; cellKey: string }) {
  return <div aria-label={label} data-project-management-cell={cellKey} className="min-h-11" />;
}

function ReadOnlyStageCell({ stageName, value, label, cellKey }: { stageName: string; value: string; label: string; cellKey: string }) {
  return (
    <div
      aria-label={label}
      data-project-management-cell={cellKey}
      title={value === "" ? undefined : value}
      className="flex min-h-11 min-w-0 items-center justify-start px-2 py-3 text-left"
    >
      {value === "" ? (
        <span className="text-zinc-300">—</span>
      ) : (
        <span className={PM_TABLE_TAG_CLASS + " " + pmStageTagClass(stageName)}>
          {value}
        </span>
      )}
    </div>
  );
}

function ReadOnlyCell({ value, label, cellKey }: { value: string; label: string; cellKey: string }) {
  return (
    <div
      aria-label={label}
      data-project-management-cell={cellKey}
      title={value === "" ? undefined : value}
      className="min-h-11 truncate px-2 py-3 text-left text-xs leading-5 text-zinc-600"
    >
      {value}
    </div>
  );
}

function EditableDateCell({
  valueIso,
  display,
  ariaLabel,
  cellKey,
  onChange,
  showAuto = false,
}: {
  valueIso: string;
  display: string;
  ariaLabel: string;
  cellKey: string;
  onChange: (iso: string) => void;
  showAuto?: boolean;
}) {
  return (
    <div data-project-management-cell={cellKey} className="flex min-h-11 items-stretch">
      <InlineDateCell
        valueIso={valueIso}
        ariaLabel={ariaLabel}
        bare
        showAuto={showAuto}
        triggerClassName="min-h-11 w-full justify-start px-2 py-3 text-left text-xs leading-5 tabular-nums text-zinc-600 hover:bg-blue-50/40"
        display={display === "" ? <span className="text-zinc-300">—</span> : display}
        onChange={onChange}
      />
    </div>
  );
}

function DaysCell({
  value,
  ariaLabel,
  cellKey,
  onChange,
}: {
  value: number | null;
  ariaLabel: string;
  cellKey: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <div data-project-management-cell={cellKey} className="flex min-h-11 items-stretch">
      <InlineCell
        ariaLabel={ariaLabel}
        width={220}
        height={178}
        bare
        triggerClassName="min-h-11 w-full justify-start px-2 py-3 text-left text-xs leading-5 tabular-nums text-zinc-600 hover:bg-blue-50/40"
        display={value === null ? <span className="text-zinc-300">—</span> : String(value)}
        render={(close) => (
          <DaysEditor
            value={value}
            onCancel={close}
            onSave={(next) => {
              onChange(next);
              close();
            }}
          />
        )}
      />
    </div>
  );
}

function DaysEditor({
  value,
  onSave,
  onCancel,
}: {
  value: number | null;
  onSave: (value: number | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [text, setText] = useState(value === null ? "" : String(value));
  const trimmed = text.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const invalid = trimmed !== "" && (parsed === null || !Number.isInteger(parsed) || parsed < 0);

  return (
    <div className="p-3">
      <input
        autoFocus
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={text}
        aria-label={t("pm.field.daysAria")}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !invalid) {
            onSave(parsed);
          }
          if (event.key === "Escape") {
            onCancel();
          }
        }}
        className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10"
      />
      {invalid ? <p className="mt-1.5 text-[11px] text-rose-500">{t("ie.intError")}</p> : null}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            onSave(null);
          }}
          className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-100"
        >
          {t("pm.field.auto")}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 transition hover:bg-zinc-100"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={invalid}
            onClick={() => {
              onSave(parsed);
            }}
            className="rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

type Notice = { kind: ToastKind; text: string };


type ProjectManagementColumnHeaderProps = {
  column: PmColumn;
  isFirst: boolean;
  textFilters: Partial<Record<PmTextColumnKey, string>>;
  multiFilters: Partial<Record<PmMultiColumnKey, string[]>>;
  methodFilter: ProjectManagementMethod | "";
  dateSort: PmDateSort | null;
  multiOptions: Record<PmMultiColumnKey, readonly PmFilterOption[]>;
  methodOptions: readonly PmFilterOption[];
  onTextFilterChange: (key: PmTextColumnKey, value: string) => void;
  onMultiFilterChange: (key: PmMultiColumnKey, values: string[]) => void;
  onMethodFilterChange: (value: ProjectManagementMethod | "") => void;
  onDateSortChange: (key: PmDateColumnKey, direction: "asc" | "desc" | null) => void;
};

function ProjectManagementColumnHeader({
  column,
  isFirst,
  textFilters,
  multiFilters,
  methodFilter,
  dateSort,
  multiOptions,
  methodOptions,
  onTextFilterChange,
  onMultiFilterChange,
  onMethodFilterChange,
  onDateSortChange,
}: ProjectManagementColumnHeaderProps) {
  const t = useT();
  const label = t(column.labelKey);
  const kind = FILTER_KIND_BY_COLUMN[column.key];
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(452, 440, "rightEdge");
  const [optionQuery, setOptionQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setOptionQuery("");
    }
  }, [open]);

  const textValue = isTextColumnKey(column.key) ? textFilters[column.key] ?? "" : "";
  const selectedValues = isMultiColumnKey(column.key) ? multiFilters[column.key] ?? [] : [];
  const filterOptions = isMultiColumnKey(column.key) ? multiOptions[column.key] : [];
  const visibleOptions = filterOptions.filter(
    (option) => optionQuery.trim() === "" || includesFilterText(option.label, optionQuery.trim()),
  );
  const sortDirection = isDateColumnKey(column.key) && dateSort?.key === column.key ? dateSort.direction : null;
  const active =
    (isTextColumnKey(column.key) && textValue.trim() !== "") ||
    (isMultiColumnKey(column.key) && selectedValues.length > 0) ||
    (column.key === "method" && methodFilter !== "") ||
    (isDateColumnKey(column.key) && sortDirection !== null);

  const clearFilter = (): void => {
    if (isTextColumnKey(column.key)) {
      onTextFilterChange(column.key, "");
      return;
    }
    if (isMultiColumnKey(column.key)) {
      onMultiFilterChange(column.key, []);
      return;
    }
    if (isDateColumnKey(column.key)) {
      onDateSortChange(column.key, null);
      return;
    }
    if (column.key === "method") {
      onMethodFilterChange("");
    }
  };

  const toggleOption = (value: string): void => {
    if (!isMultiColumnKey(column.key)) {
      return;
    }
    onMultiFilterChange(
      column.key,
      selectedValues.includes(value)
        ? selectedValues.filter((selected) => selected !== value)
        : [...selectedValues, value],
    );
  };

  const chooseMethod = (value: ProjectManagementMethod | ""): void => {
    onMethodFilterChange(value);
    setOpen(false);
  };

  const chooseDateSort = (direction: "asc" | "desc" | null): void => {
    if (!isDateColumnKey(column.key)) {
      return;
    }
    onDateSortChange(column.key, direction);
    setOpen(false);
  };

  const clearButton = (
    <button
      type="button"
      disabled={!active}
      onClick={clearFilter}
      className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-35"
    >
      {t("pm.filter.clear")}
    </button>
  );

  const conditionCard = (query: string, onQueryChange: (value: string) => void, dataKey: string) => (
    <div className="m-3 rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex h-10 items-center justify-between px-3">
        <span className="flex items-center gap-1 text-xs font-medium text-zinc-600">
          {t("pm.filter.contains")}
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3 w-3 text-zinc-500">
            <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 text-zinc-400">
          <circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="m15 15 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </div>
      <div className="border-t border-zinc-100 p-2">
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
          >
            <circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="m15 15 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            autoFocus
            type="text"
            value={query}
            data-project-management-filter-search={dataKey}
            onChange={(event) => {
              onQueryChange(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                setOpen(false);
              }
            }}
            placeholder={t("pm.filter.searchPlaceholder", { column: label })}
            className="h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 pl-8 pr-2 text-sm text-zinc-700 outline-none transition placeholder:text-zinc-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-200"
          />
        </div>
      </div>
    </div>
  );

  return (
    <span
      role="columnheader"
      data-project-management-column={column.key}
      title={kind === "none" ? label : t("pm.filter.aria", { column: label })}
      className={
        "relative flex self-stretch whitespace-nowrap " +
        (isFirst ? "" : "border-l border-zinc-300 ")
      }
    >
      {kind === "none" ? (
        <span className="flex h-full items-center justify-start px-2">
          {label}
        </span>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t("pm.filter.aria", { column: label })}
          data-project-management-filter-trigger={column.key}
          onClick={() => {
            setOpen((previous) => !previous);
          }}
          className={
            "flex h-full w-full min-w-0 items-center justify-start gap-1 px-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 " +
            (open
              ? "bg-blue-50 text-blue-700 ring-2 ring-inset ring-blue-500 "
              : active
                ? "bg-blue-50/80 text-blue-700 "
                : "text-zinc-500 hover:bg-blue-50/70 hover:text-zinc-700 ")
          }
        >
          <span className="truncate">{label}</span>
          {sortDirection === null ? (
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={"h-3 w-3 shrink-0 " + (active ? "text-blue-600" : "text-zinc-400")}>
              <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span aria-label={t("pm.filter.active")} className="text-[11px] font-semibold leading-none text-blue-600">
              {sortDirection === "asc" ? "↑" : "↓"}
            </span>
          )}
          {active && kind !== "date" ? <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" /> : null}
        </button>
      )}

      {open && position !== null
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={t("pm.filter.title", { column: label })}
              data-project-management-filter-popover={column.key}
              className="fixed z-50 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.18)]"
              style={{ top: position.top, left: position.left, width: position.width }}
            >
              <div className="flex h-14 items-center justify-between border-b border-zinc-100 px-4">
                <span className="text-sm font-semibold text-zinc-800">{t("pm.filter.title", { column: label })}</span>
                <span aria-hidden="true" className="flex items-center gap-3 text-zinc-400">
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                    <path d="m8 4 8 7-4 4-3-3V4Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="m9 15-4 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                    <circle cx="5" cy="12" r="1.4" />
                    <circle cx="12" cy="12" r="1.4" />
                    <circle cx="19" cy="12" r="1.4" />
                  </svg>
                </span>
              </div>

              {kind === "text" ? (
                <>
                  {conditionCard(textValue, (value) => {
                    if (isTextColumnKey(column.key)) {
                      onTextFilterChange(column.key, value);
                    }
                  }, column.key)}
                  <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-4 py-2.5">
                    <span className="text-[11px] text-zinc-400">{t("pm.filter.textHint")}</span>
                    {clearButton}
                  </div>
                </>
              ) : null}

              {kind === "multi" ? (
                <>
                  {conditionCard(optionQuery, setOptionQuery, column.key)}
                  <div className="px-4 pb-1 text-xs text-zinc-500">{t("pm.filter.choose")}</div>
                  <div role="listbox" aria-multiselectable="true" className="max-h-72 overflow-y-auto px-2 pb-2">
                    {visibleOptions.map((option) => {
                      const selected = selectedValues.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            toggleOption(option.value);
                          }}
                          className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left text-sm text-zinc-700 transition hover:bg-blue-50/70"
                        >
                          <span
                            className={
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition " +
                              (selected ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 bg-white")
                            }
                          >
                            {selected ? (
                              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3 w-3">
                                <path d="m5 12 4.5 4.5L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : null}
                          </span>
                          <span className={PM_TABLE_TAG_CLASS + " " + memberFilterToneOf(option.value)}>
                            {option.label}
                          </span>
                        </button>
                      );
                    })}
                    {visibleOptions.length === 0 ? (
                      <div className="px-2 py-5 text-center text-xs text-zinc-400">
                        {t("pm.filter.emptyOptions")}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-4 py-2.5">
                    <span className="text-[11px] text-zinc-400">
                      {t("pm.filter.selectedCount", { n: selectedValues.length })}
                    </span>
                    {clearButton}
                  </div>
                </>
              ) : null}

              {kind === "method" ? (
                <>
                  <div className="px-4 pb-1 pt-3 text-xs text-zinc-500">{t("pm.filter.choose")}</div>
                  <div role="listbox" className="max-h-72 overflow-y-auto p-2">
                    <button
                      type="button"
                      role="option"
                      aria-selected={methodFilter === ""}
                      onClick={() => {
                        chooseMethod("");
                      }}
                      className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left text-sm text-zinc-700 transition hover:bg-blue-50/70"
                    >
                      <span className="w-3 text-center text-blue-600">{methodFilter === "" ? "✓" : ""}</span>
                      <span>{t("pm.filter.all")}</span>
                    </button>
                    {methodOptions.map((option) => {
                      const selected = methodFilter === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            chooseMethod(option.value as ProjectManagementMethod);
                          }}
                          className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left text-sm text-zinc-700 transition hover:bg-blue-50/70"
                        >
                          <span className="w-3 text-center text-blue-600">{selected ? "✓" : ""}</span>
                          <span className={PM_TABLE_TAG_CLASS + " " + METHOD_META[option.value as ProjectManagementMethod].chipClass}>
                            {option.label}
                          </span>
                        </button>
                      );
                    })}
                    {methodOptions.length === 0 ? (
                      <div className="px-2 py-5 text-center text-xs text-zinc-400">
                        {t("pm.filter.emptyOptions")}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex justify-end border-t border-zinc-100 px-4 py-2.5">{clearButton}</div>
                </>
              ) : null}

              {kind === "date" ? (
                <>
                  <div className="p-3">
                    <div className="rounded-xl border border-zinc-200 p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                      <button
                        type="button"
                        onClick={() => {
                          chooseDateSort(null);
                        }}
                        className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-blue-50/70"
                      >
                        <span className="w-3 text-center text-blue-600">{sortDirection === null ? "✓" : ""}</span>
                        <span>{t("pm.filter.default")}</span>
                      </button>
                      <div className="my-1 border-t border-zinc-100" />
                      <button
                        type="button"
                        onClick={() => {
                          chooseDateSort("asc");
                        }}
                        className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-blue-50/70"
                      >
                        <span className="w-3 text-center text-blue-600">{sortDirection === "asc" ? "✓" : "↑"}</span>
                        <span>{t("pm.filter.asc")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          chooseDateSort("desc");
                        }}
                        className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-blue-50/70"
                      >
                        <span className="w-3 text-center text-blue-600">{sortDirection === "desc" ? "✓" : "↓"}</span>
                        <span>{t("pm.filter.desc")}</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-4 py-2.5">
                    <span className="text-[11px] text-zinc-400">{t("pm.filter.dateHint")}</span>
                    {clearButton}
                  </div>
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
const memberDisplayNames = (
  ids: readonly string[],
  names: ReadonlyArray<string | null>,
  directory: readonly DirectoryUser[],
): string[] =>
  ids.map((id, index) => names[index] ?? directory.find((user) => user.id === id)?.displayName ?? id);
type PmGanttItem = {
  row: PmRow;
  start: string | null;
  end: string | null;
  days: number | null;
  resourceMode: PmGanttResourceMode;
};

type PmGanttGroupKind = "person" | "handedOver" | "unassigned";

type PmGanttRole = "manager" | "engineer";

type PmGanttGroup = {
  key: string;
  label: string;
  kind: PmGanttGroupKind;
  roles: PmGanttRole[];
  items: PmGanttItem[];
};

type PmGanttColumn = {
  key: "rowNo" | "code" | "name" | "manager" | "engineer" | "method" | "dates" | "stage" | "location";
  minWidth: number;
  maxWidth: number;
  labelKey: TextKey | null;
};

const PM_GANTT_COLUMNS: readonly PmGanttColumn[] = [
  { key: "rowNo", minWidth: 24, maxWidth: 24, labelKey: null },
  { key: "code", minWidth: 128, maxWidth: 150, labelKey: "pm.column.code" },
  { key: "name", minWidth: 84, maxWidth: 104, labelKey: "pm.column.name" },
  { key: "manager", minWidth: 48, maxWidth: 72, labelKey: "pm.column.manager" },
  { key: "engineer", minWidth: 54, maxWidth: 80, labelKey: "pm.column.engineer" },
  { key: "method", minWidth: 50, maxWidth: 66, labelKey: "pm.column.method" },
  { key: "dates", minWidth: 72, maxWidth: 84, labelKey: "pm.column.implementationWindow" },
  { key: "stage", minWidth: 30, maxWidth: 70, labelKey: "pm.column.stageShort" },
  { key: "location", minWidth: 30, maxWidth: 56, labelKey: "pm.column.locationShort" },
];

const PM_GANTT_MIN_TABLE_WIDTH = 320;
const PM_GANTT_OVERFLOW_WIDTH = 32;
/** 持久化的是 1 倍档位下的表宽基准值，渲染时按当前屏幕的甘特缩放倍率换算。 */
const PM_GANTT_TABLE_WIDTH_STORAGE_KEY = "libiaolink.pm.gantt.tableWidth";

type PmGanttColumnLayoutEntry = {
  column: PmGanttColumn;
  width: number;
};

const pmGanttClampWidth = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const pmGanttSetScrollLeft = (viewport: HTMLDivElement, value: number): number => {
  const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  viewport.scrollLeft = pmGanttClampWidth(value, 0, maxScroll);
  return viewport.scrollLeft;
};

const pmGanttReadStoredTableWidth = (): number | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const value = Number(window.localStorage.getItem(PM_GANTT_TABLE_WIDTH_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

const pmGanttStoreTableWidth = (value: number | null): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (value === null) {
      window.localStorage.removeItem(PM_GANTT_TABLE_WIDTH_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PM_GANTT_TABLE_WIDTH_STORAGE_KEY, String(Math.round(value)));
    }
  } catch {
    return;
  }
};

const PM_GANTT_CELL_PADDING = 8;
const PM_GANTT_CELL_SAFETY = 2;
const PM_GANTT_CHIP_PADDING = 8;
const PM_GANTT_CHIP_GAP = 2;
const PM_GANTT_FONT_FAMILY = "Noto Sans SC, Microsoft YaHei, sans-serif";
const PM_GANTT_TEXT_FONT = `400 10px ${PM_GANTT_FONT_FAMILY}`;
const PM_GANTT_CHIP_FONT = `400 9px ${PM_GANTT_FONT_FAMILY}`;
const pmGanttScaledPx = (value: number, scale: number): number => Math.round(value * scale * 10) / 10;
const pmGanttFont = (weight: number, size: number): string => `${weight} ${size}px ${PM_GANTT_FONT_FAMILY}`;
let pmGanttMeasureContext: CanvasRenderingContext2D | null | undefined;

const pmGanttTextWidth = (text: string, font: string = PM_GANTT_TEXT_FONT): number => {
  const normalized = text.trim() === "" ? "—" : text;
  if (typeof document === "undefined") {
    return normalized.length * 7.5;
  }
  if (pmGanttMeasureContext === undefined) {
    pmGanttMeasureContext = document.createElement("canvas").getContext("2d");
  }
  if (pmGanttMeasureContext === null) {
    return normalized.length * 7.5;
  }
  pmGanttMeasureContext.font = font;
  return pmGanttMeasureContext.measureText(normalized).width;
};

const pmGanttTextCellWidth = (
  text: string,
  font: string = PM_GANTT_TEXT_FONT,
  scale = 1,
): number =>
  Math.ceil(pmGanttTextWidth(text, font)) +
  pmGanttScaledPx(PM_GANTT_CELL_PADDING + PM_GANTT_CELL_SAFETY, scale);

const pmGanttChipTextWidth = (
  text: string,
  font: string = PM_GANTT_CHIP_FONT,
  scale = 1,
): number =>
  Math.ceil(pmGanttTextWidth(text, font)) +
  pmGanttScaledPx(PM_GANTT_CHIP_PADDING + PM_GANTT_CELL_SAFETY, scale);

const pmGanttMembersCellWidth = (names: readonly string[], scale = 1): number => {
  const chipFont = pmGanttFont(400, pmGanttScaledPx(9, scale));
  if (names.length === 0) {
    return pmGanttTextCellWidth("—", pmGanttFont(400, pmGanttScaledPx(10, scale)), scale);
  }
  const visible = names.slice(0, 2);
  const rest = names.length - visible.length;
  const chipWidths = visible.map((name) => pmGanttChipTextWidth(name, chipFont, scale));
  if (rest > 0) {
    chipWidths.push(pmGanttChipTextWidth("+" + String(rest), chipFont, scale));
  }
  return chipWidths.reduce((total, width) => total + width, 0) +
    pmGanttScaledPx(PM_GANTT_CHIP_GAP, scale) * Math.max(0, chipWidths.length - 1) +
    pmGanttScaledPx(PM_GANTT_CELL_PADDING, scale);
};
type PmGanttScale = "week" | "month" | "quarter" | "year";

const PM_GANTT_SCALES: Record<
  PmGanttScale,
  {
    labelKey: TextKey;
    dayWidth: number;
    minDays: number;
    paddingDays: number;
    gridDays: number;
  }
> = {
  week: { labelKey: "pm.gantt.scale.week", dayWidth: 44, minDays: 28, paddingDays: 4, gridDays: 1 },
  month: { labelKey: "pm.gantt.scale.month", dayWidth: 22, minDays: 90, paddingDays: 7, gridDays: 7 },
  quarter: { labelKey: "pm.gantt.scale.quarter", dayWidth: 9, minDays: 180, paddingDays: 14, gridDays: 7 },
  year: { labelKey: "pm.gantt.scale.year", dayWidth: 4.5, minDays: 365, paddingDays: 30, gridDays: 30.44 },
};
const PM_GANTT_SCALE_KEYS: readonly PmGanttScale[] = ["week", "month", "quarter", "year"];
type PmGanttTimeFilter = {
  startIso: string;
  endIso: string;
  period: PmGanttScale;
  anchorIso: string;
};
const PM_GANTT_INACTIVE_STAGE_KEYS = new Set(["not_started", "archived", "terminated"]);

const pmGanttDateWithMonthOffset = (iso: string, offsetMonths: number): string => {
  const date = new Date(pmGanttTimeOf(iso));
  const day = date.getUTCDate();
  const targetMonthEnd = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths + 1, 0),
  );
  targetMonthEnd.setUTCDate(Math.min(day, targetMonthEnd.getUTCDate()));
  return pmGanttIsoOf(targetMonthEnd.getTime());
};

const pmGanttPeriodRangeOf = (
  scale: PmGanttScale,
  anchorIso: string,
): PmGanttTimeFilter => {
  if (scale === "week") {
    return {
      startIso: pmGanttAddDays(anchorIso, -7),
      endIso: pmGanttAddDays(anchorIso, 7),
      period: scale,
      anchorIso,
    };
  }
  const monthOffset = scale === "month" ? 1 : scale === "quarter" ? 3 : 12;
  return {
    startIso: pmGanttDateWithMonthOffset(anchorIso, -monthOffset),
    endIso: pmGanttDateWithMonthOffset(anchorIso, monthOffset),
    period: scale,
    anchorIso,
  };
};

const pmGanttShiftedPeriodRangeOf = (
  range: PmGanttTimeFilter,
  direction: -1 | 1,
): PmGanttTimeFilter => {
  if (range.period === "week") {
    return pmGanttPeriodRangeOf(range.period, pmGanttAddDays(range.anchorIso, direction * 7));
  }
  const monthOffset = range.period === "month" ? 1 : range.period === "quarter" ? 3 : 12;
  return pmGanttPeriodRangeOf(
    range.period,
    pmGanttDateWithMonthOffset(range.anchorIso, direction * monthOffset),
  );
};

const pmGanttRowIntersectsRange = (row: PmRow, range: PmGanttTimeFilter): boolean => {
  const itemRange = pmGanttDateRangeOf(row);
  return itemRange.start !== null && itemRange.end !== null && itemRange.start <= range.endIso && itemRange.end >= range.startIso;
};
const PM_GANTT_HEADER_HEIGHT = 46;
const PM_GANTT_GROUP_HEIGHT = 30;
const PM_GANTT_ROW_HEIGHT = 30;
const PM_GANTT_GROUP_BAR_HEIGHT = 24;
const PM_GANTT_DAY_MS = 86_400_000;
const PM_GANTT_BAR_LABEL_GAP = 6;
const PM_GANTT_BAR_LABEL_MAX_WIDTH = 260;
const PM_GANTT_UI_BASE_WIDTH = 1440;
const PM_GANTT_UI_WIDE_WIDTH = 2560;
const PM_GANTT_UI_MAX_SCALE = 1.9;

const pmGanttResponsiveScale = (viewportWidth: number): number => {
  const width =
    viewportWidth > 0
      ? viewportWidth
      : typeof window === "undefined"
        ? PM_GANTT_UI_BASE_WIDTH
        : window.innerWidth;
  const wideProgress = pmGanttClampWidth(
    (width - PM_GANTT_UI_BASE_WIDTH) / (PM_GANTT_UI_WIDE_WIDTH - PM_GANTT_UI_BASE_WIDTH),
    0,
    1,
  );
  return Math.round((1 + (PM_GANTT_UI_MAX_SCALE - 1) * wideProgress) * 20) / 20;
};

const pmGanttVisualMetricsOf = (scale: number) => {
  const px = (value: number): number => pmGanttScaledPx(value, scale);
  const cellSize = px(10);
  const tagSize = px(9);
  const headerSize = px(9);
  const groupNameSize = px(11);
  const groupMetaSize = px(10);
  const timelinePrimarySize = px(13);
  const timelineWeekDaySize = px(12);
  const timelineDaySize = px(10);
  const availableSize = px(11);
  const barSize = px(10);
  const barMetaSize = px(9);
  return {
    scale,
    cellSize,
    tagSize,
    headerSize,
    groupNameSize,
    groupMetaSize,
    timelinePrimarySize,
    timelineWeekDaySize,
    timelineDaySize,
    availableSize,
    barSize,
    barMetaSize,
    tagLeading: px(16),
    groupNameLeading: px(16),
    headerHeight: px(PM_GANTT_HEADER_HEIGHT),
    headerRowHeight: px(PM_GANTT_HEADER_HEIGHT / 2),
    groupHeight: px(PM_GANTT_GROUP_HEIGHT),
    rowHeight: px(PM_GANTT_ROW_HEIGHT),
    groupBarHeight: px(PM_GANTT_GROUP_BAR_HEIGHT),
    taskBarHeight: px(24),
    groupStatusHeight: px(18),
    groupLabelMaxWidth: px(160),
    memberMaxWidth: px(180),
    availableLabelMinWidth: px(42),
    cellPaddingX: px(4),
    chipGap: px(2),
    barLabelHeight: px(20),
    minTableWidth: px(PM_GANTT_MIN_TABLE_WIDTH),
    overflowWidth: px(PM_GANTT_OVERFLOW_WIDTH),
    expandButtonSize: px(20),
    expandIconSize: px(14),
    resizerWidth: px(20),
    resizerHeight: px(36),
    toolbarTitleSize: px(14),
    toolbarControlSize: px(12),
    toolbarIconButtonSize: px(32),
    toolbarControlHeight: px(28),
    toolbarScaleButtonMinWidth: px(36),
    toolbarPaddingX: px(16),
    toolbarPaddingY: px(10),
    toolbarGap: px(12),
  };
};

const pmGanttGridStyle = (dayWidth: number, gridDays: number): { backgroundImage: string; backgroundSize: string } => ({
  backgroundImage: "linear-gradient(to right, rgba(228,228,231,0.9) 1px, transparent 1px)",
  backgroundSize: dayWidth * gridDays + "px 100%",
});

type PmGanttBarLabelPlacement = {
  edge: "left" | "right" | null;
  left: number;
  maxWidth: number;
};

const pmGanttBarLabelPlacement = (
  barLeft: number,
  barWidth: number,
  scrollLeft: number,
  viewportWidth: number,
  scale = 1,
): PmGanttBarLabelPlacement | null => {
  const gap = pmGanttScaledPx(PM_GANTT_BAR_LABEL_GAP, scale);
  const maxLabelWidth = pmGanttScaledPx(PM_GANTT_BAR_LABEL_MAX_WIDTH, scale);
  if (barWidth <= 0 || viewportWidth <= gap * 2) {
    return null;
  }
  const visibleStart = Math.max(0, scrollLeft);
  const visibleEnd = visibleStart + viewportWidth;
  const barEnd = barLeft + barWidth;
  const edgeMaxWidth = Math.min(maxLabelWidth, Math.max(0, viewportWidth - gap * 2));
  if (edgeMaxWidth < pmGanttScaledPx(72, scale)) {
    return null;
  }
  if (barEnd <= visibleStart) {
    return {
      edge: "left",
      left: visibleStart + gap,
      maxWidth: edgeMaxWidth,
    };
  }
  if (barLeft >= visibleEnd) {
    return {
      edge: "right",
      left: visibleEnd - edgeMaxWidth - gap,
      maxWidth: edgeMaxWidth,
    };
  }
  const visibleBarStart = Math.max(barLeft, visibleStart);
  return {
    edge: null,
    left: visibleBarStart + gap,
    maxWidth: edgeMaxWidth,
  };
};

const pmGanttTimeOf = (iso: string): number => Date.parse(iso + "T00:00:00Z");

const pmGanttIsoOf = (time: number): string => new Date(time).toISOString().slice(0, 10);

const pmGanttAddDays = (iso: string, days: number): string => pmGanttIsoOf(pmGanttTimeOf(iso) + days * PM_GANTT_DAY_MS);

const pmGanttTodayIso = (): string => {
  const now = new Date();
  return (
    String(now.getFullYear()) +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0")
  );
};

const pmGanttIntlLocale = (locale: string): string => {
  if (locale === "zh") {
    return "zh-CN";
  }
  if (locale === "ja") {
    return "ja-JP";
  }
  if (locale === "ko") {
    return "ko-KR";
  }
  return "en-US";
};

const pmGanttShortDate = (iso: string | null): string | null => {
  if (iso === null || iso.trim() === "") {
    return null;
  }
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return match === null ? iso : match[1] + "-" + match[2];
};

const pmGanttVisibleRangeLabel = (startIso: string, endIso: string): string =>
  startIso.slice(0, 4) === endIso.slice(0, 4)
    ? startIso.slice(5) + " – " + endIso.slice(5)
    : startIso + " – " + endIso;

const pmGanttDateRangeOf = (row: PmRow): {
  start: string | null;
  end: string | null;
  title: string;
} => {
  const rawStart = effectiveDateOf(row, "start");
  const rawEnd = effectiveDateOf(row, "end");
  const start = rawStart ?? rawEnd;
  const end = rawEnd ?? rawStart;
  return {
    start,
    end,
    title: start === null && end === null ? "" : (start ?? "—") + " → " + (end ?? "—"),
  };
};

const pmGanttItemOf = (row: PmRow): PmGanttItem => {
  const rawStart = effectiveDateOf(row, "start");
  const rawEnd = effectiveDateOf(row, "end");
  const start = rawStart ?? rawEnd;
  const end = rawEnd ?? rawStart;
  return {
    row,
    start,
    end,
    days: start === null || end === null ? effectiveDaysOf(row) : inclusiveDaysBetween(start, end),
    resourceMode: pmGanttResourceModeOf(row),
  };
};

type PmGanttOccupancySegment = {
  startIndex: number;
  endIndex: number;
  count: number;
  itemIndexes: number[];
};

type PmGanttAvailableSegment = {
  startIndex: number;
  endIndex: number;
};

type PmGanttOccupancy = {
  busySegments: PmGanttOccupancySegment[];
  parallelSegments: PmGanttOccupancySegment[];
  availableSegments: PmGanttAvailableSegment[];
  occupiedDays: number;
  parallelDays: number;
  conflictDays: number;
};

const pmGanttDailyCountsOf = (
  dayCount: number,
  ranges: ReadonlyArray<{ startIndex: number; endIndex: number }>,
): number[] => {
  const differences = new Array<number>(dayCount + 1).fill(0);
  ranges.forEach((range) => {
    differences[range.startIndex] += 1;
    differences[range.endIndex + 1] -= 1;
  });
  const counts = new Array<number>(dayCount).fill(0);
  let running = 0;
  for (let index = 0; index < dayCount; index += 1) {
    running += differences[index];
    counts[index] = running;
  }
  return counts;
};

const pmGanttOccupancyOf = (
  items: readonly PmGanttItem[],
  timelineStartIso: string,
  dayCount: number,
): PmGanttOccupancy => {
  if (dayCount <= 0) {
    return {
      busySegments: [],
      parallelSegments: [],
      availableSegments: [],
      occupiedDays: 0,
      parallelDays: 0,
      conflictDays: 0,
    };
  }
  const rangeStart = pmGanttTimeOf(timelineStartIso);
  const blockingRanges: Array<{ itemIndex: number; startIndex: number; endIndex: number }> = [];
  const parallelRanges: Array<{ itemIndex: number; startIndex: number; endIndex: number }> = [];
  items.forEach((item, itemIndex) => {
    if (item.start === null || item.end === null) {
      return;
    }
    const rawStart = Math.round((pmGanttTimeOf(item.start) - rangeStart) / PM_GANTT_DAY_MS);
    const rawEnd = Math.round((pmGanttTimeOf(item.end) - rangeStart) / PM_GANTT_DAY_MS);
    const startIndex = Math.max(0, rawStart);
    const endIndex = Math.min(dayCount - 1, rawEnd);
    if (startIndex <= endIndex) {
      const range = { itemIndex, startIndex, endIndex };
      (item.resourceMode === "parallel" ? parallelRanges : blockingRanges).push(range);
    }
  });
  const blockingCounts = pmGanttDailyCountsOf(dayCount, blockingRanges);
  const parallelCounts = pmGanttDailyCountsOf(dayCount, parallelRanges);
  const busySegments: PmGanttOccupancySegment[] = [];
  const parallelSegments: PmGanttOccupancySegment[] = [];
  const availableSegments: PmGanttAvailableSegment[] = [];
  let occupiedDays = 0;
  let parallelDays = 0;
  let conflictDays = 0;
  let cursor = 0;
  while (cursor < dayCount) {
    const count = blockingCounts[cursor] ?? 0;
    let endIndex = cursor;
    while (endIndex + 1 < dayCount && (blockingCounts[endIndex + 1] ?? 0) === count) {
      endIndex += 1;
    }
    const spanDays = endIndex - cursor + 1;
    if (count === 0) {
      availableSegments.push({ startIndex: cursor, endIndex });
    } else {
      occupiedDays += spanDays;
      if (count > 1) {
        conflictDays += spanDays;
      }
      busySegments.push({
        startIndex: cursor,
        endIndex,
        count,
        itemIndexes: blockingRanges
          .filter((range) => range.startIndex <= endIndex && range.endIndex >= cursor)
          .map((range) => range.itemIndex),
      });
    }
    cursor = endIndex + 1;
  }
  cursor = 0;
  while (cursor < dayCount) {
    const count = parallelCounts[cursor] ?? 0;
    let endIndex = cursor;
    while (endIndex + 1 < dayCount && (parallelCounts[endIndex + 1] ?? 0) === count) {
      endIndex += 1;
    }
    if (count > 0) {
      parallelDays += endIndex - cursor + 1;
      parallelSegments.push({
        startIndex: cursor,
        endIndex,
        count,
        itemIndexes: parallelRanges
          .filter((range) => range.startIndex <= endIndex && range.endIndex >= cursor)
          .map((range) => range.itemIndex),
      });
    }
    cursor = endIndex + 1;
  }
  return {
    busySegments,
    parallelSegments,
    availableSegments,
    occupiedDays,
    parallelDays,
    conflictDays,
  };
};

const buildPmGanttGroups = (
  rows: readonly PmRow[],
  directory: readonly DirectoryUser[],
  locale: string,
  handedOverLabel: string,
  unassignedLabel: string,
): PmGanttGroup[] => {
  type PmGanttBucket = PmGanttGroup & { seen: Set<string> };
  const people = new Map<string, PmGanttBucket>();
  const handedOver: PmGanttBucket = {
    key: "pm-gantt-handed-over",
    label: handedOverLabel,
    kind: "handedOver",
    roles: [],
    items: [],
    seen: new Set<string>(),
  };
  const unassigned: PmGanttBucket = {
    key: "pm-gantt-unassigned",
    label: unassignedLabel,
    kind: "unassigned",
    roles: [],
    items: [],
    seen: new Set<string>(),
  };
  const addItem = (bucket: PmGanttBucket, item: PmGanttItem): void => {
    if (bucket.seen.has(item.row.clientId)) {
      return;
    }
    bucket.seen.add(item.row.clientId);
    bucket.items.push(item);
  };
  const bucketFor = (id: string, label: string, role: PmGanttRole): PmGanttBucket => {
    let bucket = people.get(id);
    if (bucket === undefined) {
      bucket = {
        key: "pm-gantt-person-" + id,
        label,
        kind: "person",
        roles: [],
        items: [],
        seen: new Set<string>(),
      };
      people.set(id, bucket);
    }
    if (!bucket.roles.includes(role)) {
      bucket.roles.push(role);
    }
    return bucket;
  };

  rows.forEach((row) => {
    if (isEmptyRow(row)) {
      return;
    }
    const item = pmGanttItemOf(row);
    const managerNames = memberDisplayNames(row.managerIds, row.managerNames, directory);
    const engineerNames = memberDisplayNames(
      row.implementationEngineerIds,
      row.implementationEngineerNames,
      directory,
    );
    const seenManagers = new Set<string>();
    row.managerIds.forEach((id, index) => {
      if (seenManagers.has(id)) {
        return;
      }
      seenManagers.add(id);
      addItem(bucketFor(id, managerNames[index] ?? id, "manager"), item);
    });
    if (row.implementationHandedOver) {
      addItem(handedOver, item);
    }
    const seenEngineers = new Set<string>();
    row.implementationEngineerIds.forEach((id, index) => {
      if (seenEngineers.has(id)) {
        return;
      }
      seenEngineers.add(id);
      addItem(bucketFor(id, engineerNames[index] ?? id, "engineer"), item);
    });
    if (
      row.managerIds.length === 0 &&
      row.implementationEngineerIds.length === 0 &&
      !row.implementationHandedOver
    ) {
      addItem(unassigned, item);
    }
  });

  const personGroups = Array.from(people.values())
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      kind: bucket.kind,
      roles: bucket.roles,
      items: bucket.items,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, locale));
  const specialGroups = [handedOver, unassigned]
    .filter((bucket) => bucket.items.length > 0)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      kind: bucket.kind,
      roles: bucket.roles,
      items: bucket.items,
    }));
  return [...personGroups, ...specialGroups];
};

const pmGanttGroupTextTone = (group: PmGanttGroup): string => {
  if (group.kind === "handedOver") {
    return "text-[#f02b2b]";
  }
  if (group.kind === "unassigned") {
    return "text-zinc-500";
  }
  return "text-zinc-900";
};

function PmMemberChips({
  names,
  max = 2,
  compact = false,
}: {
  names: readonly string[];
  max?: number;
  compact?: boolean;
}) {
  if (names.length === 0) {
    return <span className="text-zinc-400">—</span>;
  }
  const visible = names.slice(0, max);
  const rest = names.length - visible.length;
  const chipClass = compact ? PM_GANTT_TAG_CLASS : PM_TABLE_TAG_CLASS;
  return (
    <span
      className={
        "flex min-w-0 items-center overflow-hidden " +
        (compact ? "gap-[var(--pm-gantt-chip-gap,2px)]" : "gap-1")
      }
    >
      {visible.map((name, index) => (
        <span
          key={name + "-" + String(index)}
          title={name}
          className={
            chipClass +
            (compact
              ? " max-w-[var(--pm-gantt-member-max-width,180px)] shrink-0 "
              : " max-w-[180px] shrink-0 ") +
            memberFilterToneOf(name)
          }
        >
          {name}
        </span>
      ))}
      {rest > 0 ? (
        <span
          title={names.join(", ")}
          className={
            compact
              ? "shrink-0 rounded-full bg-zinc-100 px-1.5 py-0 text-[length:var(--pm-gantt-cell-size,10px)] font-medium leading-[var(--pm-gantt-tag-leading,16px)] text-zinc-500"
              : "shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[12px] font-medium text-zinc-500"
          }
        >
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

function PmGanttProjectCells({
  row,
  sequence,
  directory,
  dicts,
  columns,
  hiddenColumnCount,
  hiddenColumnsLabel,
  overflowWidth,
  cellPaddingX,
}: {
  row: PmRow;
  sequence: number;
  directory: readonly DirectoryUser[];
  dicts: Dicts;
  columns: readonly PmGanttColumnLayoutEntry[];
  hiddenColumnCount: number;
  hiddenColumnsLabel: string;
  overflowWidth: number;
  cellPaddingX: number;
}) {
  const t = useT();
  const locale = useLocale();
  const managerNames = memberDisplayNames(row.managerIds, row.managerNames, directory);
  const engineerNames = memberDisplayNames(
    row.implementationEngineerIds,
    row.implementationEngineerNames,
    directory,
  );
  const method = row.implementationMethod;
  const stage = effectiveStageOf(row);
  const stageName = stage === null ? "" : pmStageNameOf(stage);
  const stageLabel = stageName === "" ? "" : stageText(locale, stageName);
  const locationLabel =
    row.region === "" || row.region === "未分类" ? "" : dictLabel(dicts, "region", row.region);
  const dateRange = pmGanttDateRangeOf(row);
  const dateStartLabel = pmGanttShortDate(dateRange.start);
  const dateEndLabel = pmGanttShortDate(dateRange.end);
  const cellClass =
    "flex min-w-0 items-center overflow-hidden whitespace-nowrap border-r border-zinc-200 text-[length:var(--pm-gantt-cell-size,10px)] text-zinc-700";

  return (
    <>
      {columns.map(({ column, width }, columnIndex) => {
        let content: ReactNode = null;
        if (column.key === "rowNo") {
          content = <span className="text-[length:var(--pm-gantt-cell-size,10px)] tabular-nums text-zinc-400">{sequence}</span>;
        } else if (column.key === "code") {
          content = (
            <span className="block truncate font-medium tabular-nums text-zinc-800" title={row.code.trim() === "" ? undefined : row.code}>
              {row.code.trim() === "" ? "—" : row.code}
            </span>
          );
        } else if (column.key === "name") {
          const title = row.name.trim() === "" ? t("pm.board.untitled") : row.name;
          content = (
            <span className="block truncate font-medium text-zinc-800" title={title}>
              {title}
            </span>
          );
        } else if (column.key === "manager") {
          content = <PmMemberChips names={managerNames} compact />;
        } else if (column.key === "engineer") {
          content = row.implementationHandedOver ? (
            <span className="rounded bg-[#f02b2b] px-1.5 py-0 text-[length:var(--pm-gantt-tag-size,9px)] font-medium leading-[var(--pm-gantt-tag-leading,16px)] text-white">
              {t("pm.engineer.handedOver")}
            </span>
          ) : (
            <PmMemberChips names={engineerNames} compact />
          );
        } else if (column.key === "method") {
          content =
            method === "" ? (
              <span className="text-zinc-400">—</span>
            ) : (
              <span className={PM_GANTT_TAG_CLASS + " " + METHOD_META[method].chipClass} title={t(METHOD_META[method].labelKey)}>
                {t(METHOD_META[method].labelKey)}
              </span>
            );
        } else if (column.key === "dates") {
          content =
            dateStartLabel === null && dateEndLabel === null ? (
              <span className="text-zinc-400">—</span>
            ) : (
              <span
                className="flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap text-[length:var(--pm-gantt-tag-size,9px)] font-normal tabular-nums"
                title={dateRange.title === "" ? undefined : dateRange.title}
              >
                <span className="text-sky-700">{dateStartLabel ?? "—"}</span>
                <span className="text-zinc-400">→</span>
                <span className="text-sky-700">{dateEndLabel ?? "—"}</span>
              </span>
            );
        } else if (column.key === "stage") {
          content =
            stageLabel === "" ? (
              <span className="text-zinc-400">—</span>
            ) : (
              <span
                className={
                  PM_GANTT_TAG_CLASS + " " +
                  pmStageTagClass(stageName)
                }
                title={stageLabel}
              >
                {stageLabel}
              </span>
            );
        } else if (column.key === "location") {
          content =
            locationLabel === "" ? (
              <span className="text-zinc-400">—</span>
            ) : (
              <span
                className={PM_GANTT_TAG_CLASS + " " + memberFilterToneOf(locationLabel)}
                title={locationLabel}
              >
                {locationLabel}
              </span>
            );
        }
        return (
          <div
            key={column.key}
            style={{ width, paddingLeft: cellPaddingX, paddingRight: cellPaddingX }}
            className={
              cellClass +
              (column.key === "rowNo" ? " justify-center border-l-0" : "") +
              (columnIndex === columns.length - 1 && hiddenColumnCount === 0 ? " border-r-0" : "")
            }
          >
            {content}
          </div>
        );
      })}
      {hiddenColumnCount > 0 ? (
        <div
          style={{ width: overflowWidth }}
          title={hiddenColumnsLabel}
          className="flex min-w-0 items-center justify-center border-r-0 border-zinc-200 text-[length:var(--pm-gantt-tag-size,9px)] font-normal tabular-nums text-zinc-400"
        >
          +{hiddenColumnCount}
        </div>
      ) : null}
    </>
  );
}

function PmImplementationGantt({
  rows,
  directory,
  dicts,
}: {
  rows: readonly PmRow[];
  directory: readonly DirectoryUser[];
  dicts: Dicts;
}) {
  const t = useT();
  const locale = useLocale();
  const intlLocale = pmGanttIntlLocale(locale);
  const unassignedLabel = t("pm.board.group.unassignedManager");
  const handedOverLabel = t("pm.engineer.handedOver");
  const [ganttTimeFilter, setGanttTimeFilter] = useState<PmGanttTimeFilter | null>(null);
  const [ganttOnlyInProgress, setGanttOnlyInProgress] = useState(false);
  const [ganttTimeFilterOpen, setGanttTimeFilterOpen] = useState(false);
  const ganttTimeFilterPopoverRef = useRef<HTMLDivElement | null>(null);
  const ganttFilteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (
          ganttOnlyInProgress &&
          PM_GANTT_INACTIVE_STAGE_KEYS.has(effectiveStageOf(row) ?? "")
        ) {
          return false;
        }
        return ganttTimeFilter === null || pmGanttRowIntersectsRange(row, ganttTimeFilter);
      }),
    [rows, ganttOnlyInProgress, ganttTimeFilter],
  );
  const groups = useMemo(
    () => buildPmGanttGroups(ganttFilteredRows, directory, locale, handedOverLabel, unassignedLabel),
    [ganttFilteredRows, directory, locale, handedOverLabel, unassignedLabel],
  );
  const [ganttViewportWidth, setGanttViewportWidth] = useState(0);
  const ganttUiScale = pmGanttResponsiveScale(ganttViewportWidth);
  const ganttMetrics = pmGanttVisualMetricsOf(ganttUiScale);
  const ganttCssVariables = {
    "--pm-gantt-cell-size": `${ganttMetrics.cellSize}px`,
    "--pm-gantt-tag-size": `${ganttMetrics.tagSize}px`,
    "--pm-gantt-header-size": `${ganttMetrics.headerSize}px`,
    "--pm-gantt-group-name-size": `${ganttMetrics.groupNameSize}px`,
    "--pm-gantt-group-meta-size": `${ganttMetrics.groupMetaSize}px`,
    "--pm-gantt-timeline-primary-size": `${ganttMetrics.timelinePrimarySize}px`,
    "--pm-gantt-timeline-week-day-size": `${ganttMetrics.timelineWeekDaySize}px`,
    "--pm-gantt-timeline-day-size": `${ganttMetrics.timelineDaySize}px`,
    "--pm-gantt-available-size": `${ganttMetrics.availableSize}px`,
    "--pm-gantt-bar-size": `${ganttMetrics.barSize}px`,
    "--pm-gantt-bar-meta-size": `${ganttMetrics.barMetaSize}px`,
    "--pm-gantt-tag-leading": `${ganttMetrics.tagLeading}px`,
    "--pm-gantt-group-name-leading": `${ganttMetrics.groupNameLeading}px`,
    "--pm-gantt-member-max-width": `${ganttMetrics.memberMaxWidth}px`,
    "--pm-gantt-chip-gap": `${ganttMetrics.chipGap}px`,
    "--pm-gantt-group-label-max-width": `${ganttMetrics.groupLabelMaxWidth}px`,
    "--pm-gantt-toolbar-title-size": `${ganttMetrics.toolbarTitleSize}px`,
    "--pm-gantt-toolbar-control-size": `${ganttMetrics.toolbarControlSize}px`,
  } as CSSProperties;
  const ganttColumnWidths = useMemo(() => {
    const scaledMinWidth = (column: PmGanttColumn): number =>
      Math.round(column.minWidth * ganttUiScale);
    const scaledMaxWidth = (column: PmGanttColumn): number =>
      Math.round(column.maxWidth * ganttUiScale);
    const widths = new Map<PmGanttColumn["key"], number>(
      PM_GANTT_COLUMNS.map((column) => [column.key, scaledMinWidth(column)]),
    );
    const bump = (key: PmGanttColumn["key"], width: number): void => {
      widths.set(key, Math.max(widths.get(key) ?? 0, Math.ceil(width)));
    };
    const textFont = pmGanttFont(400, pmGanttScaledPx(10, ganttUiScale));
    const headerFont = pmGanttFont(500, pmGanttScaledPx(9, ganttUiScale));
    const chipFont = pmGanttFont(400, pmGanttScaledPx(9, ganttUiScale));
    const handedOverFont = pmGanttFont(500, pmGanttScaledPx(9, ganttUiScale));
    PM_GANTT_COLUMNS.forEach((column) => {
      if (column.labelKey !== null) {
        bump(column.key, pmGanttTextCellWidth(t(column.labelKey), headerFont, ganttUiScale));
      }
    });
    groups.forEach((group) => {
      group.items.forEach((item) => {
        const row = item.row;
        bump("code", pmGanttTextCellWidth(row.code.trim() === "" ? "—" : row.code, textFont, ganttUiScale));
        bump("name", pmGanttTextCellWidth(row.name.trim() === "" ? t("pm.board.untitled") : row.name, textFont, ganttUiScale));
        bump(
          "manager",
          pmGanttMembersCellWidth(memberDisplayNames(row.managerIds, row.managerNames, directory), ganttUiScale),
        );
        if (row.implementationHandedOver) {
          bump(
            "engineer",
            pmGanttChipTextWidth(t("pm.engineer.handedOver"), handedOverFont, ganttUiScale),
          );
        } else {
          bump(
            "engineer",
            pmGanttMembersCellWidth(
              memberDisplayNames(row.implementationEngineerIds, row.implementationEngineerNames, directory),
              ganttUiScale,
            ),
          );
        }
        const method = row.implementationMethod;
        bump(
          "method",
          method === ""
            ? pmGanttTextCellWidth("—", textFont, ganttUiScale)
            : pmGanttChipTextWidth(t(METHOD_META[method].labelKey), chipFont, ganttUiScale) +
              pmGanttScaledPx(PM_GANTT_CELL_PADDING, ganttUiScale),
        );
        const dateRange = pmGanttDateRangeOf(row);
        bump(
          "dates",
          pmGanttTextCellWidth(
            (pmGanttShortDate(dateRange.start) ?? "—") +
              " → " +
              (pmGanttShortDate(dateRange.end) ?? "—"),
            textFont,
            ganttUiScale,
          ),
        );
        const stage = effectiveStageOf(row);
        const stageName = stage === null ? "" : pmStageNameOf(stage);
        const stageLabel = stageName === "" ? "" : stageText(locale, stageName);
        bump(
          "stage",
          stageLabel === ""
            ? pmGanttTextCellWidth("—", textFont, ganttUiScale)
            : pmGanttChipTextWidth(stageLabel, chipFont, ganttUiScale) +
              pmGanttScaledPx(PM_GANTT_CELL_PADDING, ganttUiScale),
        );
        const locationLabel =
          row.region === "" || row.region === "未分类" ? "" : dictLabel(dicts, "region", row.region);
        bump(
          "location",
          locationLabel === ""
            ? pmGanttTextCellWidth("—", textFont, ganttUiScale)
            : pmGanttChipTextWidth(locationLabel, chipFont, ganttUiScale) +
              pmGanttScaledPx(PM_GANTT_CELL_PADDING, ganttUiScale),
        );
      });
    });
    return PM_GANTT_COLUMNS.map((column) => {
      const minWidth = scaledMinWidth(column);
      const maxWidth = scaledMaxWidth(column);
      return Math.max(
        minWidth,
        Math.min(maxWidth, widths.get(column.key) ?? minWidth),
      );
    });
  }, [dicts, directory, groups, locale, t, ganttUiScale]);
  const ganttNaturalWidth = ganttColumnWidths.reduce((total, width) => total + width, 0);
  const [ganttWidthOverride, setGanttWidthOverride] = useState<number | null>(pmGanttReadStoredTableWidth);
  const [ganttResizing, setGanttResizing] = useState(false);
  const [ganttResizeHovered, setGanttResizeHovered] = useState(false);
  const ganttResizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const ganttMinWidth = Math.min(ganttMetrics.minTableWidth, ganttNaturalWidth);
  const ganttWidthOverrideAtScale =
    ganttWidthOverride === null ? null : Math.round(ganttWidthOverride * ganttUiScale);
  const ganttTableWidth = Math.round(
    pmGanttClampWidth(ganttWidthOverrideAtScale ?? ganttNaturalWidth, ganttMinWidth, ganttNaturalWidth),
  );
  const ganttScrollShellRef = useRef<HTMLDivElement | null>(null);
  const ganttScrollViewportRef = useRef<HTMLDivElement | null>(null);
  const [ganttScrollLeft, setGanttScrollLeft] = useState(0);
  const [ganttPanActive, setGanttPanActive] = useState(false);
  const ganttPanRef = useRef<{
    pointerId: number;
    originX: number;
    baseLeft: number;
    moved: boolean;
  } | null>(null);
  const ganttPanJustEndedRef = useRef(false);

  const [selectedGanttKey, setSelectedGanttKey] = useState<string | null>(null);
  const [selectedGanttColumnKey, setSelectedGanttColumnKey] = useState<string | null>(null);
  const [collapsedGanttGroupKeys, setCollapsedGanttGroupKeys] = useState<Set<string>>(() => new Set());
  const allGanttGroupsCollapsed =
    groups.length > 0 && groups.every((group) => collapsedGanttGroupKeys.has(group.key));
  const ganttTimelineViewportWidth = Math.max(0, ganttViewportWidth - ganttTableWidth);
  const [ganttScale, setGanttScale] = useState<PmGanttScale>("month");
  const [ganttAnchorIso, setGanttAnchorIso] = useState<string>(pmGanttTodayIso);
  const [ganttScrollRequest, setGanttScrollRequest] = useState<{
    iso: string;
    id: number;
  }>(() => ({ iso: pmGanttTodayIso(), id: 0 }));
  const ganttScrollRequestIdRef = useRef(0);
  const ganttScaleConfig = PM_GANTT_SCALES[ganttScale];
  const ganttDayWidth = pmGanttScaledPx(ganttScaleConfig.dayWidth, ganttUiScale);
  const ganttOverflowWidth = ganttMetrics.overflowWidth;
  const ganttMinOverflowWidth = pmGanttScaledPx(24, ganttUiScale);
  const requestGanttScroll = (iso: string): void => {
    ganttScrollRequestIdRef.current += 1;
    setGanttScrollRequest({
      iso,
      id: ganttScrollRequestIdRef.current,
    });
  };
  const toggleGanttColumn = (key: string): void => {
    setSelectedGanttColumnKey((current) => (current === key ? null : key));
  };
  const toggleGanttGroup = (key: string): void => {
    setCollapsedGanttGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  const applyGanttPeriodTimeFilter = (
    scale: PmGanttScale,
    closePopover = true,
  ): void => {
    const range = pmGanttPeriodRangeOf(scale, pmGanttTodayIso());
    setGanttTimeFilter(range);
    setGanttAnchorIso(range.startIso);
    if (closePopover) {
      setGanttTimeFilterOpen(false);
    }
    requestGanttScroll(range.startIso);
  };
  const shiftGanttTimeFilter = (direction: -1 | 1): void => {
    if (ganttTimeFilter === null) {
      return;
    }
    const range = pmGanttShiftedPeriodRangeOf(ganttTimeFilter, direction);
    setGanttTimeFilter(range);
    setGanttAnchorIso(range.startIso);
    requestGanttScroll(range.startIso);
  };
  const goToGanttCurrent = (): void => {
    const today = pmGanttTodayIso();
    if (ganttTimeFilter !== null) {
      setGanttTimeFilter(pmGanttPeriodRangeOf(ganttTimeFilter.period, today));
    }
    setGanttAnchorIso(today);
    requestGanttScroll(today);
  };
  const clearGanttTimeFilter = (): void => {
    const today = pmGanttTodayIso();
    setGanttTimeFilter(null);
    setGanttAnchorIso(today);
    setGanttTimeFilterOpen(false);
    requestGanttScroll(today);
  };
  const selectGanttPeriodMode = (): void => {
    if (ganttTimeFilter === null) {
      applyGanttPeriodTimeFilter(ganttScale, false);
    }
  };
  const openGanttTimeFilter = (): void => {
    if (ganttTimeFilterOpen) {
      setGanttTimeFilterOpen(false);
      return;
    }
    setGanttTimeFilterOpen(true);
  };

  useEffect(() => {
    if (!ganttTimeFilterOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (
        ganttTimeFilterPopoverRef.current !== null &&
        event.target instanceof Node &&
        !ganttTimeFilterPopoverRef.current.contains(event.target)
      ) {
        setGanttTimeFilterOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        setGanttTimeFilterOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ganttTimeFilterOpen]);

  useEffect(() => {
    const shell = ganttScrollShellRef.current;
    if (shell === null) {
      return;
    }
    const viewport = shell.querySelector<HTMLDivElement>('[data-scroll-area="horizontal"]');
    if (viewport === null) {
      return;
    }
    ganttScrollViewportRef.current = viewport;
    let frame = 0;
    const sync = (): void => {
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (ganttScrollViewportRef.current !== viewport) {
          return;
        }
        setGanttScrollLeft(viewport.scrollLeft);
        setGanttViewportWidth(viewport.clientWidth);
      });
    };
    sync();
    viewport.addEventListener("scroll", sync, { passive: true });

    const panThreshold = 4;
    const handlePointerDown = (event: PointerEvent): void => {
      ganttPanJustEndedRef.current = false;
      if (event.pointerType === "touch" || event.button !== 0) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable='true']") !== null
      ) {
        return;
      }
      ganttPanRef.current = {
        pointerId: event.pointerId,
        originX: event.clientX,
        baseLeft: viewport.scrollLeft,
        moved: false,
      };
    };
    const handlePointerMove = (event: PointerEvent): void => {
      const session = ganttPanRef.current;
      if (session === null || session.pointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - session.originX;
      if (!session.moved) {
        if (Math.abs(deltaX) < panThreshold) {
          return;
        }
        session.moved = true;
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        try {
          viewport.setPointerCapture(event.pointerId);
        } catch {}
        setGanttPanActive(true);
      }
      event.preventDefault();
      viewport.scrollLeft = session.baseLeft - deltaX;
    };
    const finishPan = (event: PointerEvent, suppressClick: boolean): void => {
      const session = ganttPanRef.current;
      if (session === null || session.pointerId !== event.pointerId) {
        return;
      }
      ganttPanRef.current = null;
      if (!session.moved) {
        return;
      }
      ganttPanJustEndedRef.current = suppressClick;
      setGanttPanActive(false);
      try {
        viewport.releasePointerCapture(event.pointerId);
      } catch {}
    };
    const handlePointerUp = (event: PointerEvent): void => {
      finishPan(event, true);
    };
    const handlePointerCancel = (event: PointerEvent): void => {
      finishPan(event, false);
    };
    const handleClickCapture = (event: MouseEvent): void => {
      if (!ganttPanJustEndedRef.current) {
        return;
      }
      ganttPanJustEndedRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const handleWheel = (event: WheelEvent): void => {
      const horizontalDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.shiftKey
            ? event.deltaY
            : 0;
      if (horizontalDelta === 0) {
        return;
      }
      event.preventDefault();
      viewport.scrollLeft += horizontalDelta;
    };

    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerup", handlePointerUp);
    viewport.addEventListener("pointercancel", handlePointerCancel);
    viewport.addEventListener("click", handleClickCapture, true);
    viewport.addEventListener("wheel", handleWheel, { passive: false });

    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    for (const child of Array.from(viewport.children)) {
      observer.observe(child);
    }
    return () => {
      viewport.removeEventListener("scroll", sync);
      viewport.removeEventListener("pointerdown", handlePointerDown);
      viewport.removeEventListener("pointermove", handlePointerMove);
      viewport.removeEventListener("pointerup", handlePointerUp);
      viewport.removeEventListener("pointercancel", handlePointerCancel);
      viewport.removeEventListener("click", handleClickCapture, true);
      viewport.removeEventListener("wheel", handleWheel);
      observer.disconnect();
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      if (ganttScrollViewportRef.current === viewport) {
        ganttScrollViewportRef.current = null;
      }
    };
  }, [groups.length]);

  useEffect(() => {
    if (!ganttResizing) {
      return;
    }
    const widthForPointer = (event: PointerEvent): number | null => {
      const start = ganttResizeStartRef.current;
      if (start === null) {
        return null;
      }
      return Math.round(
        pmGanttClampWidth(start.width + event.clientX - start.x, ganttMinWidth, ganttNaturalWidth),
      );
    };
    const handleMove = (event: PointerEvent): void => {
      const nextWidth = widthForPointer(event);
      if (nextWidth !== null) {
        setGanttWidthOverride(Math.round(nextWidth / ganttUiScale));
      }
    };
    const handleEnd = (event: PointerEvent): void => {
      const finalWidth = widthForPointer(event);
      setGanttResizing(false);
      ganttResizeStartRef.current = null;
      if (finalWidth !== null) {
        const storedWidth = Math.round(finalWidth / ganttUiScale);
        setGanttWidthOverride(storedWidth);
        pmGanttStoreTableWidth(storedWidth);
      }
    };
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd, { once: true });
    window.addEventListener("pointercancel", handleEnd, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [ganttMinWidth, ganttNaturalWidth, ganttResizing, ganttUiScale]);

  const ganttColumnLayout = useMemo(() => {
    const allColumns: PmGanttColumnLayoutEntry[] = PM_GANTT_COLUMNS.map((column, index) => ({
      column,
      width: ganttColumnWidths[index] ?? Math.round(column.minWidth * ganttUiScale),
    }));
    const visible: PmGanttColumnLayoutEntry[] = [];
    let usedWidth = 0;
    for (let index = 0; index < allColumns.length; index += 1) {
      const entry = allColumns[index];
      const hasMore = index < allColumns.length - 1;
      const reserve = hasMore ? ganttOverflowWidth : 0;
      if (visible.length > 0 && usedWidth + entry.width + reserve > ganttTableWidth) {
        break;
      }
      visible.push(entry);
      usedWidth += entry.width;
    }
    let hiddenColumnCount = allColumns.length - visible.length;
    if (hiddenColumnCount === 0) {
      return { visible, hiddenColumnCount, overflowWidth: 0 };
    }
    let remainingWidth = ganttTableWidth - usedWidth;
    if (remainingWidth < ganttMinOverflowWidth && visible.length > 1) {
      const removed = visible.pop();
      if (removed !== undefined) {
        usedWidth -= removed.width;
        hiddenColumnCount += 1;
        remainingWidth = ganttTableWidth - usedWidth;
      }
    }
    const extraWidth = Math.max(0, remainingWidth - ganttOverflowWidth);
    if (extraWidth > 0) {
      const lastIndex = visible.length - 1;
      visible[lastIndex] = { ...visible[lastIndex], width: visible[lastIndex].width + extraWidth };
      usedWidth += extraWidth;
    }
    return {
      visible,
      hiddenColumnCount,
      overflowWidth: Math.max(ganttMinOverflowWidth, ganttTableWidth - usedWidth),
    };
  }, [ganttColumnWidths, ganttMinOverflowWidth, ganttOverflowWidth, ganttTableWidth, ganttUiScale]);

  const hiddenColumnsLabel = useMemo(() => {
    if (ganttColumnLayout.hiddenColumnCount === 0) {
      return "";
    }
    const names = PM_GANTT_COLUMNS.slice(ganttColumnLayout.visible.length)
      .map((column) => (column.labelKey === null ? "" : t(column.labelKey)))
      .filter((label) => label !== "");
    return (
      t("pm.gantt.hiddenColumns", { n: ganttColumnLayout.hiddenColumnCount }) +
      (names.length === 0 ? "" : " · " + names.join(" / "))
    );
  }, [ganttColumnLayout.hiddenColumnCount, ganttColumnLayout.visible.length, t]);

  const revealGanttEntry = (key: string, barLeft: number | null): void => {
    setSelectedGanttKey(key);
    if (barLeft === null) {
      return;
    }
    const viewport = ganttScrollViewportRef.current;
    if (viewport === null) {
      return;
    }
    setGanttScrollLeft(pmGanttSetScrollLeft(viewport, Math.max(0, barLeft)));
  };

  const handleGanttJumpKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    key: string,
    barLeft: number | null,
  ): void => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    revealGanttEntry(key, barLeft);
  };

  const startGanttResize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    ganttResizeStartRef.current = { x: event.clientX, width: ganttTableWidth };
    setGanttResizeHovered(true);
    setGanttResizing(true);
  };

  const resetGanttWidth = (): void => {
    setGanttWidthOverride(null);
    pmGanttStoreTableWidth(null);
  };

  const handleGanttResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = pmGanttScaledPx(event.shiftKey ? 32 : 12, ganttUiScale);
      const next = pmGanttClampWidth(
        ganttTableWidth + (event.key === "ArrowLeft" ? -step : step),
        ganttMinWidth,
        ganttNaturalWidth,
      );
      const storedWidth = Math.round(next / ganttUiScale);
      setGanttWidthOverride(storedWidth);
      pmGanttStoreTableWidth(storedWidth);
    } else if (event.key === "Home") {
      event.preventDefault();
      resetGanttWidth();
    }
  };

  const timeline = useMemo(() => {
    const today = pmGanttTodayIso();
    const scaleConfig = PM_GANTT_SCALES[ganttScale];
    let rangeStart: number;
    let rangeEnd: number;
    if (ganttTimeFilter !== null) {
      rangeStart = pmGanttTimeOf(ganttTimeFilter.startIso);
      rangeEnd = pmGanttTimeOf(ganttTimeFilter.endIso);
    } else {
      const todayTime = pmGanttTimeOf(today);
      const anchorTime = pmGanttTimeOf(ganttAnchorIso);
      let startTime = Math.min(todayTime, anchorTime);
      let endTime = Math.max(todayTime, anchorTime);
      groups.forEach((group) => {
        group.items.forEach((item) => {
          if (item.start !== null) {
            startTime = Math.min(startTime, pmGanttTimeOf(item.start));
          }
          if (item.end !== null) {
            endTime = Math.max(endTime, pmGanttTimeOf(item.end));
          }
        });
      });

      rangeStart = startTime - scaleConfig.paddingDays * PM_GANTT_DAY_MS;
      rangeEnd = endTime;
      const baseDayCount = Math.round((rangeEnd - rangeStart) / PM_GANTT_DAY_MS) + 1;
      if (baseDayCount < scaleConfig.minDays) {
        rangeStart -= (scaleConfig.minDays - baseDayCount) * PM_GANTT_DAY_MS;
      }
      if (ganttScale === "year") {
        const startDate = new Date(rangeStart);
        rangeStart = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1);
      } else if (ganttScale === "quarter") {
        const startDate = new Date(rangeStart);
        rangeStart -= ((startDate.getUTCDay() + 6) % 7) * PM_GANTT_DAY_MS;
      }
    }
    const dayCount = Math.round((rangeEnd - rangeStart) / PM_GANTT_DAY_MS) + 1;

    const startIso = pmGanttIsoOf(rangeStart);
    const monthFormatter = new Intl.DateTimeFormat(intlLocale, {
      year: "numeric",
      month: "long",
      timeZone: "UTC",
    });
    const yearFormatter = new Intl.DateTimeFormat(intlLocale, {
      year: "numeric",
      timeZone: "UTC",
    });
    const monthOnlyFormatter = new Intl.DateTimeFormat(intlLocale, {
      month: "short",
      timeZone: "UTC",
    });
    const weekDayFormatter = new Intl.DateTimeFormat(intlLocale, {
      day: "numeric",
      timeZone: "UTC",
    });
    const weekMonthDayFormatter = new Intl.DateTimeFormat(intlLocale, {
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    });
    const weekdayFormatter = new Intl.DateTimeFormat(intlLocale, {
      weekday: "narrow",
      timeZone: "UTC",
    });
    const days = Array.from({ length: dayCount }, (_, index) => {
      const iso = pmGanttAddDays(startIso, index);
      const date = new Date(pmGanttTimeOf(iso));
      return {
        iso,
        dayNumber: String(date.getUTCDate()),
        weekday: weekdayFormatter.format(date),
        weekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
        today: iso === today,
      };
    });
    const buildSegments = (
      keyOf: (iso: string) => string,
      labelOf: (iso: string) => string,
    ): Array<{ key: string; label: string; startIndex: number; count: number }> => {
      const segments: Array<{
        key: string;
        label: string;
        startIndex: number;
        count: number;
      }> = [];
      days.forEach((day, index) => {
        const key = keyOf(day.iso);
        const previous = segments[segments.length - 1];
        if (previous !== undefined && previous.key === key) {
          previous.count += 1;
          return;
        }
        segments.push({
          key,
          label: labelOf(day.iso),
          startIndex: index,
          count: 1,
        });
      });
      return segments;
    };
    const formatWeekSegmentLabel = (startIso: string, endIso: string): string => {
      if (startIso === endIso) {
        return weekMonthDayFormatter.format(new Date(pmGanttTimeOf(startIso)));
      }
      if (startIso.slice(0, 7) === endIso.slice(0, 7)) {
        return (
          weekDayFormatter.format(new Date(pmGanttTimeOf(startIso))) +
          "–" +
          weekDayFormatter.format(new Date(pmGanttTimeOf(endIso)))
        );
      }
      return (
        weekMonthDayFormatter.format(new Date(pmGanttTimeOf(startIso))) +
        "–" +
        weekMonthDayFormatter.format(new Date(pmGanttTimeOf(endIso)))
      );
    };
    const buildWeekSegments = (): Array<{
      key: string;
      label: string;
      startIndex: number;
      count: number;
      startIso: string;
      endIso: string;
    }> => {
      const segments: Array<{
        key: string;
        label: string;
        startIndex: number;
        count: number;
        startIso: string;
        endIso: string;
      }> = [];
      days.forEach((day, index) => {
        const weekDay = new Date(pmGanttTimeOf(day.iso)).getUTCDay();
        const weekStartIso = pmGanttAddDays(day.iso, -((weekDay + 6) % 7));
        const previous = segments[segments.length - 1];
        if (previous !== undefined && previous.key === weekStartIso) {
          previous.count += 1;
          previous.endIso = day.iso;
          previous.label = formatWeekSegmentLabel(previous.startIso, previous.endIso);
          return;
        }
        segments.push({
          key: weekStartIso,
          label: formatWeekSegmentLabel(day.iso, day.iso),
          startIndex: index,
          count: 1,
          startIso: day.iso,
          endIso: day.iso,
        });
      });
      return segments;
    };
    const findTodayIndex = (): number => days.findIndex((day) => day.today);
    const headerMode =
      ganttScale === "year"
        ? ("year-month" as const)
        : ganttScale === "quarter"
          ? ("month-week" as const)
          : ("daily" as const);
    const primarySegments =
      headerMode === "year-month"
        ? buildSegments(
            (iso) => iso.slice(0, 4),
            (iso) => yearFormatter.format(new Date(pmGanttTimeOf(iso))),
          )
        : buildSegments(
            (iso) => iso.slice(0, 7),
            (iso) => monthFormatter.format(new Date(pmGanttTimeOf(iso))),
          );
    const secondarySegments =
      headerMode === "year-month"
        ? buildSegments(
            (iso) => iso.slice(0, 7),
            (iso) => monthOnlyFormatter.format(new Date(pmGanttTimeOf(iso))),
          )
        : headerMode === "month-week"
          ? buildWeekSegments()
          : [];

    return {
      startIso,
      days,
      primarySegments,
      secondarySegments,
      headerMode,
      width: days.length * ganttDayWidth,
      dayWidth: ganttDayWidth,
      gridDays: scaleConfig.gridDays,
      todayIndex: findTodayIndex(),
    };
  }, [ganttAnchorIso, ganttDayWidth, ganttScale, ganttTimeFilter, groups, intlLocale]);

  const ganttVisibleRange = useMemo(() => {
    const lastIndex = Math.max(0, timeline.days.length - 1);
    const dayWidth = Math.max(ganttDayWidth, 1);
    const startIndex = Math.min(
      lastIndex,
      Math.max(0, Math.floor(ganttScrollLeft / dayWidth)),
    );
    const endIndex = Math.min(
      lastIndex,
      Math.max(
        startIndex,
        Math.ceil(
          (ganttScrollLeft + Math.max(ganttTimelineViewportWidth, dayWidth)) / dayWidth,
        ) - 1,
      ),
    );
    return {
      startIso: timeline.days[startIndex]?.iso ?? timeline.startIso,
      endIso: timeline.days[endIndex]?.iso ?? timeline.startIso,
      startIndex,
      endIndex,
    };
  }, [ganttDayWidth, ganttScrollLeft, ganttTimelineViewportWidth, timeline.days, timeline.startIso]);
  const ganttVisibleRangeText = pmGanttVisibleRangeLabel(
    ganttVisibleRange.startIso,
    ganttVisibleRange.endIso,
  );
  const ganttVisibleRangeAriaLabel = t("pm.gantt.visibleRange", {
    start: ganttVisibleRange.startIso,
    end: ganttVisibleRange.endIso,
  });
  const ganttTimeFilterRangeText =
    ganttTimeFilter === null
      ? null
      : pmGanttVisibleRangeLabel(ganttTimeFilter.startIso, ganttTimeFilter.endIso);
  const ganttTimeFilterPeriodLabel =
    ganttTimeFilter === null
      ? null
      : t(PM_GANTT_SCALES[ganttTimeFilter.period].labelKey);
  const ganttTimeFilterText =
    ganttTimeFilter === null || ganttTimeFilterRangeText === null
      ? t("pm.gantt.timeFilter.all")
      : t("pm.gantt.timeFilter.period") + " · " + ganttTimeFilterRangeText;
  const ganttTimeFilterAriaLabel =
    ganttTimeFilter === null ||
    ganttTimeFilterRangeText === null ||
    ganttTimeFilterPeriodLabel === null
      ? t("pm.gantt.timeFilter") + ": " + ganttTimeFilterText
      : t("pm.gantt.timeFilter") +
        ": " +
        t("pm.gantt.timeFilter.period") +
        " · " +
        ganttTimeFilterPeriodLabel +
        ", " +
        ganttTimeFilterRangeText;

  const ganttViewportReferenceIndex =
    timeline.days.length === 0
      ? -1
      : Math.max(
          0,
          Math.min(
            timeline.days.length - 1,
            Math.round(
              (ganttScrollLeft + ganttTimelineViewportWidth / 3) /
                Math.max(ganttDayWidth, 1),
            ),
          ),
        );
  const ganttViewportReferenceIso =
    ganttViewportReferenceIndex < 0
      ? ganttAnchorIso
      : timeline.days[ganttViewportReferenceIndex].iso;
  const selectGanttScale = (nextScale: PmGanttScale): void => {
    const referenceIso = ganttTimeFilter?.anchorIso ?? ganttViewportReferenceIso;
    setGanttScale(nextScale);
    setGanttAnchorIso(referenceIso);
    setSelectedGanttColumnKey(null);
    if (ganttTimeFilter !== null) {
      const range = pmGanttPeriodRangeOf(nextScale, referenceIso);
      setGanttTimeFilter(range);
      requestGanttScroll(range.startIso);
      return;
    }
    requestGanttScroll(referenceIso);
  };

  const selectedGanttColumn = useMemo(() => {
    if (selectedGanttColumnKey === null) {
      return null;
    }
    const segment =
      timeline.primarySegments.find((entry) => entry.key === selectedGanttColumnKey) ??
      timeline.secondarySegments.find((entry) => entry.key === selectedGanttColumnKey);
    if (segment !== undefined) {
      return segment;
    }
    const dayIndex = timeline.days.findIndex((day) => day.iso === selectedGanttColumnKey);
    if (dayIndex < 0) {
      return null;
    }
    return {
      key: selectedGanttColumnKey,
      label: timeline.days[dayIndex].dayNumber,
      startIndex: dayIndex,
      count: 1,
    };
  }, [selectedGanttColumnKey, timeline]);

  useEffect(() => {
    const viewport = ganttScrollViewportRef.current;
    if (viewport === null || timeline.todayIndex < 0) {
      return;
    }
    const visibleTimelineWidth = Math.max(0, viewport.clientWidth - ganttTableWidth);
    if (visibleTimelineWidth <= 0) {
      return;
    }
    const targetIndex = Math.round(
      (pmGanttTimeOf(ganttScrollRequest.iso) - pmGanttTimeOf(timeline.startIso)) /
        PM_GANTT_DAY_MS,
    );
    if (targetIndex < 0 || targetIndex >= timeline.days.length) {
      return;
    }
    const targetLeft =
      targetIndex * ganttDayWidth + ganttDayWidth / 2;
    setGanttScrollLeft(
      pmGanttSetScrollLeft(viewport, targetLeft - visibleTimelineWidth / 3),
    );
  }, [
    ganttDayWidth,
    ganttScrollRequest,
    ganttTableWidth,
    timeline.days.length,
    timeline.startIso,
    timeline.todayIndex,
  ]);

  const renderedGroups = useMemo(() => {
    let sequence = 0;
    return groups.map((group) => {
      let groupStart: string | null = null;
      let groupEnd: string | null = null;
      group.items.forEach((item) => {
        if (item.start !== null && (groupStart === null || item.start < groupStart)) {
          groupStart = item.start;
        }
        if (item.end !== null && (groupEnd === null || item.end > groupEnd)) {
          groupEnd = item.end;
        }
      });
      const occupancy = pmGanttOccupancyOf(group.items, timeline.startIso, timeline.days.length);
      return {
        ...group,
        groupStart,
        groupEnd,
        groupDays:
          groupStart === null || groupEnd === null ? null : inclusiveDaysBetween(groupStart, groupEnd),
        occupancy,
        freeDays: Math.max(0, timeline.days.length - occupancy.occupiedDays),
        hasConflict: group.kind === "person" && occupancy.conflictDays > 0,
        rows: group.items.map((item) => {
          sequence += 1;
          return { item, sequence };
        }),
      };
    });
  }, [groups, timeline.days.length, timeline.startIso]);

  const indexOfIso = (iso: string, fallback: number): number => {
    const parsed = Date.parse(iso + "T00:00:00Z");
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return Math.round((parsed - pmGanttTimeOf(timeline.startIso)) / PM_GANTT_DAY_MS);
  };
  const selectedColumnMarker =
    selectedGanttColumn === null ? null : (
      <span
        aria-hidden="true"
        data-project-management-gantt-selected-column={selectedGanttColumn.key}
        className="pointer-events-none absolute inset-y-0 z-[1] border-x-2 border-amber-400/80 bg-amber-300/25"
        style={{
          left: selectedGanttColumn.startIndex * ganttDayWidth,
          width: selectedGanttColumn.count * ganttDayWidth,
        }}
      />
    );
  const currentGanttIso = timeline.days[timeline.todayIndex]?.iso ?? pmGanttTodayIso();
  const todayMarker =
    timeline.todayIndex < 0 ? null : (
      <span
        aria-hidden="true"
        data-project-management-gantt-today="true"
        title={t("pm.gantt.today")}
        className="pointer-events-none absolute inset-y-0 z-[3] w-[2px] bg-blue-600 shadow-[0_0_0_1px_rgba(37,99,235,0.12)]"
        style={{ left: timeline.todayIndex * ganttDayWidth + ganttDayWidth / 2 }}
      />
    );

  return (
    <div
      ref={ganttScrollShellRef}
      data-project-management-gantt="implementation"
      data-project-management-gantt-scale={ganttScale}
      data-project-management-gantt-ui-scale={ganttMetrics.scale.toFixed(2)}
      data-project-management-gantt-visible-start={ganttVisibleRange.startIso}
      data-project-management-gantt-visible-end={ganttVisibleRange.endIso}
      data-project-management-gantt-timeline-start={timeline.startIso}
      data-project-management-gantt-timeline-end={timeline.days[timeline.days.length - 1]?.iso ?? timeline.startIso}
      data-project-management-gantt-time-filter-start={ganttTimeFilter?.startIso ?? ""}
      data-project-management-gantt-time-filter-end={ganttTimeFilter?.endIso ?? ""}
      data-project-management-gantt-time-filter-period={ganttTimeFilter?.period ?? ""}
      data-project-management-gantt-time-filter-anchor={ganttTimeFilter?.anchorIso ?? ""}
      data-project-management-gantt-only-in-progress={ganttOnlyInProgress ? "true" : "false"}
      className="min-w-0"
      style={ganttCssVariables}
    >
      <div className="sticky top-[116px] z-[25] w-full min-w-0">
      <div
        data-project-management-gantt-toolbar="true"
        className="flex flex-wrap items-center justify-between rounded-t-xl border border-zinc-200 bg-white"
        style={{
          gap: ganttMetrics.toolbarGap,
          padding: `${ganttMetrics.toolbarPaddingY}px ${ganttMetrics.toolbarPaddingX}px`,
        }}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <div
            role="group"
            aria-label={ganttVisibleRangeAriaLabel}
            data-project-management-gantt-window-nav="true"
            className="flex items-center rounded-lg border border-zinc-200 bg-white p-0.5"
          >
            <button
              type="button"
              data-project-management-gantt-period-previous="true"
              aria-label={t("pm.gantt.previousPeriod")}
              title={t("pm.gantt.previousPeriod")}
              disabled={ganttTimeFilter === null}
              onClick={() => shiftGanttTimeFilter(-1)}
              className="flex items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
              style={{ width: ganttMetrics.toolbarControlHeight, height: ganttMetrics.toolbarControlHeight }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                style={{ width: ganttMetrics.toolbarControlHeight / 2, height: ganttMetrics.toolbarControlHeight / 2 }}
              >
                <path d="m10 4-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div ref={ganttTimeFilterPopoverRef} className="relative flex">
              <span data-project-management-gantt-visible-range="true" className="sr-only" aria-live="polite">
                {ganttVisibleRangeText}
              </span>
              <button
                type="button"
                data-project-management-gantt-time-filter-trigger="true"
                aria-expanded={ganttTimeFilterOpen}
                aria-haspopup="dialog"
                aria-label={ganttTimeFilterAriaLabel}
                title={t("pm.gantt.timeFilter.hint")}
                onClick={openGanttTimeFilter}
                className={
                  "flex min-w-[132px] items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 text-[length:var(--pm-gantt-toolbar-control-size,12px)] font-medium tabular-nums transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 " +
                  (ganttTimeFilter === null
                    ? "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                    : "bg-blue-50 text-blue-700")
                }
                style={{ height: ganttMetrics.toolbarControlHeight }}
              >
                <span>{ganttTimeFilterText}</span>
                <svg
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0"
                >
                  <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {ganttTimeFilterOpen ? (
                <div
                  role="dialog"
                  aria-label={t("pm.gantt.timeFilter")}
                  data-project-management-gantt-time-filter-popover="true"
                  className="absolute left-0 top-full z-[80] mt-2 w-[340px] max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-xl"
                >
                  <div>
                    <p className="text-xs font-semibold text-zinc-800">{t("pm.gantt.timeFilter")}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">{t("pm.gantt.timeFilter.hint")}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      data-project-management-gantt-time-filter-all="true"
                      aria-pressed={ganttTimeFilter === null}
                      onClick={clearGanttTimeFilter}
                      className={
                        "h-9 rounded-lg border px-3 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 " +
                        (ganttTimeFilter === null
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900")
                      }
                    >
                      {t("pm.gantt.timeFilter.all")}
                    </button>
                    <button
                      type="button"
                      data-project-management-gantt-time-filter-period-mode="true"
                      aria-pressed={ganttTimeFilter !== null}
                      onClick={selectGanttPeriodMode}
                      className={
                        "h-9 rounded-lg border px-3 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 " +
                        (ganttTimeFilter !== null
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900")
                      }
                    >
                      {t("pm.gantt.timeFilter.period")}
                    </button>
                  </div>
                  {ganttTimeFilter !== null ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-zinc-500">
                        {t("pm.gantt.timeFilter.periodHint", {
                          scale: ganttTimeFilterPeriodLabel ?? "",
                        })}
                      </p>
                      {ganttTimeFilterRangeText !== null ? (
                        <p
                          data-project-management-gantt-time-filter-current-range="true"
                          className="rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] tabular-nums text-zinc-600"
                        >
                          {t("pm.gantt.timeFilter.currentRange", { range: ganttTimeFilterRangeText })}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              data-project-management-gantt-period-next="true"
              aria-label={t("pm.gantt.nextPeriod")}
              title={t("pm.gantt.nextPeriod")}
              disabled={ganttTimeFilter === null}
              onClick={() => shiftGanttTimeFilter(1)}
              className="flex items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
              style={{ width: ganttMetrics.toolbarControlHeight, height: ganttMetrics.toolbarControlHeight }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                style={{ width: ganttMetrics.toolbarControlHeight / 2, height: ganttMetrics.toolbarControlHeight / 2 }}
              >
                <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            data-project-management-gantt-only-in-progress="true"
            aria-pressed={ganttOnlyInProgress}
            onClick={() => setGanttOnlyInProgress((current) => !current)}
            className={
              "rounded-md border px-2.5 text-[length:var(--pm-gantt-toolbar-control-size,12px)] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 " +
              (ganttOnlyInProgress
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900")
            }
            style={{ height: ganttMetrics.toolbarControlHeight }}
          >
            {t("pm.gantt.onlyInProgress")}
          </button>

          <button
            type="button"
            data-project-management-gantt-toggle-all="true"
            onClick={() => {
              setCollapsedGanttGroupKeys(
                allGanttGroupsCollapsed ? new Set<string>() : new Set(groups.map((group) => group.key)),
              );
            }}
            className="rounded-md border border-zinc-200 bg-white px-2.5 text-[length:var(--pm-gantt-toolbar-control-size,12px)] font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            style={{ height: ganttMetrics.toolbarControlHeight }}
          >
            {allGanttGroupsCollapsed ? t("pm.gantt.expandAll") : t("pm.gantt.collapseAll")}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            data-project-management-gantt-today-button="true"
            data-project-management-gantt-back-to-current="true"
            onClick={goToGanttCurrent}
            className="rounded-md border border-zinc-200 bg-white px-2.5 text-[length:var(--pm-gantt-toolbar-control-size,12px)] font-medium text-zinc-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            style={{ height: ganttMetrics.toolbarControlHeight }}
          >
            {t("pm.gantt.today")}
          </button>
          <div
            role="group"
            aria-label={t("pm.gantt.scale.aria")}
            className="flex items-center rounded-lg bg-zinc-100 p-0.5"
          >
            {PM_GANTT_SCALE_KEYS.map((scaleKey) => {
              const active = scaleKey === ganttScale;
              const label = t(PM_GANTT_SCALES[scaleKey].labelKey);
              return (
                <button
                  key={scaleKey}
                  type="button"
                  aria-pressed={active}
                  data-project-management-gantt-scale-option={scaleKey}
                  onClick={() => selectGanttScale(scaleKey)}
                  className={
                    "rounded-md px-2.5 text-[length:var(--pm-gantt-toolbar-control-size,12px)] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 " +
                    (active
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-800")
                  }
                  style={{
                    height: ganttMetrics.toolbarControlHeight,
                    minWidth: ganttMetrics.toolbarScaleButtonMinWidth,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
        <div className="border-x border-b border-zinc-200 bg-white">
          <div className="flex w-full min-w-0" style={{ height: ganttMetrics.headerHeight }}>
            <div
              className="relative z-20 flex shrink-0 bg-zinc-50 shadow-[8px_0_18px_-18px_rgba(15,23,42,0.55)]"
              style={{ width: ganttTableWidth }}
            >
              {ganttColumnLayout.visible.map(({ column, width }, columnIndex) => (
                <div
                  key={column.key}
                  style={{ width }}
                  className={
                    "flex h-full min-w-0 items-center justify-center overflow-hidden border-r border-zinc-300 px-0.5 text-center text-[length:var(--pm-gantt-header-size,9px)] font-medium text-zinc-600 " +
                    (columnIndex === ganttColumnLayout.visible.length - 1 && ganttColumnLayout.hiddenColumnCount === 0
                      ? " border-r-0"
                      : "")
                  }
                >
                  {column.labelKey === null ? null : (
                    <span className="truncate whitespace-nowrap" title={t(column.labelKey)}>
                      {t(column.labelKey)}
                    </span>
                  )}
                </div>
              ))}
              {ganttColumnLayout.hiddenColumnCount > 0 ? (
                <div
                  style={{ width: ganttColumnLayout.overflowWidth }}
                  title={hiddenColumnsLabel}
                  className="flex h-full min-w-0 items-center justify-center border-r-0 border-zinc-300 text-[length:var(--pm-gantt-cell-size,10px)] font-medium tabular-nums text-zinc-400"
                >
                  +{ganttColumnLayout.hiddenColumnCount}
                </div>
              ) : null}
              <button
                type="button"
                data-project-management-gantt-resizer="true"
                aria-label={t("pm.gantt.resizeTable")}
                title={t("pm.gantt.resizeHint")}
                onPointerDown={startGanttResize}
                onDoubleClick={resetGanttWidth}
                onKeyDown={handleGanttResizeKeyDown}
                onMouseEnter={() => setGanttResizeHovered(true)}
                onMouseLeave={() => setGanttResizeHovered(false)}
                onFocus={() => setGanttResizeHovered(true)}
                onBlur={() => setGanttResizeHovered(false)}
                className="absolute -right-2 top-1/2 z-40 flex -translate-y-1/2 cursor-col-resize items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-400 shadow-sm transition hover:border-blue-300 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                style={{ width: ganttMetrics.resizerWidth, height: ganttMetrics.resizerHeight }}
              >
                <svg viewBox="0 0 12 16" fill="none" aria-hidden="true" className="h-4 w-3">
                  <path d="M4.5 4.5 2 8l2.5 3.5M7.5 4.5 10 8l-2.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {ganttResizing || ganttResizeHovered ? (
                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-1 text-[length:var(--pm-gantt-toolbar-control-size,12px)] font-medium text-zinc-600 shadow-md">
                  {t("pm.gantt.tableWidth", { n: ganttTableWidth })}
                </span>
              ) : null}
            </div>
            <div className="relative min-w-0 flex-1 overflow-hidden bg-white">
              <div
                className="h-full bg-zinc-50"
                style={{ width: timeline.width, transform: `translateX(-${ganttScrollLeft}px)` }}
              >
              <div className="flex border-b border-zinc-200" style={{ height: ganttMetrics.headerRowHeight }}>
                {timeline.primarySegments.map((segment, index) => {
                  const hasToday =
                    timeline.todayIndex >= segment.startIndex &&
                    timeline.todayIndex < segment.startIndex + segment.count;
                  return (
                    <button
                      key={segment.key}
                      type="button"
                      aria-pressed={selectedGanttColumnKey === segment.key}
                      aria-label={segment.label}
                      title={segment.label}
                      data-project-management-gantt-column={segment.key}
                      onClick={() => toggleGanttColumn(segment.key)}
                      className={
                        "flex min-w-0 items-center justify-center border-r border-zinc-200 px-2 text-[length:var(--pm-gantt-timeline-primary-size,13px)] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 " +
                        (selectedGanttColumnKey === segment.key
                          ? "bg-amber-100 text-amber-900 ring-2 ring-inset ring-amber-400 "
                          : hasToday
                            ? "bg-blue-50/70 text-blue-700 hover:bg-amber-50 "
                            : "text-zinc-600 hover:bg-amber-50 ") +
                        (index === timeline.primarySegments.length - 1
                          ? "border-r-0"
                          : "")
                      }
                      style={{ width: segment.count * ganttDayWidth }}
                    >
                      <span className="whitespace-nowrap">{segment.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex" style={{ height: ganttMetrics.headerRowHeight }}>
                {timeline.headerMode !== "daily"
                  ? timeline.secondarySegments.map((segment, index) => {
                      const hasToday =
                        timeline.todayIndex >= segment.startIndex &&
                        timeline.todayIndex < segment.startIndex + segment.count;
                      return (
                        <button
                          key={segment.key}
                          type="button"
                          aria-pressed={selectedGanttColumnKey === segment.key}
                          aria-label={segment.label}
                          title={segment.label}
                          data-project-management-gantt-secondary={segment.key}
                          data-project-management-gantt-column={segment.key}
                          onClick={() => toggleGanttColumn(segment.key)}
                          className={
                            "flex min-w-0 items-center justify-center overflow-hidden border-r border-zinc-200 font-medium tabular-nums whitespace-nowrap transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 " +
                            (timeline.headerMode === "month-week"
                              ? "text-[length:var(--pm-gantt-timeline-day-size,10px)] "
                              : "text-[length:var(--pm-gantt-timeline-week-day-size,12px)] ") +
                            (selectedGanttColumnKey === segment.key
                              ? "bg-amber-100 text-amber-900 ring-2 ring-inset ring-amber-400 "
                              : hasToday
                                ? "bg-blue-50/70 text-blue-700 hover:bg-amber-50 "
                                : "text-zinc-500 hover:bg-amber-50 ") +
                            (index === timeline.secondarySegments.length - 1
                              ? "border-r-0"
                              : "")
                          }
                          style={{ width: segment.count * ganttDayWidth }}
                        >
                          {segment.label}
                        </button>
                      );
                    })
                  : timeline.days.map((day) => {
                      const selected = selectedGanttColumnKey === day.iso;
                      return (
                        <button
                          key={day.iso}
                          type="button"
                          aria-pressed={selected}
                          aria-label={day.iso}
                          data-project-management-gantt-day={day.iso}
                          data-project-management-gantt-column={day.iso}
                          onClick={() => toggleGanttColumn(day.iso)}
                          className={
                            "flex h-full min-w-0 items-center justify-center border-r border-zinc-200 tabular-nums transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 " +
                            (ganttScale === "week"
                              ? "gap-1 text-[length:var(--pm-gantt-timeline-week-day-size,12px)] "
                              : "text-[length:var(--pm-gantt-timeline-day-size,10px)] ") +
                            (selected
                              ? "bg-amber-100 font-semibold text-amber-900 ring-2 ring-inset ring-amber-400 "
                              : day.today
                                ? "bg-blue-50 font-semibold text-blue-700 hover:bg-amber-50 "
                                : "text-zinc-500 hover:bg-amber-50 ") +
                            (!selected && day.weekend && !day.today ? "bg-zinc-100/70 " : "")
                          }
                          style={{ width: ganttDayWidth }}
                          title={day.iso}
                        >
                          <span>{day.dayNumber}</span>
                          {ganttScale === "week" ? (
                            <span className={day.today ? "text-blue-500" : "text-zinc-400"}>
                              {day.weekday}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
              </div>
            </div>
            </div>
          </div>

        </div>
      </div>
      {renderedGroups.length === 0 ? (
        <div
          data-project-management-gantt="empty"
          className="flex min-h-[220px] items-center justify-center rounded-b-xl border border-t-0 border-dashed border-zinc-300 bg-white px-6 py-10 text-sm text-zinc-400"
        >
          {t("pm.gantt.empty")}
        </div>
      ) : (
      <div className="overflow-hidden rounded-b-xl border border-t-0 border-zinc-200 bg-white">
      <ScrollArea
        axis="horizontal"
        fixedHorizontalScrollbar
        ariaLabel={t("pm.gantt.aria")}
        viewportClassName="min-h-0"
        className={"min-w-full pb-3 " + (ganttPanActive ? "cursor-grabbing select-none" : "cursor-grab")}
      >
        <div className="min-w-max">
          {renderedGroups.map((group) => {
            const groupStartIndex =
              group.groupStart === null ? null : Math.max(0, indexOfIso(group.groupStart, -1));
            const groupBarLeft = groupStartIndex === null ? 0 : groupStartIndex * ganttDayWidth + 2;
            const groupCanJump = groupStartIndex !== null;
            const groupSelected = selectedGanttKey === group.key;
            const groupCollapsed = collapsedGanttGroupKeys.has(group.key);
            const isPersonGroup = group.kind === "person";
            const groupCapacityLabel =
              group.occupancy.parallelDays > 0
                ? t("pm.gantt.capacityParallel", {
                    occupied: group.occupancy.occupiedDays,
                    free: group.freeDays,
                    parallel: group.occupancy.parallelDays,
                  })
                : t("pm.gantt.capacity", {
                    occupied: group.occupancy.occupiedDays,
                    free: group.freeDays,
                  });
            const groupStatusLabel = group.hasConflict
              ? t("pm.gantt.timeConflict")
              : t("pm.gantt.scheduleNormal");
            const groupTitle = group.label + " · " + groupCapacityLabel + " · " + groupStatusLabel;
            return (
              <div
                key={group.key}
                data-project-management-gantt-group={group.key}
                data-project-management-gantt-group-collapsed={groupCollapsed ? "true" : "false"}
              >
                <div className="flex" style={{ height: ganttMetrics.groupHeight }}>
                  <div
                    className={
                      "sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-b border-zinc-300 px-1.5 shadow-[8px_0_18px_-18px_rgba(15,23,42,0.55)] " +
                      (groupSelected ? "bg-sky-50 " : "bg-zinc-50/95 ")
                    }
                    style={{ width: ganttTableWidth }}
                  >
                    <button
                      type="button"
                      aria-expanded={!groupCollapsed}
                      aria-label={t(groupCollapsed ? "pm.gantt.expandPerson" : "pm.gantt.collapsePerson", { name: group.label })}
                      title={t(groupCollapsed ? "pm.gantt.expandPerson" : "pm.gantt.collapsePerson", { name: group.label })}
                      onClick={() => toggleGanttGroup(group.key)}
                      className="flex shrink-0 items-center justify-center rounded text-zinc-500 transition hover:bg-white hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      style={{ width: ganttMetrics.expandButtonSize, height: ganttMetrics.expandButtonSize }}
                    >
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                        className={"transition-transform " + (groupCollapsed ? "" : "rotate-90")}
                        style={{ width: ganttMetrics.expandIconSize, height: ganttMetrics.expandIconSize }}
                      >
                        <path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                      {groupCanJump ? (
                        <button
                          type="button"
                          aria-label={t("pm.gantt.jumpToDates") + " · " + groupTitle}
                          title={groupTitle}
                          onClick={() => revealGanttEntry(group.key, groupBarLeft)}
                          className={"min-w-0 max-w-[var(--pm-gantt-group-label-max-width,160px)] shrink truncate rounded-[2px] px-0.5 py-0 text-left text-[length:var(--pm-gantt-group-name-size,11px)] font-semibold leading-[var(--pm-gantt-group-name-leading,16px)] tracking-[0.01em] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 " + pmGanttGroupTextTone(group)}
                        >
                          {group.label}
                        </button>
                      ) : (
                        <span className={"min-w-0 max-w-[var(--pm-gantt-group-label-max-width,160px)] shrink truncate rounded-[2px] px-0.5 py-0 text-[length:var(--pm-gantt-group-name-size,11px)] font-semibold leading-[var(--pm-gantt-group-name-leading,16px)] tracking-[0.01em] " + pmGanttGroupTextTone(group)} title={group.label}>
                          {group.label}
                        </span>
                      )}
                      <span
                        className="min-w-0 truncate text-[length:var(--pm-gantt-group-meta-size,10px)] font-normal leading-[var(--pm-gantt-group-name-leading,16px)] tracking-[0.01em] tabular-nums text-zinc-500"
                        title={(t("pm.gantt.totalCount", { n: group.items.length }) + (isPersonGroup ? " · " + groupCapacityLabel : ""))}
                      >
                        {t("pm.gantt.totalCount", { n: group.items.length })}
                        {isPersonGroup ? " · " + groupCapacityLabel : ""}
                      </span>
                    </div>
                    {isPersonGroup ? (
                      <span
                        data-project-management-gantt-group-status={group.hasConflict ? "conflict" : "normal"}
                        title={groupStatusLabel}
                        style={{ height: ganttMetrics.groupStatusHeight }}
                        className={
                          "inline-flex shrink-0 items-center rounded-full px-2 text-[length:var(--pm-gantt-group-meta-size,10px)] font-normal leading-[var(--pm-gantt-group-name-leading,16px)] tracking-[0.01em] ring-1 ring-inset " +
                          (group.hasConflict
                            ? "bg-rose-50 text-rose-700 ring-rose-200"
                            : "bg-emerald-100 text-emerald-700 ring-emerald-200")
                        }
                      >
                        {groupStatusLabel}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={"relative shrink-0 border-b border-zinc-300 " + (isPersonGroup ? "bg-zinc-50/80" : "bg-white")}
                    style={{ width: timeline.width, height: ganttMetrics.groupHeight, ...pmGanttGridStyle(ganttDayWidth, timeline.gridDays) }}
                  >
                    {selectedColumnMarker}
                    {isPersonGroup
                      ? group.occupancy.availableSegments.map((segment) => {
                          let availableStartIndex = segment.startIndex;
                          while (
                            availableStartIndex <= segment.endIndex &&
                            (timeline.days[availableStartIndex]?.iso ?? "") < currentGanttIso
                          ) {
                            availableStartIndex += 1;
                          }
                          if (availableStartIndex > segment.endIndex) {
                            return null;
                          }
                          const segmentWidth = Math.max(
                            2,
                            (segment.endIndex - availableStartIndex + 1) * ganttDayWidth - 2,
                          );
                          const segmentStartIso = timeline.days[availableStartIndex]?.iso ?? "";
                          const segmentEndIso = timeline.days[segment.endIndex]?.iso ?? "";
                          const segmentTitle =
                            t("pm.gantt.available") +
                            " · " +
                            fullDateText(locale, segmentStartIso) +
                            " - " +
                            fullDateText(locale, segmentEndIso);
                          return (
                            <span
                              key={group.key + "-available-" + String(segment.startIndex)}
                              data-project-management-gantt-available={group.key + "-" + String(availableStartIndex)}
                              aria-hidden="true"
                              title={segmentTitle}
                              className="pointer-events-none absolute inset-y-0 z-[1] flex items-center justify-center border-r border-emerald-200/70 bg-emerald-50/80 text-[length:var(--pm-gantt-available-size,11px)] font-medium text-emerald-700/80"
                              style={{ left: availableStartIndex * ganttDayWidth + 1, width: segmentWidth }}
                            >
                              {segmentWidth >= ganttMetrics.availableLabelMinWidth ? t("pm.gantt.available") : null}
                            </span>
                          );
                        })
                      : null}
                    {group.occupancy.parallelSegments.map((segment) => {
                      const segmentLeft = segment.startIndex * ganttDayWidth + 1;
                      const segmentWidth = Math.max(
                        2,
                        (segment.endIndex - segment.startIndex + 1) * ganttDayWidth - 2,
                      );
                      const segmentStartIso = timeline.days[segment.startIndex]?.iso ?? "";
                      const segmentEndIso = timeline.days[segment.endIndex]?.iso ?? "";
                      const segmentItems = segment.itemIndexes
                        .map((itemIndex) => group.items[itemIndex])
                        .filter((item): item is PmGanttItem => item !== undefined);
                      const segmentTitles = segmentItems.map((item) =>
                        item.row.name.trim() === ""
                          ? item.row.code.trim() || t("pm.board.untitled")
                          : item.row.name.trim(),
                      );
                      const segmentTitle =
                        t("pm.gantt.parallelHint", {
                          n: segment.count,
                          start: fullDateText(locale, segmentStartIso),
                          end: fullDateText(locale, segmentEndIso),
                        }) +
                        (segmentTitles.length === 0 ? "" : " · " + segmentTitles.join(" / "));
                      return (
                        <button
                          key={group.key + "-parallel-" + String(segment.startIndex)}
                          type="button"
                          data-project-management-gantt-parallel={group.key + "-" + String(segment.startIndex)}
                          aria-label={t("pm.gantt.jumpToDates") + " · " + segmentTitle}
                          title={segmentTitle}
                          onClick={() =>
                            revealGanttEntry(group.key + "-parallel-" + String(segment.startIndex), segmentLeft)
                          }
                          className="absolute bottom-1 z-[3] h-1.5 rounded-full bg-amber-400/90 shadow-sm transition hover:bg-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                          style={{ left: segmentLeft, width: segmentWidth }}
                        />
                      );
                    })}
                    {group.occupancy.busySegments.map((segment) => {
                      const segmentLeft = segment.startIndex * ganttDayWidth + 1;
                      const segmentWidth = Math.max(2, (segment.endIndex - segment.startIndex + 1) * ganttDayWidth - 2);
                      const segmentStartIso = timeline.days[segment.startIndex]?.iso ?? "";
                      const segmentEndIso = timeline.days[segment.endIndex]?.iso ?? "";
                      const segmentItems = segment.itemIndexes
                        .map((itemIndex) => group.items[itemIndex])
                        .filter((item): item is PmGanttItem => item !== undefined);
                      const segmentTitles = segmentItems.map((item) =>
                        item.row.name.trim() === "" ? item.row.code.trim() || t("pm.board.untitled") : item.row.name.trim(),
                      );
                      const segmentConflict = isPersonGroup && segment.count > 1;
                      const segmentLabel = segmentConflict
                        ? t("pm.gantt.conflictCount", { n: segment.count })
                        : segmentTitles[0] ?? t("pm.gantt.noDates");
                      const segmentTitle = segmentConflict
                        ? t("pm.gantt.conflictHint", {
                            n: segment.count,
                            start: fullDateText(locale, segmentStartIso),
                            end: fullDateText(locale, segmentEndIso),
                          }) + (segmentTitles.length === 0 ? "" : " · " + segmentTitles.join(" / "))
                        : segmentLabel + " · " + fullDateText(locale, segmentStartIso) + " - " + fullDateText(locale, segmentEndIso);
                      return (
                        <button
                          key={group.key + "-busy-" + String(segment.startIndex)}
                          type="button"
                          data-project-management-gantt-group-segment={group.key + "-" + String(segment.startIndex)}
                          data-project-management-gantt-conflict={segmentConflict ? "true" : undefined}
                          aria-label={t("pm.gantt.jumpToDates") + " · " + segmentTitle}
                          title={segmentTitle}
                          onClick={() => revealGanttEntry(group.key + "-segment-" + String(segment.startIndex), segmentLeft)}
                          className="group absolute top-1/2 z-[2] flex -translate-y-1/2 items-start overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                          style={{ left: segmentLeft, width: segmentWidth, height: ganttMetrics.groupBarHeight }}
                        >
                          <span
                            aria-hidden="true"
                            className={
                              "pointer-events-none absolute inset-x-0 bottom-0 h-2 rounded-full " +
                              (segmentConflict
                                ? "bg-rose-400/85 group-hover:bg-rose-500"
                                : "bg-sky-400/80 group-hover:bg-sky-500")
                            }
                          />
                          <span
                            className={
                              "relative min-w-0 truncate px-0.5 pt-px text-[length:var(--pm-gantt-bar-size,10px)] font-medium leading-[var(--pm-gantt-group-name-leading,16px)] " +
                              (segmentConflict ? "text-rose-700" : "text-zinc-600")
                            }
                          >
                            {segmentLabel}
                          </span>
                        </button>
                      );
                    })}
                    {todayMarker}
                  </div>
                </div>

                {groupCollapsed ? null : group.rows.map(({ item, sequence }) => {
                  const rawStartIndex = item.start === null ? null : indexOfIso(item.start, -1);
                  const rawEndIndex = item.end === null ? null : indexOfIso(item.end, timeline.days.length);
                  const startIndex = rawStartIndex === null ? null : Math.max(0, rawStartIndex);
                  const endIndex =
                    rawEndIndex === null
                      ? null
                      : Math.min(timeline.days.length - 1, rawEndIndex);
                  const barLeft = startIndex === null ? 0 : startIndex * ganttDayWidth + 2;
                  const barWidth =
                    startIndex === null || endIndex === null || endIndex < startIndex
                      ? 0
                      : Math.max(2, (endIndex - startIndex + 1) * ganttDayWidth - 4);
                  const title =
                    item.row.name.trim() === "" ? item.row.code.trim() || t("pm.board.untitled") : item.row.name;
                  const days = item.days ?? 0;
                  const taskKey = group.key + "-" + item.row.clientId;
                  const taskSelected = selectedGanttKey === taskKey;
                  const rowCanJump = barWidth > 0;
                  const taskIsParallel = item.resourceMode === "parallel";
                  const barLabelPlacement = pmGanttBarLabelPlacement(
                    barLeft,
                    barWidth,
                    ganttScrollLeft,
                    ganttTimelineViewportWidth,
                    ganttUiScale,
                  );
                  const methodTitle =
                    item.row.implementationMethod === ""
                      ? ""
                      : t(METHOD_META[item.row.implementationMethod].labelKey);
                  const barTitle =
                    title +
                    (methodTitle === "" ? "" : " · " + methodTitle) +
                    " · " +
                    t("pm.gantt.days", { n: days }) +
                    " · " +
                    fullDateText(locale, item.start ?? "") +
                    " - " +
                    fullDateText(locale, item.end ?? "");
                  return (
                    <div
                      key={taskKey}
                      data-project-management-gantt-row={taskKey}
                      className="flex"
                      style={{ height: ganttMetrics.rowHeight }}
                    >
                      <div
                        role={rowCanJump ? "button" : undefined}
                        tabIndex={rowCanJump ? 0 : undefined}
                        aria-label={rowCanJump ? t("pm.gantt.jumpToDates") + " · " + barTitle : undefined}
                        onClick={rowCanJump ? () => revealGanttEntry(taskKey, barLeft) : undefined}
                        onKeyDown={rowCanJump ? (event) => handleGanttJumpKeyDown(event, taskKey, barLeft) : undefined}
                        className={
                          "sticky left-0 z-20 flex shrink-0 border-b border-zinc-200 shadow-[8px_0_18px_-18px_rgba(15,23,42,0.55)] " +
                          (taskSelected ? "bg-sky-50 " : "bg-white ") +
                          (rowCanJump ? "cursor-pointer hover:bg-sky-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40" : "")
                        }
                        style={{ width: ganttTableWidth }}
                      >
                        <PmGanttProjectCells
                          row={item.row}
                          sequence={sequence}
                          directory={directory}
                          dicts={dicts}
                          columns={ganttColumnLayout.visible}
                          hiddenColumnCount={ganttColumnLayout.hiddenColumnCount}
                          hiddenColumnsLabel={hiddenColumnsLabel}
                          overflowWidth={ganttColumnLayout.overflowWidth}
                          cellPaddingX={ganttMetrics.cellPaddingX}
                        />
                      </div>
                      <div
                        className="relative shrink-0 border-b border-zinc-200 bg-white"
                        style={{ width: timeline.width, height: ganttMetrics.rowHeight, ...pmGanttGridStyle(ganttDayWidth, timeline.gridDays) }}
                      >
                        {selectedColumnMarker}
                        {todayMarker}
                        {barWidth === 0 ? (
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[length:var(--pm-gantt-bar-size,10px)] text-zinc-400">
                            {t("pm.gantt.noDates")}
                          </span>
                        ) : (
                          <>
                            <div
                              aria-hidden="true"
                              data-project-management-gantt-bar={taskKey}
                              className={
                                "absolute top-1/2 z-[2] -translate-y-1/2 rounded-[2px] border transition-colors " +
                                (taskSelected
                                  ? taskIsParallel
                                    ? "border-amber-500 bg-amber-200 ring-2 ring-amber-400/70"
                                    : "border-sky-500 bg-sky-200 ring-2 ring-sky-400/70"
                                  : taskIsParallel
                                    ? "border-amber-300 bg-amber-100"
                                    : "border-sky-300 bg-sky-100")
                              }
                              style={{ left: barLeft, width: barWidth, height: ganttMetrics.taskBarHeight }}
                            />
                            {barLabelPlacement === null ? null : (
                              <div
                                className={
                                  "pointer-events-none absolute top-1/2 z-[4] flex -translate-y-1/2 " +
                                  (barLabelPlacement.edge === "right" ? "justify-end" : "justify-start")
                                }
                                style={{
                                  left: barLabelPlacement.left,
                                  width: barLabelPlacement.maxWidth,
                                }}
                              >
                                <button
                                  type="button"
                                  data-project-management-gantt-bar-label={taskKey}
                                  data-gantt-label-edge={barLabelPlacement.edge ?? "visible"}
                                  aria-label={t("pm.gantt.jumpToDates") + " · " + barTitle}
                                  title={barTitle}
                                  onClick={() => revealGanttEntry(taskKey, barLeft)}
                                  className={
                                    "pointer-events-auto flex min-w-0 items-center gap-1 text-left text-[length:var(--pm-gantt-bar-size,10px)] font-medium transition " +
                                    (taskSelected ? "text-zinc-900" : "text-zinc-600 hover:text-zinc-900")
                                  }
                                  style={{ maxWidth: "100%", height: ganttMetrics.barLabelHeight }}
                                >
                                  <span className="min-w-0 truncate">{title}</span>
                                  <span className="shrink-0 text-[length:var(--pm-gantt-bar-meta-size,9px)] font-normal text-zinc-400">
                                    · {t("pm.gantt.days", { n: days })}
                                  </span>
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </ScrollArea>
      </div>
      )}
    </div>
  );
}


type ProjectManagementPageProps = {
  me: MeResponse;
  dicts: Dicts;
  directory: DirectoryUser[];
  managerCandidates: ProjectManagerCandidate[];
};

const PM_TABLE_BODY_FONT = "400 12px Noto Sans SC, Microsoft YaHei, sans-serif";
const PM_TABLE_HEADER_FONT = "500 12px Noto Sans SC, Microsoft YaHei, sans-serif";
const PM_TABLE_CHIP_FONT = "500 12px Noto Sans SC, Microsoft YaHei, sans-serif";
const PM_TABLE_STRONG_FONT = "600 12px Noto Sans SC, Microsoft YaHei, sans-serif";
const PM_TABLE_CELL_PADDING_X = 16;
const PM_TABLE_CHIP_PADDING_X = 16;
const PM_TABLE_CHIP_MAX_WIDTH = 180;
const PM_TABLE_CONTROL_GAP = 4;
const PM_TABLE_CHEVRON_WIDTH = 12;
const PM_TABLE_ACTIVE_DOT_WIDTH = 6;
const PM_TABLE_VISIBLE_MEMBER_CHIPS = 6;
const PM_TABLE_TEXT_SAFETY = 8;

const pmTableTextWidth = (text: string, font: string = PM_TABLE_BODY_FONT): number =>
  Math.ceil(pmGanttTextWidth(text, font)) + PM_TABLE_TEXT_SAFETY;

const pmTableHeaderWidth = (label: string, filterable: boolean): number =>
  pmTableTextWidth(label, PM_TABLE_HEADER_FONT) +
  PM_TABLE_CELL_PADDING_X +
  (filterable
    ? PM_TABLE_CONTROL_GAP + PM_TABLE_CHEVRON_WIDTH + PM_TABLE_CONTROL_GAP + PM_TABLE_ACTIVE_DOT_WIDTH
    : 0);

const pmTablePlainCellWidth = (text: string): number =>
  pmTableTextWidth(text) + PM_TABLE_CELL_PADDING_X;

const pmTableTagCellWidth = (text: string, withChevron: boolean): number =>
  pmTableTextWidth(text, PM_TABLE_CHIP_FONT) +
  PM_TABLE_CHIP_PADDING_X +
  PM_TABLE_CELL_PADDING_X +
  (withChevron ? PM_TABLE_CONTROL_GAP + PM_TABLE_CHEVRON_WIDTH : 0);

const pmTableMemberCellWidth = (names: readonly string[], font: string = PM_TABLE_CHIP_FONT): number => {
  if (names.length === 0) {
    return 0;
  }
  const visible = names.slice(0, PM_TABLE_VISIBLE_MEMBER_CHIPS);
  const chipWidths = visible.map((name) =>
    Math.min(pmTableTextWidth(name, font) + PM_TABLE_CHIP_PADDING_X, PM_TABLE_CHIP_MAX_WIDTH),
  );
  const rest = names.length - visible.length;
  if (rest > 0) {
    chipWidths.push(pmTableTextWidth("+" + String(rest), PM_TABLE_STRONG_FONT) + PM_TABLE_CHIP_PADDING_X);
  }
  return (
    PM_TABLE_CELL_PADDING_X +
    chipWidths.reduce((total, width) => total + width, 0) +
    PM_TABLE_CONTROL_GAP * Math.max(0, chipWidths.length - 1) +
    PM_TABLE_CONTROL_GAP +
    PM_TABLE_CHEVRON_WIDTH
  );
};

export default function ProjectManagementPage({
  me,
  dicts,
  directory,
  managerCandidates,
}: ProjectManagementPageProps) {
  const t = useT();
  const locale = useLocale();
  const [rows, setRows] = useState<PmRow[]>(createEmptyRows);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PmRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [textFilters, setTextFilters] = useState<Partial<Record<PmTextColumnKey, string>>>({});
  const [multiFilters, setMultiFilters] = useState<Partial<Record<PmMultiColumnKey, string[]>>>({});
  const [methodFilter, setMethodFilter] = useState<ProjectManagementMethod | "">("");
  const [dateSort, setDateSort] = useState<PmDateSort | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<PmViewTabKey>("table");

  const rowsRef = useRef<PmRow[]>(rows);
  const aliveRef = useRef(true);
  const saveQueues = useRef<Map<string, Promise<void>>>(new Map());
  const tableHeaderScrollRef = useRef<HTMLDivElement>(null);
  const tableBodyScrollRef = useRef<HTMLDivElement | null>(null);
  const saveTimers = useRef<Map<string, number>>(new Map());

  const managerOptions = useMemo(() => directoryMemberOptions(managerCandidates), [managerCandidates]);
  const engineerOptions = useMemo(() => directoryMemberOptions(directory), [directory]);
  const stageOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: <span className="text-zinc-500">{t("pm.field.auto")}</span> },
      ...PM_STAGE_KEYS.map((key) => ({
        value: key,
        label: stageText(locale, pmStageNameOf(key)),
      })),
    ],
    [locale, t],
  );
  const managerFilterOptions = useMemo(
    () => collectMemberFilterOptions(rows, (row) => row.managerIds, (row) => row.managerNames, directory, locale),
    [rows, directory, locale],
  );
  const engineerFilterOptions = useMemo(
    () => collectMemberFilterOptions(
      rows,
      (row) => row.implementationEngineerIds,
      (row) => row.implementationEngineerNames,
      directory,
      locale,
    ),
    [rows, directory, locale],
  );
  const locationFilterOptions = useMemo(() => {
    const labels = new Map<string, string>();
    rows.forEach((row) => {
      if (row.region !== "" && row.region !== "未分类") {
        labels.set(row.region, dictLabel(dicts, "region", row.region));
      }
    });
    return Array.from(labels, ([value, label]) => ({ value, label })).sort((left, right) =>
      left.label.localeCompare(right.label, locale),
    );
  }, [rows, dicts, locale]);
  const methodFilterOptions = useMemo(() => {
    const present = new Set(
      rows
        .map((row) => row.implementationMethod)
        .filter((value): value is ProjectManagementMethod => value !== ""),
    );
    return METHOD_KEYS.filter((method) => present.has(method)).map((value) => ({
      value,
      label: t(METHOD_META[value].labelKey),
    }));
  }, [rows, t]);


  const replaceRows = (next: PmRow[]): void => {
    rowsRef.current = next;
    setRows(next);
  };

  const patchRows = (next: PmRow[]): void => {
    replaceRows(keepTrailingEmptyRows(next));
  };

  const patchRow = (clientId: string, patch: Partial<PmRow>): void => {
    patchRows(rowsRef.current.map((row) => (row.clientId === clientId ? { ...row, ...patch } : row)));
  };

  const touchRow = (clientId: string, patch: Partial<PmRow>): void => {
    patchRows(
      rowsRef.current.map((row) =>
        row.clientId === clientId
          ? { ...row, ...patch, revision: row.revision + 1, saveState: "dirty", saveMessage: null }
          : row,
      ),
    );
  };

  const showNotice = (kind: ToastKind, text: string): void => {
    setNotice({ kind, text });
  };

  const errorTextOf = (error: unknown, fallback: string): string => {
    if (error instanceof ApiError) {
      return error.message === "" ? fallback : error.message;
    }
    return fallback;
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      saveTimers.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
      saveTimers.current.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setLoadError(null);
    void fetchProjectManagementRecords()
      .then((records) => {
        if (cancelled) {
          return;
        }
        replaceRows(normalizeRows(records.map(rowFromRecord).filter((row) => !isEmptyRow(row))));
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setLoadState("error");
        setLoadError(errorTextOf(error, t("pm.loadFailed")));
      });
    return () => {
      cancelled = true;
    };
  }, [loadNonce]);

  useEffect(() => {
    if (loadState !== "ready") {
      return;
    }
    let cancelled = false;
    let refreshing = false;
    const refreshSnapshots = (): void => {
      if (cancelled || refreshing || document.visibilityState === "hidden") {
        return;
      }
      refreshing = true;
      void fetchProjectManagementRecords()
        .then((records) => {
          if (cancelled || !aliveRef.current) {
            return;
          }
          const byId = new Map(records.map((record) => [record.id, record]));
          patchRows(
            rowsRef.current.map((row) => {
              if (row.recordId === null) {
                return row;
              }
              const record = byId.get(row.recordId);
              if (record === undefined || record.code.trim() !== row.code.trim()) {
                return row;
              }
              return { ...row, ...snapshotFieldsOf(record) };
            }),
          );
        })
        .catch(() => undefined)
        .finally(() => {
          refreshing = false;
        });
    };
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === "visible") {
        refreshSnapshots();
      }
    };
    const timer = window.setInterval(refreshSnapshots, SNAPSHOT_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshSnapshots);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshSnapshots);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadState]);

  const methodLabel = (value: ProjectManagementMethod): string => t(METHOD_META[value].labelKey);
  const projectOpenLabel = t("pm.project.open");
  const projectOpenHint = t("pm.project.openHint");
  const updateTextFilter = (key: PmTextColumnKey, value: string): void => {
    setTextFilters((current) => ({ ...current, [key]: value }));
  };

  const updateMultiFilter = (key: PmMultiColumnKey, values: string[]): void => {
    setMultiFilters((current) => ({ ...current, [key]: values }));
  };

  const updateDateSort = (key: PmDateColumnKey, direction: "asc" | "desc" | null): void => {
    setDateSort(direction === null ? null : { key, direction });
  };

  const hasActiveFilters =
    Object.values(textFilters).some((value) => (value ?? "").trim() !== "") ||
    Object.values(multiFilters).some((values) => (values?.length ?? 0) > 0) ||
    methodFilter !== "" ||
    dateSort !== null;

  const displayRows = useMemo<PmRow[]>(() => {
    const codeQuery = textFilters.code?.trim() ?? "";
    const nameQuery = textFilters.name?.trim() ?? "";
    const stageQuery = textFilters.stage?.trim() ?? "";
    const managerSelections = multiFilters.manager ?? [];
    const engineerSelections = multiFilters.engineer ?? [];
    const locationSelections = multiFilters.location ?? [];
    const filtering =
      codeQuery !== "" ||
      nameQuery !== "" ||
      stageQuery !== "" ||
      managerSelections.length > 0 ||
      engineerSelections.length > 0 ||
      locationSelections.length > 0 ||
      methodFilter !== "" ||
      dateSort !== null;

    if (!filtering) {
      return rows;
    }

    const matchingRows = rows.filter((row) => {
      if (isEmptyRow(row)) {
        return false;
      }
      if (codeQuery !== "" && !includesFilterText(row.code, codeQuery)) {
        return false;
      }
      if (nameQuery !== "" && !includesFilterText(row.name, nameQuery)) {
        return false;
      }
      const stageValue = effectiveStageOf(row) === null ? "" : stageText(locale, pmStageNameOf(effectiveStageOf(row)));
      if (stageQuery !== "" && !includesFilterText(stageValue, stageQuery)) {
        return false;
      }
      if (managerSelections.length > 0 && !managerSelections.some((value) => row.managerIds.includes(value))) {
        return false;
      }
      if (
        engineerSelections.length > 0 &&
        !engineerSelections.some((value) => row.implementationEngineerIds.includes(value))
      ) {
        return false;
      }
      if (locationSelections.length > 0 && !locationSelections.includes(row.region)) {
        return false;
      }
      if (methodFilter !== "" && row.implementationMethod !== methodFilter) {
        return false;
      }
      return true;
    });

    if (dateSort === null) {
      return matchingRows;
    }

    const direction = dateSort.direction === "asc" ? 1 : -1;
    return matchingRows.slice().sort((left, right) => {
      const leftValue = dateFilterValueOf(left, dateSort.key);
      const rightValue = dateFilterValueOf(right, dateSort.key);
      if (leftValue === null && rightValue === null) {
        return 0;
      }
      if (leftValue === null) {
        return 1;
      }
      if (rightValue === null) {
        return -1;
      }
      if (leftValue === rightValue) {
        return 0;
      }
      return leftValue < rightValue ? -direction : direction;
    });
  }, [rows, textFilters, multiFilters, methodFilter, dateSort, locale]);


  const saveRowNow = async (clientId: string): Promise<void> => {
    const row = rowsRef.current.find((current) => current.clientId === clientId);
    if (row === undefined) {
      return;
    }
    const revisionAtStart = row.revision;
    if (isEmptyRow(row)) {
      if (row.recordId === null || row.version === null) {
        return;
      }
      patchRow(clientId, { saveState: "saving", saveMessage: null });
      try {
        await deleteProjectManagementRecord(row.recordId, row.version);
        if (!aliveRef.current) {
          return;
        }
        const current = rowsRef.current.find((candidate) => candidate.clientId === clientId);
        if (current === undefined) {
          return;
        }
        if (current.revision === revisionAtStart) {
          patchRow(clientId, { ...createEmptyRow(clientId), saveState: "idle" });
        } else {
          patchRow(clientId, {
            recordId: null,
            version: null,
            savedRevision: 0,
            saveState: "dirty",
            saveMessage: null,
          });
          persistRow(clientId);
        }
      } catch (error: unknown) {
        if (!aliveRef.current) {
          return;
        }
        const text = errorTextOf(error, t("pm.saveFailed"));
        patchRow(clientId, { saveState: "error", saveMessage: text });
        showNotice("error", text);
      }
      return;
    }

    const editingExisting = row.recordId !== null;
    if (editingExisting && row.revision === row.savedRevision) {
      return;
    }
    if (editingExisting && row.version === null) {
      return;
    }

    const input = inputOf(row);
    patchRow(clientId, { saveState: "saving", saveMessage: null });
    try {
      const saved = editingExisting
        ? await updateProjectManagementRecord(row.recordId ?? "", input, row.version ?? 0)
        : await createProjectManagementRecord(input);
      if (!aliveRef.current) {
        return;
      }
      const current = rowsRef.current.find((candidate) => candidate.clientId === clientId);
      if (current === undefined) {
        return;
      }
      const stillCurrent = current.revision === revisionAtStart;
      patchRow(clientId, {
        recordId: saved.id,
        version: saved.version,
        ...(stillCurrent
          ? {
              code: saved.code,
              name: saved.name,
              managerIds: saved.managerIds.slice(),
              managerNames: saved.managerNames.slice(),
              implementationEngineerIds: saved.implementationEngineerIds.slice(),
              implementationEngineerNames: saved.implementationEngineerNames.slice(),
              implementationHandedOver: saved.implementationHandedOver,
              implementationMethod: saved.implementationMethod ?? "",
              riskReminder: saved.riskReminder ?? "",
              region: saved.region,
              ...snapshotFieldsOf(saved),
              ...overrideFieldsOf(saved),
            }
          : {}),
        savedRevision: revisionAtStart,
        saveState: stillCurrent ? "idle" : "dirty",
        saveMessage: null,
      });
    } catch (error: unknown) {
      if (!aliveRef.current) {
        return;
      }
      const text = errorTextOf(error, t("pm.saveFailed"));
      patchRow(clientId, { saveState: "error", saveMessage: text });
      showNotice("error", text);
    }
  };

  const persistRow = (clientId: string): void => {
    const previous = saveQueues.current.get(clientId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => saveRowNow(clientId))
      .catch(() => undefined);
    saveQueues.current.set(clientId, next);
    void next.finally(() => {
      if (saveQueues.current.get(clientId) === next) {
        saveQueues.current.delete(clientId);
      }
    });
  };

  const cancelScheduledSave = (clientId: string): void => {
    const timer = saveTimers.current.get(clientId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      saveTimers.current.delete(clientId);
    }
  };

  const schedulePersist = (clientId: string): void => {
    cancelScheduledSave(clientId);
    const timer = window.setTimeout(() => {
      saveTimers.current.delete(clientId);
      persistRow(clientId);
    }, TEXT_AUTOSAVE_DELAY_MS);
    saveTimers.current.set(clientId, timer);
  };

  const flushPersist = (clientId: string): void => {
    cancelScheduledSave(clientId);
    persistRow(clientId);
  };

  const handleTextInput = (row: PmRow, value: string, field: "code" | "name" | "riskReminder"): void => {
    touchRow(row.clientId, field === "code" ? { code: value, ...emptySnapshotFields() } : { [field]: value });
    schedulePersist(row.clientId);
  };

  const handleManagerChange = (row: PmRow, ids: string[]): void => {
    touchRow(row.clientId, {
      managerIds: ids,
      managerNames: namesOf(ids, [], directory),
    });
    persistRow(row.clientId);
  };

  const handleEngineerChange = (row: PmRow, ids: string[]): void => {
    touchRow(row.clientId, {
      implementationEngineerIds: ids,
      implementationEngineerNames: namesOf(ids, [], directory),
      ...(ids.length > 0 ? { implementationHandedOver: false } : {}),
    });
    persistRow(row.clientId);
  };

  const handleStageOverrideChange = (row: PmRow, value: string | null): void => {
    touchRow(row.clientId, { currentStageOverride: value });
    persistRow(row.clientId);
  };

  const handleDateOverrideChange = (row: PmRow, field: PmDateOverrideKey, value: string | null): void => {
    touchRow(row.clientId, { [field]: value });
    persistRow(row.clientId);
  };

  const handleDaysOverrideChange = (row: PmRow, value: number | null): void => {
    touchRow(row.clientId, { implementationDaysOverride: value });
    persistRow(row.clientId);
  };

  const handleEngineerHandedOverToggle = (row: PmRow): void => {
    const handedOver = !row.implementationHandedOver;
    touchRow(row.clientId, {
      implementationHandedOver: handedOver,
      ...(handedOver ? { implementationEngineerIds: [], implementationEngineerNames: [] } : {}),
    });
    persistRow(row.clientId);
  };

  const handleMethodChange = (row: PmRow, value: ProjectManagementMethod): void => {
    if (row.implementationMethod === value) {
      return;
    }
    touchRow(row.clientId, { implementationMethod: value });
    persistRow(row.clientId);
  };

  const handleRegionChange = (row: PmRow, value: string): void => {
    if (row.region === value) {
      return;
    }
    touchRow(row.clientId, { region: value });
    persistRow(row.clientId);
  };

  const clearDraftRow = (clientId: string): void => {
    cancelScheduledSave(clientId);
    patchRows(
      rowsRef.current.map((row) => (row.clientId === clientId ? { ...createEmptyRow(clientId), saveState: "idle" } : row)),
    );
  };

  const requestDelete = (row: PmRow): void => {
    if (row.recordId === null) {
      clearDraftRow(row.clientId);
      return;
    }
    setPendingDelete(row);
  };

  const confirmDelete = async (): Promise<void> => {
    const row = pendingDelete;
    if (row === null || row.recordId === null || row.version === null || deleting) {
      return;
    }
    cancelScheduledSave(row.clientId);
    setDeleting(true);
    try {
      await deleteProjectManagementRecord(row.recordId, row.version);
      if (!aliveRef.current) {
        return;
      }
      const remaining = rowsRef.current.filter((candidate) => candidate.clientId !== row.clientId);
      replaceRows(normalizeRows(remaining));
      setPendingDelete(null);
      showNotice("ok", t("pm.delete.success"));
    } catch (error: unknown) {
      if (aliveRef.current) {
        showNotice("error", errorTextOf(error, t("pm.delete.failed")));
      }
    } finally {
      if (aliveRef.current) {
        setDeleting(false);
      }
    }
  };

  const tableColumnWidths = new Map<PmColumnKey, number>();
  const bumpTableColumnWidth = (key: PmColumnKey, width: number): void => {
    tableColumnWidths.set(key, Math.max(tableColumnWidths.get(key) ?? 0, width));
  };

  COLUMNS.forEach((column) => {
    bumpTableColumnWidth(
      column.key,
      pmTableHeaderWidth(t(column.labelKey), FILTER_KIND_BY_COLUMN[column.key] !== "none"),
    );
  });

  displayRows.forEach((row) => {
    if (row.code.trim() !== "") {
      bumpTableColumnWidth("code", pmTablePlainCellWidth(row.code));
    }
    bumpTableColumnWidth("manager", pmTableMemberCellWidth(displayNamesOf(row.managerIds, row.managerNames, directory)));
    bumpTableColumnWidth(
      "engineer",
      row.implementationHandedOver
        ? pmTableMemberCellWidth([t("pm.engineer.handedOver")], PM_TABLE_STRONG_FONT)
        : pmTableMemberCellWidth(displayNamesOf(row.implementationEngineerIds, row.implementationEngineerNames, directory)),
    );
    if (row.implementationMethod !== "") {
      bumpTableColumnWidth("method", pmTableTagCellWidth(methodLabel(row.implementationMethod), true));
    }
    const stageName = effectiveStageOf(row) === null ? "" : pmStageNameOf(effectiveStageOf(row));
    const stageLabel = stageName === "" ? "" : stageText(locale, stageName);
    if (stageLabel !== "") {
      bumpTableColumnWidth("stage", pmTableTagCellWidth(stageLabel, false));
    }
    const startupValue = effectiveDateOf(row, "startup");
    if (startupValue !== null) {
      bumpTableColumnWidth("startup", pmTablePlainCellWidth(fullDateText(locale, startupValue)));
    }
    const arrivalValue = effectiveDateOf(row, "arrival");
    if (arrivalValue !== null) {
      bumpTableColumnWidth("arrival", pmTablePlainCellWidth(fullDateText(locale, arrivalValue)));
    }
    const regionLabel = row.region === "" || row.region === "未分类" ? "" : dictLabel(dicts, "region", row.region);
    if (regionLabel !== "") {
      bumpTableColumnWidth("location", pmTableTagCellWidth(regionLabel, false));
    }
    const plannedStartValue = effectiveDateOf(row, "start");
    if (plannedStartValue !== null) {
      bumpTableColumnWidth("start", pmTablePlainCellWidth(fullDateText(locale, plannedStartValue)));
    }
    const plannedEndValue = effectiveDateOf(row, "end");
    if (plannedEndValue !== null) {
      bumpTableColumnWidth("end", pmTablePlainCellWidth(fullDateText(locale, plannedEndValue)));
    }
    const daysValue = effectiveDaysOf(row);
    if (daysValue !== null) {
      bumpTableColumnWidth("days", pmTablePlainCellWidth(String(daysValue)));
    }
  });

  const columns = COLUMNS.map((column) => {
    if (column.key === "name" || column.key === "risk") {
      return column;
    }
    const width = Math.max(column.min, Math.ceil(tableColumnWidths.get(column.key) ?? 0));
    return { ...column, width: width + "px", min: width };
  });
  const gridTemplate = ROW_NUMBER_WIDTH + "px " + tableGridTemplate(columns);
  const minWidth = ROW_NUMBER_WIDTH + tableMinWidth(columns);

  return (
    <div className="min-h-screen">
      <AppHeader me={me} />
      <main className="w-full px-4 pb-10 pt-4 sm:px-6">
        <div data-project-management-page="" className="w-full space-y-4">
          {loadState === "error" ? (
            <div
              data-project-management-load-error=""
              className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
            >
              <span>{loadError ?? t("pm.loadFailed")}</span>
              <button
                type="button"
                data-project-management-retry=""
                onClick={() => {
                  setLoadNonce((value) => value + 1);
                }}
                className="rounded-md bg-white px-2 py-1 font-semibold text-rose-700 ring-1 ring-inset ring-rose-200 transition hover:bg-rose-100"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : null}

          <div
            role="tablist"
            aria-label={t("pm.view.tabsAria")}
            data-project-management-view-tabs=""
            className="sticky top-16 z-30 flex min-h-[52px] items-center gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5"
          >
            {PM_VIEW_TABS.map((tab) => {
              const active = tab.key === activeViewTab;
              return (
                <button
                  key={tab.key}
                  id={"pm-view-tab-" + tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={"pm-view-panel-" + tab.key}
                  tabIndex={active ? 0 : -1}
                  data-project-management-view-tab={tab.key}
                  onClick={() => {
                    setActiveViewTab(tab.key);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                      return;
                    }
                    event.preventDefault();
                    const currentIndex = PM_VIEW_TABS.findIndex((item) => item.key === tab.key);
                    const offset = event.key === "ArrowRight" ? 1 : -1;
                    const nextTab = PM_VIEW_TABS[(currentIndex + offset + PM_VIEW_TABS.length) % PM_VIEW_TABS.length];
                    if (nextTab === undefined) {
                      return;
                    }
                    setActiveViewTab(nextTab.key);
                    window.requestAnimationFrame(() => {
                      document.getElementById("pm-view-tab-" + nextTab.key)?.focus();
                    });
                  }}
                  className={
                    "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-400/70 " +
                    (active ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-100/70 hover:text-zinc-900")
                  }
                >
                  <PmViewTabIcon view={tab.key} />
                  <span className="whitespace-nowrap">{t(tab.labelKey)}</span>
                </button>
              );
            })}
            <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-zinc-200" />
          </div>

          <section
            data-project-management-table=""
            role="tabpanel"
            id="pm-view-panel-table"
            aria-labelledby="pm-view-tab-table"
            hidden={activeViewTab !== "table"}
            className="relative rounded-xl border border-zinc-200 bg-white"
          >
            <div role="table" aria-label={t("pm.table.aria")} aria-busy={loadState !== "ready"}>
              <div
                ref={tableHeaderScrollRef}
                data-project-management-head-scroll=""
                className="sticky top-[116px] z-20 overflow-x-hidden bg-white"
              >
                <div style={{ minWidth }}>
                  <div role="rowgroup" className="contents">
                  <div
                    data-project-management-head=""
                    role="row"
                    className="grid h-9 items-center border-b border-zinc-300 bg-zinc-50 text-xs font-medium text-zinc-500"
                    style={{ gridTemplateColumns: gridTemplate, minWidth }}
                  >
                    <span
                      role="columnheader"
                      data-project-management-row-number=""
                      className="flex items-center justify-center self-stretch border-r border-zinc-300 text-xs font-medium text-zinc-400"
                    >
                      {t("pm.column.rowNo")}
                    </span>
                    {columns.map((column, index) => (
                      <ProjectManagementColumnHeader
                        key={column.key}
                        column={column}
                        isFirst={index === 0}
                        textFilters={textFilters}
                        multiFilters={multiFilters}
                        methodFilter={methodFilter}
                        dateSort={dateSort}
                        multiOptions={{
                          manager: managerFilterOptions,
                          engineer: engineerFilterOptions,
                          location: locationFilterOptions,
                        }}
                        methodOptions={methodFilterOptions}
                        onTextFilterChange={updateTextFilter}
                        onMultiFilterChange={updateMultiFilter}
                        onMethodFilterChange={setMethodFilter}
                        onDateSortChange={updateDateSort}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
              <div
                ref={tableBodyScrollRef}
                data-project-management-body-scroll=""
                className="scrollbar-hidden overflow-x-auto"
                onScroll={(event) => {
                  if (tableHeaderScrollRef.current !== null) {
                    tableHeaderScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
                  }
                }}
              >
                <div style={{ minWidth }}>
                  <div
                    data-project-management-grid-editor=""
                    role="rowgroup"
                    className="grid"
                    style={{ gridTemplateColumns: gridTemplate, minWidth }}
                  >
                  {displayRows.map((row, rowIndex) => {
                    const newRow = row.recordId === null;
                    const rowEditable = loadState === "ready";
                    const rowName = row.name.trim() === "" ? row.code : row.name;
                    const projectHref = row.projectId ? PROJECT_BASE_HASH + encodeURIComponent(row.projectId) : null;
                    const rowStatus =
                      row.saveState === "saving"
                        ? t("pm.status.saving")
                        : row.saveState === "error"
                          ? t("pm.status.error")
                          : row.saveState === "dirty"
                            ? t("pm.status.unsaved")
                            : "";
                    return (
                      <div key={row.clientId} role="row" data-project-management-row={row.clientId} className="group contents">
                        <div
                          role="cell"
                          aria-label={t("pm.column.rowNo") + " " + String(rowIndex + 1)}
                          data-project-management-save-state={row.saveState}
                          className={
                            "relative flex min-h-11 items-center justify-center border-r border-zinc-300 bg-white text-xs tabular-nums text-zinc-400 " +
                            (rowIndex < displayRows.length - 1 ? "border-b" : "")
                          }
                        >
                          <span>{rowIndex + 1}</span>
                          {rowStatus === "" ? null : (
                            <span
                              aria-label={rowStatus}
                              title={row.saveMessage ?? rowStatus}
                              className={
                                "absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full " +
                                (row.saveState === "saving"
                                  ? "animate-pulse bg-sky-500"
                                  : row.saveState === "error"
                                    ? "bg-rose-500"
                                    : "bg-amber-400")
                              }
                            />
                          )}
                          {loadState === "ready" ? (
                            <button
                              type="button"
                              aria-label={newRow ? t("pm.clear.aria", { n: rowIndex + 1 }) : t("pm.delete.aria", { name: rowName || String(rowIndex + 1) })}
                              title={newRow ? t("pm.clear.aria", { n: rowIndex + 1 }) : t("pm.delete.aria", { name: rowName || String(rowIndex + 1) })}
                              data-project-management-delete=""
                              onMouseDown={(event) => {
                                event.preventDefault();
                              }}
                              onClick={() => {
                                requestDelete(row);
                              }}
                              className="absolute right-0.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-zinc-300 opacity-0 outline-none transition hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-rose-300 group-hover:opacity-100"
                            >
                              <svg viewBox="0 0 448 512" aria-hidden="true" className="h-2.5 w-2.5">
                                <path
                                  fill="currentColor"
                                  d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"
                                />
                              </svg>
                            </button>
                          ) : null}
                        </div>
                        {columns.map((column, columnIndex) => {
                          const cellKey = String(rowIndex) + "-" + column.key;
                          const ariaLabel = t(column.labelKey) + " " + String(rowIndex + 1);
                          let content = null;
                          if (column.key === "code") {
                            content = (
                              <TextCell
                                value={row.code}
                                readOnly={!rowEditable}
                                ariaLabel={ariaLabel}
                                align="left"
                                multilineOnFocus={false}
                                cellKey={cellKey}
                                isCode
                                maxLength={50}
                                projectHref={projectHref}
                                projectOpenLabel={projectOpenLabel}
                                projectOpenHint={projectOpenHint}
                                onInput={(value) => {
                                  handleTextInput(row, value, "code");
                                }}
                                onBlur={() => {
                                  flushPersist(row.clientId);
                                }}
                              />
                            );
                          } else if (column.key === "name") {
                            content = (
                              <TextCell
                                value={row.name}
                                readOnly={!rowEditable}
                                ariaLabel={ariaLabel}
                                align="left"
                                multilineOnFocus
                                cellKey={cellKey}
                                maxLength={200}
                                projectHref={projectHref}
                                projectOpenLabel={projectOpenLabel}
                                projectOpenHint={projectOpenHint}
                                onInput={(value) => {
                                  handleTextInput(row, value, "name");
                                }}
                                onBlur={() => {
                                  flushPersist(row.clientId);
                                }}
                              />
                            );
                          } else if (column.key === "manager") {
                            content = (
                              <MemberCell
                                label={joinedNames(row.managerIds, row.managerNames, directory)}
                                names={displayNamesOf(row.managerIds, row.managerNames, directory)}
                                placeholder={t("pm.manager.placeholder")}
                                ariaLabel={ariaLabel}
                                disabled={!rowEditable}
                                options={managerOptions}
                                selectedIds={row.managerIds}
                                multiple
                                cellKey={cellKey}
                                onChange={(ids) => {
                                  handleManagerChange(row, ids);
                                }}
                              />
                            );
                          } else if (column.key === "engineer") {
                            content = (
                              <MemberCell
                                label={
                                  row.implementationHandedOver
                                    ? t("pm.engineer.handedOver")
                                    : joinedNames(row.implementationEngineerIds, row.implementationEngineerNames, directory)
                                }
                                names={displayNamesOf(row.implementationEngineerIds, row.implementationEngineerNames, directory)}
                                placeholder={t("pm.engineer.placeholder")}
                                ariaLabel={ariaLabel}
                                disabled={!rowEditable}
                                options={engineerOptions}
                                selectedIds={row.implementationEngineerIds}
                                multiple
                                cellKey={cellKey}
                                topStatusButton={{
                                  label: t("pm.engineer.handedOver"),
                                  active: row.implementationHandedOver,
                                  onToggle: () => {
                                    handleEngineerHandedOverToggle(row);
                                  },
                                }}
                                onChange={(ids) => {
                                  handleEngineerChange(row, ids);
                                }}
                              />
                            );
                          } else if (column.key === "method") {
                            content = (
                              <MethodCell
                                value={row.implementationMethod}
                                label={row.implementationMethod === "" ? "" : methodLabel(row.implementationMethod)}
                                placeholder={t("pm.method.placeholder")}
                                ariaLabel={ariaLabel}
                                disabled={!rowEditable}
                                cellKey={cellKey}
                                labelOf={methodLabel}
                                onChange={(value) => {
                                  handleMethodChange(row, value);
                                }}
                              />
                            );
                          } else if (column.key === "stage") {
                            const effectiveStage = effectiveStageOf(row);
                            const stageName = effectiveStage === null ? "" : pmStageNameOf(effectiveStage);
                            const stageLabel = stageName === "" ? "" : stageText(locale, stageName);
                            content = rowEditable ? (
                              <div data-project-management-cell={cellKey} className="flex min-h-11 items-stretch">
                                <InlineOptionCell
                                  value={row.currentStageOverride ?? ""}
                                  options={stageOptions}
                                  ariaLabel={ariaLabel}
                                  bare
                                  triggerClassName="min-h-11 w-full !justify-start px-2 py-3 !text-left text-xs leading-5 text-zinc-600 hover:bg-blue-50/40"
                                  display={stageLabel === "" ? <span className="text-zinc-300">—</span> : <span className={PM_TABLE_TAG_CLASS + " " + pmStageTagClass(stageName)}>{stageLabel}</span>}
                                  onPick={(value) => {
                                    handleStageOverrideChange(row, value === "" ? null : value);
                                  }}
                                />
                              </div>
                            ) : (
                              <ReadOnlyStageCell stageName={stageName} value={stageLabel} label={ariaLabel} cellKey={cellKey} />
                            );
                          } else if (column.key === "startup") {
                            const value = effectiveDateOf(row, "startup");
                            content = rowEditable ? (
                              <EditableDateCell
                                valueIso={value ?? ""}
                                display={value === null ? "" : fullDateText(locale, value)}
                                ariaLabel={ariaLabel}
                                cellKey={cellKey}
                                showAuto
                                onChange={(iso) => {
                                  handleDateOverrideChange(row, "startupCompletedAtOverride", iso === "" ? null : iso);
                                }}
                              />
                            ) : (
                              <ReadOnlyCell value={value === null ? "" : fullDateText(locale, value)} label={ariaLabel} cellKey={cellKey} />
                            );
                          } else if (column.key === "arrival") {
                            const value = effectiveDateOf(row, "arrival");
                            content = rowEditable ? (
                              <EditableDateCell
                                valueIso={value ?? ""}
                                display={value === null ? "" : fullDateText(locale, value)}
                                ariaLabel={ariaLabel}
                                cellKey={cellKey}
                                showAuto
                                onChange={(iso) => {
                                  handleDateOverrideChange(row, "arrivalDateOverride", iso === "" ? null : iso);
                                }}
                              />
                            ) : (
                              <ReadOnlyCell value={value === null ? "" : fullDateText(locale, value)} label={ariaLabel} cellKey={cellKey} />
                            );
                          } else if (column.key === "start") {
                            const value = effectiveDateOf(row, "start");
                            content = rowEditable ? (
                              <EditableDateCell
                                valueIso={value ?? ""}
                                display={value === null ? "" : fullDateText(locale, value)}
                                ariaLabel={ariaLabel}
                                cellKey={cellKey}
                                showAuto
                                onChange={(iso) => {
                                  handleDateOverrideChange(row, "plannedStartDateOverride", iso === "" ? null : iso);
                                }}
                              />
                            ) : (
                              <ReadOnlyCell value={value === null ? "" : fullDateText(locale, value)} label={ariaLabel} cellKey={cellKey} />
                            );
                          } else if (column.key === "end") {
                            const value = effectiveDateOf(row, "end");
                            content = rowEditable ? (
                              <EditableDateCell
                                valueIso={value ?? ""}
                                display={value === null ? "" : fullDateText(locale, value)}
                                ariaLabel={ariaLabel}
                                cellKey={cellKey}
                                showAuto
                                onChange={(iso) => {
                                  handleDateOverrideChange(row, "plannedEndDateOverride", iso === "" ? null : iso);
                                }}
                              />
                            ) : (
                              <ReadOnlyCell value={value === null ? "" : fullDateText(locale, value)} label={ariaLabel} cellKey={cellKey} />
                            );
                          } else if (column.key === "days") {
                            const value = effectiveDaysOf(row);
                            content = rowEditable ? (
                              <DaysCell
                                value={value}
                                ariaLabel={ariaLabel}
                                cellKey={cellKey}
                                onChange={(next) => {
                                  handleDaysOverrideChange(row, next);
                                }}
                              />
                            ) : (
                              <ReadOnlyCell value={value === null ? "" : String(value)} label={ariaLabel} cellKey={cellKey} />
                            );
                          } else if (column.key === "risk") {
                            content = (
                              <TextCell
                                value={row.riskReminder}
                                readOnly={!rowEditable}
                                ariaLabel={ariaLabel}
                                align="left"
                                multilineOnFocus
                                allowLineBreaks
                                cellKey={cellKey}
                                maxLength={2000}
                                onInput={(value) => {
                                  handleTextInput(row, value, "riskReminder");
                                }}
                                onBlur={() => {
                                  flushPersist(row.clientId);
                                }}
                              />
                            );
                          } else if (column.key === "location") {
                            const regionLabel = row.region === "" || row.region === "未分类" ? "" : dictLabel(dicts, "region", row.region);
                            content = rowEditable ? (
                              <div data-project-management-cell={cellKey}>
                                <RegionSelect
                                  value={row.region === "未分类" ? "" : row.region}
                                  valueLabel={regionLabel}
                                  items={dicts.region}
                                  usedRegions={NO_USED_REGIONS}
                                  onChange={(value) => {
                                    handleRegionChange(row, value);
                                  }}
                                  triggerClassName="flex min-h-11 w-full min-w-0 items-center justify-start gap-1 px-2 py-3 text-left text-xs leading-5 outline-none transition hover:bg-blue-50/40 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500"
                                  showChevron={false}
                                  valueClassName={PM_TABLE_TAG_CLASS + " " + memberFilterToneOf(regionLabel)}
                                />
                              </div>
                            ) : (
                              <div
                                data-project-management-cell={cellKey}
                                className="flex min-h-11 min-w-0 items-center justify-start overflow-hidden px-2 py-3 text-left"
                              >
                                {regionLabel === "" ? (
                                  <span className="text-zinc-300">—</span>
                                ) : (
                                  <span className={PM_TABLE_TAG_CLASS + " " + memberFilterToneOf(regionLabel)} title={regionLabel}>
                                    {regionLabel}
                                  </span>
                                )}
                              </div>
                            );
                          } else {
                            content = (
                              <BlankCell
                                label={ariaLabel}
                                cellKey={cellKey}
                              />
                            );
                          }

                          return (
                            <div
                              key={row.clientId + "-" + column.key}
                              role="cell"
                              className={
                                "relative min-h-11 min-w-0 border-zinc-300 " +
                                (rowIndex < displayRows.length - 1 ? "border-b " : "") +
                                (columnIndex < columns.length - 1 ? "border-r" : "")
                              }
                            >
                              {content}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {hasActiveFilters && displayRows.length === 0 ? (
                    <div role="row" className="contents">
                      <div
                        role="cell"
                        style={{ gridColumn: "1 / -1" }}
                        className="flex min-h-20 items-center justify-center border-b border-zinc-200 px-4 text-xs text-zinc-400"
                      >
                        {t("pm.filter.noMatch")}
                      </div>
                    </div>
                  ) : null}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {activeViewTab === "implementationGantt" ? (
            <section
              role="tabpanel"
              id="pm-view-panel-implementationGantt"
              aria-labelledby="pm-view-tab-implementationGantt"
              data-project-management-gantt-panel=""
              className="min-h-[280px]"
            >
              <PmImplementationGantt rows={rows} directory={directory} dicts={dicts} />
            </section>
          ) : null}
        </div>
        <FixedHorizontalScrollbar
          scrollRef={tableBodyScrollRef}
          active={activeViewTab === "table"}
          ariaLabel={t("pm.table.aria")}
        />
      </main>

      {pendingDelete === null ? null : (
        <ToastConfirm
          text={t("pm.delete.confirm", { name: pendingDelete.name.trim() === "" ? pendingDelete.code : pendingDelete.name })}
          ariaLabel={t("pm.delete.aria", { name: pendingDelete.name.trim() === "" ? pendingDelete.code : pendingDelete.name })}
          cancelLabel={t("common.cancel")}
          confirmLabel={t("common.delete")}
          confirmDisabled={deleting}
          onCancel={() => {
            if (!deleting) {
              setPendingDelete(null);
            }
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      )}
      {notice === null ? null : (
        <Toast
          kind={notice.kind}
          text={notice.text}
          onClose={() => {
            setNotice(null);
          }}
        />
      )}
    </div>
  );
}
