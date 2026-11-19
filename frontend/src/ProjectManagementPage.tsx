import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "./api";
import { AppHeader } from "./components/AppHeader";
import { InlineCell, InlineDateCell, InlineOptionCell } from "./components/InlineEdit";
import { MemberAvatar, MemberSearchList, type SearchListStatusButton } from "./components/MemberSelect";
import { ScrollArea } from "./components/ScrollArea";
import { CARD_BODY as KANBAN_CARD_BODY, CARD_NOISE as KANBAN_CARD_NOISE, CARD_SHELL as KANBAN_CARD_SHELL, COLUMN_SHELL as KANBAN_COLUMN_SHELL, STAGE_TAG_CLASS } from "./components/TaskKanban";
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
  "presale",
  "design",
  "purchase",
  "assembly",
  "install",
  "deploy",
  "trial",
  "production",
  "acceptance",
] as const;

const PM_VIEW_TABS = [
  { key: "table", labelKey: "pm.view.table" },
  { key: "ownerKanban", labelKey: "pm.view.ownerKanban" },
  { key: "implementationKanban", labelKey: "pm.view.implementationKanban" },
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
const METHOD_KEYS: readonly ProjectManagementMethod[] = [
  "onsite_installation_guidance",
  "remote_installation_guidance",
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
  if (view === "ownerKanban" || view === "implementationKanban") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
        <rect x="3" y="3" width="7" height="18" rx="1.8" />
        <rect x="14" y="3" width="7" height="18" rx="1.8" />
        <circle cx="6.5" cy="7" r="1.25" />
        <path d="M5.5 12h2M16.5 8.5h2" />
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
  cellKey: string;
  isCode?: boolean;
  maxLength?: number;
  projectHref?: string | null;
  projectOpenLabel?: string;
  projectOpenHint?: string;
  onInput: (value: string) => void;
  onBlur: () => void;
};

function TextCell({
  value,
  readOnly,
  ariaLabel,
  align,
  multilineOnFocus,
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
      aria-multiline="false"
      aria-label={ariaLabel}
      spellCheck={false}
      data-project-management-cell={cellKey}
      data-project-management-code={isCode ? "" : undefined}
      onInput={(event) => {
        const raw = event.currentTarget.textContent ?? "";
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
        const pasted = event.clipboardData.getData("text/plain").replace(/\s*\r?\n\s*/g, " ");
        const text = maxLength === undefined ? pasted : pasted.slice(0, maxLength);
        document.execCommand("insertText", false, text);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
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
        <span className={PM_TABLE_TAG_CLASS + " " + (STAGE_TAG_CLASS[stageName] ?? "bg-zinc-200 text-zinc-600")}>
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
type PmBoardMode = "manager" | "engineer";

type PmBoardGroup = {
  key: string;
  label: string;
  member: Member | null;
  items: PmRow[];
  unassigned: boolean;
};

const memberDisplayNames = (
  ids: readonly string[],
  names: ReadonlyArray<string | null>,
  directory: readonly DirectoryUser[],
): string[] =>
  ids.map((id, index) => names[index] ?? directory.find((user) => user.id === id)?.displayName ?? id);

const buildPmBoardGroups = (
  rows: readonly PmRow[],
  mode: PmBoardMode,
  directory: readonly DirectoryUser[],
  locale: string,
  unassignedLabel: string,
): PmBoardGroup[] => {
  const unassigned: PmBoardGroup = {
    key: "pm-board-unassigned-" + mode,
    label: unassignedLabel,
    member: null,
    items: [],
    unassigned: true,
  };
  const assigned = new Map<string, PmBoardGroup>();
  rows.forEach((row) => {
    if (isEmptyRow(row)) {
      return;
    }
    const ids = mode === "manager" ? row.managerIds : row.implementationEngineerIds;
    const names = mode === "manager" ? row.managerNames : row.implementationEngineerNames;
    if (ids.length === 0) {
      unassigned.items.push(row);
      return;
    }
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) {
        return;
      }
      seen.add(id);
      let group = assigned.get(id);
      if (group === undefined) {
        const user = directory.find((candidate) => candidate.id === id);
        group = {
          key: "pm-board-" + mode + "-" + id,
          label: names[index] ?? user?.displayName ?? id,
          member: user === undefined ? null : { id: user.id, name: user.displayName, handle: user.username },
          items: [],
          unassigned: false,
        };
        assigned.set(id, group);
      }
      group.items.push(row);
    });
  });
  const assignedGroups = Array.from(assigned.values()).sort((left, right) =>
    left.label.localeCompare(right.label, locale),
  );
  return [unassigned, ...assignedGroups];
};

function PmBoardAvatar({ member }: { member: Member | null }) {
  if (member !== null) {
    return <MemberAvatar member={member} />;
  }
  return (
    <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[11px] font-semibold text-zinc-500">
      ?
    </span>
  );
}

function PmBoardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function PmBoardMemberChip({ name }: { name: string }) {
  return (
    <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + memberFilterToneOf(name)}>
      {name}
    </span>
  );
}

function PmBoardCard({ row, directory }: { row: PmRow; directory: readonly DirectoryUser[] }) {
  const t = useT();
  const locale = useLocale();
  const title = row.name.trim() === "" ? (row.code.trim() === "" ? t("pm.board.untitled") : row.code.trim()) : row.name.trim();
  const managerNames = memberDisplayNames(row.managerIds, row.managerNames, directory);
  const engineerNames = memberDisplayNames(row.implementationEngineerIds, row.implementationEngineerNames, directory);
  const stage = effectiveStageOf(row);
  const stageName = stage === null ? "" : stageNameOf(stage);
  const stageLabel = stageName === "" ? "" : stageText(locale, stageName);
  const plannedStart = effectiveDateOf(row, "start");
  const plannedEnd = effectiveDateOf(row, "end");
  const method = row.implementationMethod;
  const methodLabel = method === "" ? "" : t(METHOD_META[method].labelKey);
  return (
    <article
      aria-label={t("pm.board.card.aria", { name: title })}
      data-project-management-board-card={row.clientId}
      className={KANBAN_CARD_SHELL}
    >
      <span aria-hidden="true" className={KANBAN_CARD_NOISE} />
      <div className={KANBAN_CARD_BODY}>
        <p className="break-words text-sm font-bold leading-5 text-zinc-900">{title}</p>
        <PmBoardField label={t("pm.column.code")}>
          <span className="text-xs font-medium tabular-nums text-zinc-700">{row.code.trim() === "" ? "—" : row.code}</span>
        </PmBoardField>
        <PmBoardField label={t("pm.column.manager")}>
          {managerNames.length === 0 ? (
            <span className="text-xs text-zinc-400">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {managerNames.map((name, index) => (
                <PmBoardMemberChip key={row.clientId + "-manager-" + String(index)} name={name} />
              ))}
            </div>
          )}
        </PmBoardField>
        <PmBoardField label={t("pm.column.engineer")}>
          {row.implementationHandedOver ? (
            <span className={PM_TABLE_TAG_CLASS + " bg-[#f02b2b] font-semibold text-white"}>{t("pm.engineer.handedOver")}</span>
          ) : engineerNames.length === 0 ? (
            <span className="text-xs text-zinc-400">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {engineerNames.map((name, index) => (
                <PmBoardMemberChip key={row.clientId + "-engineer-" + String(index)} name={name} />
              ))}
            </div>
          )}
        </PmBoardField>
        <PmBoardField label={t("pm.column.method")}>
          {method === "" ? (
            <span className="text-xs text-zinc-400">—</span>
          ) : (
            <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + METHOD_META[method].chipClass}>{methodLabel}</span>
          )}
        </PmBoardField>
        <PmBoardField label={t("pm.column.stage")}>
          {stageLabel === "" ? (
            <span className="text-xs text-zinc-400">—</span>
          ) : (
            <span className={"inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " + (STAGE_TAG_CLASS[stageName] ?? "bg-zinc-200 text-zinc-600")}>{stageLabel}</span>
          )}
        </PmBoardField>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-zinc-500">{t("pm.column.planStart")}</p>
            <p className="mt-1 text-xs font-medium tabular-nums text-zinc-800">{plannedStart === null ? "—" : fullDateText(locale, plannedStart)}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500">{t("pm.column.planEnd")}</p>
            <p className="mt-1 text-xs font-medium tabular-nums text-zinc-800">{plannedEnd === null ? "—" : fullDateText(locale, plannedEnd)}</p>
          </div>
        </div>
        {row.riskReminder.trim() === "" ? null : (
          <PmBoardField label={t("pm.column.risk")}>
            <p className="break-words text-xs leading-5 text-rose-600">{row.riskReminder}</p>
          </PmBoardField>
        )}
      </div>
    </article>
  );
}

function PmKanbanBoard({ mode, rows, directory }: { mode: PmBoardMode; rows: readonly PmRow[]; directory: readonly DirectoryUser[] }) {
  const t = useT();
  const locale = useLocale();
  const unassignedLabel = t(mode === "manager" ? "pm.board.group.unassignedManager" : "pm.board.group.unassignedEngineer");
  const groups = useMemo(
    () => buildPmBoardGroups(rows, mode, directory, locale, unassignedLabel),
    [rows, mode, directory, locale, unassignedLabel],
  );
  return (
    <div data-project-management-board={mode}>
      <ScrollArea
        axis="horizontal"
        thumbAlwaysVisible
        ariaLabel={t(mode === "manager" ? "pm.board.ariaManager" : "pm.board.ariaEngineer")}
        viewportClassName="pb-3"
        className="flex items-start gap-4"
      >
        {groups.map((group) => (
          <section key={group.key} data-project-management-board-column={group.key} className={KANBAN_COLUMN_SHELL}>
            <header className="mb-3 flex items-center gap-2 px-1">
              <PmBoardAvatar member={group.member} />
              <span className="truncate text-sm font-medium text-zinc-700" title={group.label}>{group.label}</span>
              <span className="shrink-0 text-xs text-zinc-400">{t("pm.board.count", { n: group.items.length })}</span>
            </header>
            <ScrollArea
              viewportClassName="min-h-0 flex-1"
              className="flex flex-col gap-3 pr-1"
              ariaLabel={t("pm.board.card.scrollAria", { name: group.label })}
            >
              {group.items.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-zinc-300 bg-white/70 px-4 py-10 text-center text-xs text-zinc-400">{t("pm.board.empty")}</div>
              ) : (
                group.items.map((row) => <PmBoardCard key={row.clientId} row={row} directory={directory} />)
              )}
            </ScrollArea>
          </section>
        ))}
      </ScrollArea>
    </div>
  );
}

type PmGanttItem = {
  row: PmRow;
  start: string | null;
  end: string | null;
  days: number | null;
};

type PmGanttGroupKind = "person" | "handedOver" | "unassigned";

type PmGanttGroup = {
  key: string;
  label: string;
  kind: PmGanttGroupKind;
  items: PmGanttItem[];
};

type PmGanttColumn = {
  key: "rowNo" | "code" | "name" | "manager" | "engineer" | "method" | "stage" | "location";
  minWidth: number;
  labelKey: TextKey | null;
};

const PM_GANTT_COLUMNS: readonly PmGanttColumn[] = [
  { key: "rowNo", minWidth: 40, labelKey: null },
  { key: "code", minWidth: 156, labelKey: "pm.column.code" },
  { key: "name", minWidth: 120, labelKey: "pm.column.name" },
  { key: "manager", minWidth: 86, labelKey: "pm.column.manager" },
  { key: "engineer", minWidth: 96, labelKey: "pm.column.engineer" },
  { key: "method", minWidth: 92, labelKey: "pm.column.method" },
  { key: "stage", minWidth: 88, labelKey: "pm.column.stage" },
  { key: "location", minWidth: 70, labelKey: "pm.column.location" },
];

const PM_GANTT_MIN_TABLE_WIDTH = 360;
const PM_GANTT_OVERFLOW_WIDTH = 38;
const PM_GANTT_TABLE_WIDTH_STORAGE_KEY = "libiaolink.pm.gantt.tableWidth";

type PmGanttColumnLayoutEntry = {
  column: PmGanttColumn;
  width: number;
};

const pmGanttClampWidth = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

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

const PM_GANTT_CELL_PADDING = 20;
const PM_GANTT_CELL_SAFETY = 8;
const PM_GANTT_CHIP_PADDING = 16;
const PM_GANTT_CHIP_GAP = 4;
const PM_GANTT_TEXT_FONT = "500 13px Noto Sans SC, Microsoft YaHei, sans-serif";
const PM_GANTT_CHIP_FONT = "500 12px Noto Sans SC, Microsoft YaHei, sans-serif";
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

const pmGanttTextCellWidth = (text: string): number =>
  Math.ceil(pmGanttTextWidth(text)) + PM_GANTT_CELL_PADDING + PM_GANTT_CELL_SAFETY;

const pmGanttChipTextWidth = (text: string, font: string = PM_GANTT_CHIP_FONT): number =>
  Math.ceil(pmGanttTextWidth(text, font)) + PM_GANTT_CHIP_PADDING + PM_GANTT_CELL_SAFETY;

const pmGanttMembersCellWidth = (names: readonly string[]): number => {
  if (names.length === 0) {
    return pmGanttTextCellWidth("—");
  }
  const visible = names.slice(0, 2);
  const rest = names.length - visible.length;
  const chipWidths = visible.map((name) => pmGanttChipTextWidth(name));
  if (rest > 0) {
    chipWidths.push(pmGanttChipTextWidth("+" + String(rest)));
  }
  return chipWidths.reduce((total, width) => total + width, 0) +
    PM_GANTT_CHIP_GAP * Math.max(0, chipWidths.length - 1) +
    PM_GANTT_CELL_PADDING;
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
const PM_GANTT_HEADER_HEIGHT = 64;
const PM_GANTT_GROUP_HEIGHT = 44;
const PM_GANTT_ROW_HEIGHT = 58;
const PM_GANTT_GROUP_BAR_HEIGHT = 6;
const PM_GANTT_DAY_MS = 86_400_000;
const PM_GANTT_BAR_LABEL_GAP = 8;
const PM_GANTT_BAR_LABEL_MAX_WIDTH = 360;

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
): PmGanttBarLabelPlacement | null => {
  if (barWidth <= 0 || viewportWidth <= PM_GANTT_BAR_LABEL_GAP * 2) {
    return null;
  }
  const visibleStart = Math.max(0, scrollLeft);
  const visibleEnd = visibleStart + viewportWidth;
  const barEnd = barLeft + barWidth;
  const edgeMaxWidth = Math.min(
    PM_GANTT_BAR_LABEL_MAX_WIDTH,
    Math.max(0, viewportWidth - PM_GANTT_BAR_LABEL_GAP * 2),
  );
  if (edgeMaxWidth < 72) {
    return null;
  }
  if (barEnd <= visibleStart) {
    return {
      edge: "left",
      left: visibleStart + PM_GANTT_BAR_LABEL_GAP,
      maxWidth: edgeMaxWidth,
    };
  }
  if (barLeft >= visibleEnd) {
    return {
      edge: "right",
      left: visibleEnd - edgeMaxWidth - PM_GANTT_BAR_LABEL_GAP,
      maxWidth: edgeMaxWidth,
    };
  }
  const visibleBarStart = Math.max(barLeft, visibleStart);
  return {
    edge: null,
    left: visibleBarStart + PM_GANTT_BAR_LABEL_GAP,
    maxWidth: edgeMaxWidth,
  };
};

const pmGanttTimeOf = (iso: string): number => Date.parse(iso + "T00:00:00Z");

const pmGanttIsoOf = (time: number): string => new Date(time).toISOString().slice(0, 10);

const pmGanttAddDays = (iso: string, days: number): string => pmGanttIsoOf(pmGanttTimeOf(iso) + days * PM_GANTT_DAY_MS);

const pmGanttAddMonths = (iso: string, months: number): string => {
  const date = new Date(pmGanttTimeOf(iso));
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, daysInTargetMonth));
  return pmGanttIsoOf(date.getTime());
};

const pmGanttShiftByScale = (
  iso: string,
  scale: PmGanttScale,
  direction: -1 | 1,
): string => {
  if (scale === "week") {
    return pmGanttAddDays(iso, direction * 7);
  }
  if (scale === "month") {
    return pmGanttAddMonths(iso, direction);
  }
  if (scale === "quarter") {
    return pmGanttAddMonths(iso, direction * 3);
  }
  return pmGanttAddMonths(iso, direction * 12);
};

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
    items: [],
    seen: new Set<string>(),
  };
  const unassigned: PmGanttBucket = {
    key: "pm-gantt-unassigned",
    label: unassignedLabel,
    kind: "unassigned",
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
  const bucketFor = (id: string, label: string): PmGanttBucket => {
    let bucket = people.get(id);
    if (bucket === undefined) {
      bucket = {
        key: "pm-gantt-person-" + id,
        label,
        kind: "person",
        items: [],
        seen: new Set<string>(),
      };
      people.set(id, bucket);
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
      addItem(bucketFor(id, managerNames[index] ?? id), item);
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
      addItem(bucketFor(id, engineerNames[index] ?? id), item);
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
      items: bucket.items,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, locale));
  const specialGroups = [handedOver, unassigned]
    .filter((bucket) => bucket.items.length > 0)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      kind: bucket.kind,
      items: bucket.items,
    }));
  return [...personGroups, ...specialGroups];
};

const pmGanttGroupTone = (group: PmGanttGroup): string => {
  if (group.kind === "handedOver") {
    return "bg-[#f02b2b] text-white";
  }
  if (group.kind === "unassigned") {
    return "bg-zinc-200 text-zinc-600";
  }
  return memberFilterToneOf(group.label);
};

function PmMemberChips({
  names,
  max = 2,
}: {
  names: readonly string[];
  max?: number;
}) {
  if (names.length === 0) {
    return <span className="text-zinc-400">—</span>;
  }
  const visible = names.slice(0, max);
  const rest = names.length - visible.length;
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {visible.map((name, index) => (
        <span
          key={name + "-" + String(index)}
          title={name}
          className={PM_TABLE_TAG_CLASS + " max-w-[180px] shrink-0 " + memberFilterToneOf(name)}
        >
          {name}
        </span>
      ))}
      {rest > 0 ? (
        <span
          title={names.join(", ")}
          className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[12px] font-medium text-zinc-500"
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
}: {
  row: PmRow;
  sequence: number;
  directory: readonly DirectoryUser[];
  dicts: Dicts;
  columns: readonly PmGanttColumnLayoutEntry[];
  hiddenColumnCount: number;
  hiddenColumnsLabel: string;
  overflowWidth: number;
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
  const stageName = stage === null ? "" : stageNameOf(stage);
  const stageLabel = stageName === "" ? "" : stageText(locale, stageName);
  const locationLabel =
    row.region === "" || row.region === "未分类" ? "" : dictLabel(dicts, "region", row.region);
  const cellClass =
    "flex min-w-0 items-center overflow-hidden whitespace-nowrap border-r border-zinc-200 px-2.5 text-[13px] text-zinc-700";

  return (
    <>
      {columns.map(({ column, width }, columnIndex) => {
        let content: ReactNode = null;
        if (column.key === "rowNo") {
          content = <span className="tabular-nums text-zinc-400">{sequence}</span>;
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
          content = <PmMemberChips names={managerNames} />;
        } else if (column.key === "engineer") {
          content = row.implementationHandedOver ? (
            <span className="rounded bg-[#f02b2b] px-1.5 py-0.5 text-[12px] font-semibold text-white">
              {t("pm.engineer.handedOver")}
            </span>
          ) : (
            <PmMemberChips names={engineerNames} />
          );
        } else if (column.key === "method") {
          content =
            method === "" ? (
              <span className="text-zinc-400">—</span>
            ) : (
              <span className={PM_TABLE_TAG_CLASS + " " + METHOD_META[method].chipClass} title={t(METHOD_META[method].labelKey)}>
                {t(METHOD_META[method].labelKey)}
              </span>
            );
        } else if (column.key === "stage") {
          content =
            stageLabel === "" ? (
              <span className="text-zinc-400">—</span>
            ) : (
              <span
                className={
                  PM_TABLE_TAG_CLASS + " " +
                  (STAGE_TAG_CLASS[stageName] ?? "bg-zinc-200 text-zinc-600")
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
                className={PM_TABLE_TAG_CLASS + " " + memberFilterToneOf(locationLabel)}
                title={locationLabel}
              >
                {locationLabel}
              </span>
            );
        }
        return (
          <div
            key={column.key}
            style={{ width }}
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
          className="flex min-w-0 items-center justify-center border-r-0 border-zinc-200 text-[11px] font-medium tabular-nums text-zinc-400"
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
  const groups = useMemo(
    () => buildPmGanttGroups(rows, directory, locale, handedOverLabel, unassignedLabel),
    [rows, directory, locale, handedOverLabel, unassignedLabel],
  );
  const ganttColumnWidths = useMemo(() => {
    const widths = new Map<PmGanttColumn["key"], number>(
      PM_GANTT_COLUMNS.map((column) => [column.key, column.minWidth]),
    );
    const bump = (key: PmGanttColumn["key"], width: number): void => {
      widths.set(key, Math.max(widths.get(key) ?? 0, Math.ceil(width)));
    };
    PM_GANTT_COLUMNS.forEach((column) => {
      if (column.labelKey !== null) {
        bump(column.key, pmGanttTextCellWidth(t(column.labelKey)));
      }
    });
    groups.forEach((group) => {
      group.items.forEach((item) => {
        const row = item.row;
        bump("code", pmGanttTextCellWidth(row.code.trim() === "" ? "—" : row.code));
        bump("name", pmGanttTextCellWidth(row.name.trim() === "" ? t("pm.board.untitled") : row.name));
        bump(
          "manager",
          pmGanttMembersCellWidth(memberDisplayNames(row.managerIds, row.managerNames, directory)),
        );
        if (row.implementationHandedOver) {
          bump(
            "engineer",
            pmGanttChipTextWidth(t("pm.engineer.handedOver"), "600 12px Noto Sans SC, Microsoft YaHei, sans-serif") +
              PM_GANTT_CELL_PADDING,
          );
        } else {
          bump(
            "engineer",
            pmGanttMembersCellWidth(
              memberDisplayNames(row.implementationEngineerIds, row.implementationEngineerNames, directory),
            ),
          );
        }
        const method = row.implementationMethod;
        bump(
          "method",
          method === ""
            ? pmGanttTextCellWidth("—")
            : pmGanttChipTextWidth(t(METHOD_META[method].labelKey)) + PM_GANTT_CELL_PADDING,
        );
        const stage = effectiveStageOf(row);
        const stageName = stage === null ? "" : stageNameOf(stage);
        const stageLabel = stageName === "" ? "" : stageText(locale, stageName);
        bump(
          "stage",
          stageLabel === ""
            ? pmGanttTextCellWidth("—")
            : pmGanttChipTextWidth(stageLabel) + PM_GANTT_CELL_PADDING,
        );
        const locationLabel =
          row.region === "" || row.region === "未分类" ? "" : dictLabel(dicts, "region", row.region);
        bump(
          "location",
          locationLabel === ""
            ? pmGanttTextCellWidth("—")
            : pmGanttChipTextWidth(locationLabel) + PM_GANTT_CELL_PADDING,
        );
      });
    });
    return PM_GANTT_COLUMNS.map((column) => widths.get(column.key) ?? column.minWidth);
  }, [dicts, directory, groups, locale, t]);
  const ganttNaturalWidth = ganttColumnWidths.reduce((total, width) => total + width, 0);
  const [ganttWidthOverride, setGanttWidthOverride] = useState<number | null>(pmGanttReadStoredTableWidth);
  const [ganttResizing, setGanttResizing] = useState(false);
  const [ganttResizeHovered, setGanttResizeHovered] = useState(false);
  const ganttResizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const ganttMinWidth = Math.min(PM_GANTT_MIN_TABLE_WIDTH, ganttNaturalWidth);
  const ganttTableWidth = Math.round(
    pmGanttClampWidth(ganttWidthOverride ?? ganttNaturalWidth, ganttMinWidth, ganttNaturalWidth),
  );
  const ganttScrollShellRef = useRef<HTMLDivElement | null>(null);
  const ganttScrollViewportRef = useRef<HTMLDivElement | null>(null);
  const [ganttScrollLeft, setGanttScrollLeft] = useState(0);
  const [ganttViewportWidth, setGanttViewportWidth] = useState(0);
  const [selectedGanttKey, setSelectedGanttKey] = useState<string | null>(null);
  const [selectedGanttColumnKey, setSelectedGanttColumnKey] = useState<string | null>(null);
  const ganttTimelineViewportWidth = Math.max(0, ganttViewportWidth - ganttTableWidth);
  const [ganttScale, setGanttScale] = useState<PmGanttScale>("month");
  const [ganttAnchorIso, setGanttAnchorIso] = useState<string>(pmGanttTodayIso);
  const [ganttScrollRequest, setGanttScrollRequest] = useState<{
    iso: string;
    behavior: ScrollBehavior;
    id: number;
  }>(() => ({ iso: pmGanttTodayIso(), behavior: "auto", id: 0 }));
  const ganttScrollRequestIdRef = useRef(0);
  const ganttScaleConfig = PM_GANTT_SCALES[ganttScale];
  const ganttDayWidth = ganttScaleConfig.dayWidth;
  const requestGanttScroll = (iso: string, behavior: ScrollBehavior): void => {
    ganttScrollRequestIdRef.current += 1;
    setGanttScrollRequest({
      iso,
      behavior,
      id: ganttScrollRequestIdRef.current,
    });
  };
  const toggleGanttColumn = (key: string): void => {
    setSelectedGanttColumnKey((current) => (current === key ? null : key));
  };
  const goToGanttToday = (): void => {
    const today = pmGanttTodayIso();
    setGanttAnchorIso(today);
    requestGanttScroll(today, "auto");
  };

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
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", sync);
      observer.disconnect();
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      if (ganttScrollViewportRef.current === viewport) {
        ganttScrollViewportRef.current = null;
      }
    };
  }, []);

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
        setGanttWidthOverride(nextWidth);
      }
    };
    const handleEnd = (event: PointerEvent): void => {
      const finalWidth = widthForPointer(event);
      setGanttResizing(false);
      ganttResizeStartRef.current = null;
      if (finalWidth !== null) {
        setGanttWidthOverride(finalWidth);
        pmGanttStoreTableWidth(finalWidth);
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
  }, [ganttMinWidth, ganttNaturalWidth, ganttResizing]);

  const ganttColumnLayout = useMemo(() => {
    const allColumns: PmGanttColumnLayoutEntry[] = PM_GANTT_COLUMNS.map((column, index) => ({
      column,
      width: ganttColumnWidths[index] ?? column.minWidth,
    }));
    const visible: PmGanttColumnLayoutEntry[] = [];
    let usedWidth = 0;
    for (let index = 0; index < allColumns.length; index += 1) {
      const entry = allColumns[index];
      const hasMore = index < allColumns.length - 1;
      const reserve = hasMore ? PM_GANTT_OVERFLOW_WIDTH : 0;
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
    if (remainingWidth < 24 && visible.length > 1) {
      const removed = visible.pop();
      if (removed !== undefined) {
        usedWidth -= removed.width;
        hiddenColumnCount += 1;
        remainingWidth = ganttTableWidth - usedWidth;
      }
    }
    const extraWidth = Math.max(0, remainingWidth - PM_GANTT_OVERFLOW_WIDTH);
    if (extraWidth > 0) {
      const lastIndex = visible.length - 1;
      visible[lastIndex] = { ...visible[lastIndex], width: visible[lastIndex].width + extraWidth };
      usedWidth += extraWidth;
    }
    return {
      visible,
      hiddenColumnCount,
      overflowWidth: Math.max(24, ganttTableWidth - usedWidth),
    };
  }, [ganttColumnWidths, ganttTableWidth]);

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
    viewport.scrollTo({ left: Math.max(0, barLeft), behavior: "smooth" });
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
      const step = event.shiftKey ? 32 : 12;
      const next = pmGanttClampWidth(
        ganttTableWidth + (event.key === "ArrowLeft" ? -step : step),
        ganttMinWidth,
        ganttNaturalWidth,
      );
      setGanttWidthOverride(next);
      pmGanttStoreTableWidth(next);
    } else if (event.key === "Home") {
      event.preventDefault();
      resetGanttWidth();
    }
  };

  const timeline = useMemo(() => {
    const today = pmGanttTodayIso();
    const todayTime = pmGanttTimeOf(today);
    const anchorTime = pmGanttTimeOf(ganttAnchorIso);
    const scaleConfig = PM_GANTT_SCALES[ganttScale];
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

    let rangeStart = startTime - scaleConfig.paddingDays * PM_GANTT_DAY_MS;
    let rangeEnd = endTime + scaleConfig.paddingDays * PM_GANTT_DAY_MS;
    let dayCount =
      Math.round((rangeEnd - rangeStart) / PM_GANTT_DAY_MS) + 1;
    if (dayCount < scaleConfig.minDays) {
      const extraDays = scaleConfig.minDays - dayCount;
      rangeStart -= Math.floor(extraDays / 2) * PM_GANTT_DAY_MS;
      rangeEnd += Math.ceil(extraDays / 2) * PM_GANTT_DAY_MS;
      dayCount = Math.round((rangeEnd - rangeStart) / PM_GANTT_DAY_MS) + 1;
    }
    if (ganttScale === "year") {
      const startDate = new Date(rangeStart);
      const endDate = new Date(rangeEnd);
      rangeStart = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1);
      rangeEnd = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 0);
    } else if (ganttScale === "quarter") {
      const startDate = new Date(rangeStart);
      const endDate = new Date(rangeEnd);
      rangeStart -= ((startDate.getUTCDay() + 6) % 7) * PM_GANTT_DAY_MS;
      rangeEnd += (6 - ((endDate.getUTCDay() + 6) % 7)) * PM_GANTT_DAY_MS;
    }
    dayCount = Math.round((rangeEnd - rangeStart) / PM_GANTT_DAY_MS) + 1;

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
      width: days.length * scaleConfig.dayWidth,
      dayWidth: scaleConfig.dayWidth,
      gridDays: scaleConfig.gridDays,
      todayIndex: findTodayIndex(),
    };
  }, [ganttAnchorIso, ganttScale, groups, intlLocale]);

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
  const ganttAnchorLabels = useMemo(() => {
    const date = new Date(pmGanttTimeOf(ganttViewportReferenceIso));
    return {
      year: new Intl.DateTimeFormat(intlLocale, {
        year: "numeric",
        timeZone: "UTC",
      }).format(date),
      date: new Intl.DateTimeFormat(intlLocale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(date),
    };
  }, [ganttViewportReferenceIso, intlLocale]);
  const selectGanttScale = (nextScale: PmGanttScale): void => {
    const referenceIso = ganttViewportReferenceIso;
    setGanttScale(nextScale);
    setGanttAnchorIso(referenceIso);
    setSelectedGanttColumnKey(null);
    requestGanttScroll(referenceIso, "auto");
  };
  const shiftGanttAnchor = (direction: -1 | 1): void => {
    const nextIso = pmGanttShiftByScale(ganttViewportReferenceIso, ganttScale, direction);
    setGanttAnchorIso(nextIso);
    requestGanttScroll(nextIso, "auto");
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
    if (
      viewport === null ||
      ganttTimelineViewportWidth <= 0 ||
      timeline.todayIndex < 0
    ) {
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
    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    viewport.scrollTo({
      left: Math.max(
        0,
        Math.min(maxScroll, targetLeft - ganttTimelineViewportWidth / 3),
      ),
      behavior: ganttScrollRequest.behavior,
    });
  }, [
    ganttDayWidth,
    ganttScrollRequest,
    ganttTimelineViewportWidth,
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
      return {
        ...group,
        groupStart,
        groupEnd,
        groupDays:
          groupStart === null || groupEnd === null ? null : inclusiveDaysBetween(groupStart, groupEnd),
        rows: group.items.map((item) => {
          sequence += 1;
          return { item, sequence };
        }),
      };
    });
  }, [groups]);

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

  if (renderedGroups.length === 0) {
    return (
      <div
        data-project-management-gantt="empty"
        className="flex min-h-[280px] items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-sm text-zinc-400"
      >
        {t("pm.gantt.empty")}
      </div>
    );
  }

  return (
    <div
      ref={ganttScrollShellRef}
      data-project-management-gantt="implementation"
      data-project-management-gantt-scale={ganttScale}
      className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
    >
      <div
        data-project-management-gantt-toolbar="true"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2.5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label={t("pm.gantt.previousPeriod")}
            title={t("pm.gantt.previousPeriod")}
            onClick={() => shiftGanttAnchor(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-4 w-4">
              <path d="m7.5 4-4 4 4 4M12.5 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="whitespace-nowrap text-[14px] font-medium text-zinc-700">
            {ganttAnchorLabels.year}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <span
            data-project-management-gantt-date-label="true"
            className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-zinc-400"
          >
            {ganttAnchorLabels.date}
          </span>
          <div className="flex items-center rounded-lg border border-zinc-200 bg-white p-0.5">
            <button
              type="button"
              aria-label={t("pm.gantt.previousPeriod")}
              title={t("pm.gantt.previousPeriod")}
              onClick={() => shiftGanttAnchor(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                <path d="m10 4-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              data-project-management-gantt-today-button="true"
              onClick={goToGanttToday}
              className="h-7 rounded-md px-2.5 text-[12px] font-medium text-zinc-700 transition hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              {t("pm.gantt.today")}
            </button>
            <button
              type="button"
              aria-label={t("pm.gantt.nextPeriod")}
              title={t("pm.gantt.nextPeriod")}
              onClick={() => shiftGanttAnchor(1)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
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
                    "h-7 min-w-9 rounded-md px-2.5 text-[12px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 " +
                    (active
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-800")
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <ScrollArea
        axis="horizontal"
        thumbAlwaysVisible
        ariaLabel={t("pm.gantt.aria")}
        viewportClassName="min-h-0"
        className="min-w-full pb-3"
      >
        <div className="min-w-max">
          <div className="flex" style={{ height: PM_GANTT_HEADER_HEIGHT }}>
            <div
              className="sticky left-0 z-30 flex shrink-0 border-b border-zinc-300 bg-zinc-50 shadow-[8px_0_18px_-18px_rgba(15,23,42,0.55)]"
              style={{ width: ganttTableWidth }}
            >
              {ganttColumnLayout.visible.map(({ column, width }, columnIndex) => (
                <div
                  key={column.key}
                  style={{ width }}
                  className={
                    "flex h-full min-w-0 items-center justify-center overflow-hidden border-r border-zinc-300 px-2.5 text-center text-[13px] font-medium text-zinc-600 " +
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
                  className="flex h-full min-w-0 items-center justify-center border-r-0 border-zinc-300 text-[11px] font-medium tabular-nums text-zinc-400"
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
                className="absolute -right-2 top-1/2 z-40 flex h-9 w-5 -translate-y-1/2 cursor-col-resize items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-400 shadow-sm transition hover:border-blue-300 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                <svg viewBox="0 0 12 16" fill="none" aria-hidden="true" className="h-4 w-3">
                  <path d="M4.5 4.5 2 8l2.5 3.5M7.5 4.5 10 8l-2.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {ganttResizing || ganttResizeHovered ? (
                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-1 text-[12px] font-medium text-zinc-600 shadow-md">
                  {t("pm.gantt.tableWidth", { n: ganttTableWidth })}
                </span>
              ) : null}
            </div>
            <div
              className="relative shrink-0 border-b border-zinc-300 bg-zinc-50"
              style={{ width: timeline.width }}
            >
              <div className="flex h-8 border-b border-zinc-200">
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
                        "flex min-w-0 items-center justify-center border-r border-zinc-200 px-2 text-[13px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 " +
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
              <div className="flex h-8">
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
                            (timeline.headerMode === "month-week" ? "text-[10px] " : "text-[12px] ") +
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
                            (ganttScale === "week" ? "gap-1 text-[12px] " : "text-[10px] ") +
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

          {renderedGroups.map((group) => {
            const groupStartIndex =
              group.groupStart === null ? null : indexOfIso(group.groupStart, -1);
            const groupEndIndex =
              group.groupEnd === null ? null : indexOfIso(group.groupEnd, timeline.days.length);
            const groupBarLeft =
              groupStartIndex === null ? 0 : groupStartIndex * ganttDayWidth + 2;
            const groupBarWidth =
              groupStartIndex === null || groupEndIndex === null
                ? 0
                : Math.max(2, (groupEndIndex - groupStartIndex + 1) * ganttDayWidth - 4);
            const groupLabelPlacement = pmGanttBarLabelPlacement(
              groupBarLeft,
              groupBarWidth,
              ganttScrollLeft,
              ganttTimelineViewportWidth,
            );
            const groupCanJump = groupStartIndex !== null;
            const groupSelected = selectedGanttKey === group.key;
            const groupTitle =
              group.label +
              " · " +
              t("pm.gantt.days", { n: group.groupDays ?? 0 }) +
              " · " +
              fullDateText(locale, group.groupStart ?? "") +
              " - " +
              fullDateText(locale, group.groupEnd ?? "");
            return (
              <div key={group.key} data-project-management-gantt-group={group.key}>
                <div className="flex" style={{ height: PM_GANTT_GROUP_HEIGHT }}>
                  <div
                    role={groupCanJump ? "button" : undefined}
                    tabIndex={groupCanJump ? 0 : undefined}
                    aria-label={groupCanJump ? t("pm.gantt.jumpToDates") + " · " + groupTitle : undefined}
                    onClick={groupCanJump ? () => revealGanttEntry(group.key, groupBarLeft) : undefined}
                    onKeyDown={groupCanJump ? (event) => handleGanttJumpKeyDown(event, group.key, groupBarLeft) : undefined}
                    className={
                      "sticky left-0 z-20 flex shrink-0 items-center gap-2 border-b border-zinc-300 px-3 shadow-[8px_0_18px_-18px_rgba(15,23,42,0.55)] " +
                      (groupSelected ? "bg-sky-50 " : "bg-white ") +
                      (groupCanJump ? "cursor-pointer hover:bg-sky-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40" : "")
                    }
                    style={{ width: ganttTableWidth }}
                  >
                    <span aria-hidden="true" className="text-[11px] text-zinc-500">
                      ▾
                    </span>
                    <span
                      className={"max-w-[240px] truncate rounded-[3px] px-2 py-1 text-[14px] font-semibold " + pmGanttGroupTone(group)}
                      title={group.label}
                    >
                      {group.label}
                    </span>
                    <span className="ml-4 shrink-0 text-[13px] text-zinc-500">
                      {t("pm.gantt.totalCount", { n: group.items.length })}
                    </span>
                  </div>
                  <div
                    className="relative shrink-0 border-b border-zinc-200 bg-white"
                    style={{ width: timeline.width, height: PM_GANTT_GROUP_HEIGHT, ...pmGanttGridStyle(ganttDayWidth, timeline.gridDays) }}
                  >
                    {selectedColumnMarker}
                    {todayMarker}
                    {groupBarWidth === 0 ? null : (
                      <>
                        <div
                          aria-hidden="true"
                          className={
                            "absolute top-1/2 z-[2] -translate-y-1/2 rounded-full transition-colors " +
                            (groupSelected ? "bg-sky-500" : "bg-zinc-400/90")
                          }
                          style={{
                            left: groupBarLeft,
                            width: groupBarWidth,
                            height: PM_GANTT_GROUP_BAR_HEIGHT,
                          }}
                        />
                        {groupLabelPlacement === null ? null : (
                          <div
                            className={
                              "pointer-events-none absolute z-[4] flex " +
                              (groupLabelPlacement.edge === "right" ? "justify-end" : "justify-start")
                            }
                            style={{
                              left: groupLabelPlacement.left,
                              top: 4,
                              width: groupLabelPlacement.maxWidth,
                            }}
                          >
                            <button
                              type="button"
                              data-project-management-gantt-bar-label={group.key}
                              data-gantt-label-edge={groupLabelPlacement.edge ?? "visible"}
                              aria-label={t("pm.gantt.jumpToDates") + " · " + groupTitle}
                              title={groupTitle}
                              onClick={() => revealGanttEntry(group.key, groupBarLeft)}
                              className={
                                "pointer-events-auto flex h-6 min-w-0 items-center gap-1 rounded-[3px] border px-1.5 text-left text-[12px] font-semibold shadow-sm transition " +
                                (groupSelected
                                  ? "border-sky-400 bg-sky-100 text-sky-900 "
                                  : "border-zinc-300 bg-white/95 text-zinc-700 hover:border-sky-300 hover:text-sky-700 ")
                              }
                              style={{ maxWidth: "100%" }}
                            >
                              {groupLabelPlacement.edge === "right" ? null : (
                                <span aria-hidden="true" className="shrink-0 text-zinc-500">←</span>
                              )}
                              <span className="min-w-0 truncate">{group.label}</span>
                              <span className="shrink-0 text-[11px] font-normal text-zinc-500">
                                · {t("pm.gantt.days", { n: group.groupDays ?? 0 })}
                              </span>
                              {groupLabelPlacement.edge === "right" ? (
                                <span aria-hidden="true" className="shrink-0 text-zinc-500">→</span>
                              ) : null}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {group.rows.map(({ item, sequence }) => {
                  const startIndex = item.start === null ? null : indexOfIso(item.start, -1);
                  const endIndex = item.end === null ? null : indexOfIso(item.end, timeline.days.length);
                  const barLeft = startIndex === null ? 0 : startIndex * ganttDayWidth + 2;
                  const barWidth =
                    startIndex === null || endIndex === null
                      ? 0
                      : Math.max(2, (endIndex - startIndex + 1) * ganttDayWidth - 4);
                  const title =
                    item.row.name.trim() === "" ? item.row.code.trim() || t("pm.board.untitled") : item.row.name;
                  const days = item.days ?? 0;
                  const taskKey = group.key + "-" + item.row.clientId;
                  const taskSelected = selectedGanttKey === taskKey;
                  const rowCanJump = startIndex !== null;
                  const barLabelPlacement = pmGanttBarLabelPlacement(
                    barLeft,
                    barWidth,
                    ganttScrollLeft,
                    ganttTimelineViewportWidth,
                  );
                  const barTitle =
                    title +
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
                      style={{ height: PM_GANTT_ROW_HEIGHT }}
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
                        />
                      </div>
                      <div
                        className="relative shrink-0 border-b border-zinc-200 bg-white"
                        style={{ width: timeline.width, height: PM_GANTT_ROW_HEIGHT, ...pmGanttGridStyle(ganttDayWidth, timeline.gridDays) }}
                      >
                        {selectedColumnMarker}
                        {todayMarker}
                        {barWidth === 0 ? (
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-zinc-400">
                            {t("pm.gantt.noDates")}
                          </span>
                        ) : (
                          <>
                            <div
                              aria-hidden="true"
                              data-project-management-gantt-bar={taskKey}
                              className={
                                "absolute top-1/2 z-[2] h-8 -translate-y-1/2 rounded-[2px] border transition-colors " +
                                (taskSelected
                                  ? "border-sky-500 bg-sky-200 ring-2 ring-sky-400/70"
                                  : "border-sky-300 bg-sky-100")
                              }
                              style={{ left: barLeft, width: barWidth }}
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
                                    "pointer-events-auto flex h-7 min-w-0 items-center gap-1.5 rounded-[2px] border px-2 text-left text-[12px] font-semibold shadow-sm transition " +
                                    (taskSelected
                                      ? "border-sky-400 bg-sky-100 text-sky-900 "
                                      : "border-sky-200/90 bg-sky-50/90 text-sky-900 hover:border-sky-400 hover:bg-sky-100 ")
                                  }
                                  style={{ maxWidth: "100%" }}
                                >
                                  {barLabelPlacement.edge === "right" ? null : (
                                    <span aria-hidden="true" className="shrink-0 text-sky-600">←</span>
                                  )}
                                  <span className="min-w-0 truncate">{title}</span>
                                  <span className="shrink-0 text-[11px] font-normal text-sky-700">
                                    · {t("pm.gantt.days", { n: days })}
                                  </span>
                                  {barLabelPlacement.edge === "right" ? (
                                    <span aria-hidden="true" className="shrink-0 text-sky-600">→</span>
                                  ) : null}
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
  const saveTimers = useRef<Map<string, number>>(new Map());

  const managerOptions = useMemo(() => directoryMemberOptions(managerCandidates), [managerCandidates]);
  const engineerOptions = useMemo(() => directoryMemberOptions(directory), [directory]);
  const stageOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: <span className="text-zinc-500">{t("pm.field.auto")}</span> },
      ...PM_STAGE_KEYS.map((key) => ({
        value: key,
        label: stageText(locale, stageNameOf(key)),
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
      const stageValue = effectiveStageOf(row) === null ? "" : stageText(locale, stageNameOf(effectiveStageOf(row)));
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
    const stageName = effectiveStageOf(row) === null ? "" : stageNameOf(effectiveStageOf(row));
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
            className="flex min-h-[52px] items-center gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5"
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
                className="sticky top-16 z-20 overflow-x-hidden bg-white"
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
                data-project-management-body-scroll=""
                className="overflow-x-auto"
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
                            const stageName = effectiveStage === null ? "" : stageNameOf(effectiveStage);
                            const stageLabel = stageName === "" ? "" : stageText(locale, stageName);
                            content = rowEditable ? (
                              <div data-project-management-cell={cellKey} className="flex min-h-11 items-stretch">
                                <InlineOptionCell
                                  value={row.currentStageOverride ?? ""}
                                  options={stageOptions}
                                  ariaLabel={ariaLabel}
                                  bare
                                  triggerClassName="min-h-11 w-full !justify-start px-2 py-3 !text-left text-xs leading-5 text-zinc-600 hover:bg-blue-50/40"
                                  display={stageLabel === "" ? <span className="text-zinc-300">—</span> : <span className={PM_TABLE_TAG_CLASS + " " + (STAGE_TAG_CLASS[stageName] ?? "bg-zinc-200 text-zinc-600")}>{stageLabel}</span>}
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

          {activeViewTab === "ownerKanban" ? (
            <section
              role="tabpanel"
              id="pm-view-panel-ownerKanban"
              aria-labelledby="pm-view-tab-ownerKanban"
              data-project-management-kanban="manager"
              className="min-h-[280px]"
            >
              <PmKanbanBoard mode="manager" rows={rows} directory={directory} />
            </section>
          ) : null}

          {activeViewTab === "implementationKanban" ? (
            <section
              role="tabpanel"
              id="pm-view-panel-implementationKanban"
              aria-labelledby="pm-view-tab-implementationKanban"
              data-project-management-kanban="engineer"
              className="min-h-[280px]"
            >
              <PmKanbanBoard mode="engineer" rows={rows} directory={directory} />
            </section>
          ) : null}

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
