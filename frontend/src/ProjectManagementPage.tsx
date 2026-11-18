import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "./api";
import { AppHeader } from "./components/AppHeader";
import { InlineCell, InlineDateCell, InlineOptionCell } from "./components/InlineEdit";
import { MemberSearchList, type SearchListStatusButton } from "./components/MemberSelect";
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
const CODE_CHAR_WIDTH = 8;
const CODE_PADDING = 24;
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
  { key: "code", labelKey: "pm.column.code", width: "180px", min: CODE_MIN_WIDTH },
  { key: "name", labelKey: "pm.column.name", width: "200px", min: 200 },
  { key: "manager", labelKey: "pm.column.manager", width: "1fr", min: 110 },
  { key: "engineer", labelKey: "pm.column.engineer", width: "1.08fr", min: 120 },
  { key: "method", labelKey: "pm.column.method", width: "0.96fr", min: 110 },
  { key: "stage", labelKey: "pm.column.stage", width: "1.08fr", min: 130 },
  { key: "startup", labelKey: "pm.column.started", width: "0.9fr", min: 110 },
  { key: "risk", labelKey: "pm.column.risk", width: "1.35fr", min: 160 },
  { key: "arrival", labelKey: "pm.column.arrival", width: "0.92fr", min: 110 },
  { key: "location", labelKey: "pm.column.location", width: "1.14fr", min: 130 },
  { key: "start", labelKey: "pm.column.planStart", width: "1.02fr", min: 120 },
  { key: "end", labelKey: "pm.column.planEnd", width: "1.02fr", min: 120 },
  { key: "days", labelKey: "pm.column.days", width: "0.62fr", min: 80 },
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
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
];

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
  onInput,
  onBlur,
}: TextCellProps) {
  const nodeRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (node !== null && document.activeElement !== node && node.textContent !== value) {
      node.textContent = value;
    }
  }, [value]);

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

  return (
    <div
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
      onBlur={onBlur}
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
  const text = label === "" ? placeholder : label;

  if (disabled) {
    return (
      <div
        data-project-management-cell={cellKey}
        className="min-h-11 truncate px-2 py-3 text-xs leading-5 text-zinc-400"
      >
        {label}
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
        className="flex min-h-11 w-full min-w-0 items-center justify-center gap-1 px-2 py-3 text-xs leading-5 outline-none transition hover:bg-blue-50/40 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500"
      >
        <span
          className={
            "min-w-0 truncate " +
            (statusActive ? "font-medium text-red-600" : label === "" ? "text-zinc-300" : "text-zinc-700")
          }
        >
          {text}
        </span>
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
      <div data-project-management-cell={cellKey} className="flex min-h-11 items-center justify-center px-2 py-3 text-xs leading-5">
        {value === "" ? null : (
          <span className={"max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-medium " + METHOD_META[value].chipClass}>
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
        className="flex min-h-11 w-full min-w-0 items-center justify-center gap-1 px-2 py-3 text-xs leading-5 outline-none transition hover:bg-blue-50/40 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500"
      >
        {value === "" ? (
          <span className="truncate text-zinc-300">{placeholder}</span>
        ) : (
          <span className={"max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-medium " + METHOD_META[value].chipClass}>
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

function ReadOnlyCell({ value, label, cellKey }: { value: string; label: string; cellKey: string }) {
  return (
    <div
      aria-label={label}
      data-project-management-cell={cellKey}
      title={value === "" ? undefined : value}
      className="min-h-11 truncate px-2 py-3 text-center text-xs leading-5 text-zinc-600"
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
        triggerClassName="min-h-11 w-full justify-center px-2 py-3 text-xs leading-5 tabular-nums text-zinc-600 hover:bg-blue-50/40"
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
        triggerClassName="min-h-11 w-full justify-center px-2 py-3 text-xs leading-5 tabular-nums text-zinc-600 hover:bg-blue-50/40"
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
        <span className={"flex h-full items-center px-2 " + (isFirst ? "justify-start pl-4" : "justify-center")}>
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
            "flex h-full w-full min-w-0 items-center gap-1.5 px-2 outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 " +
            (isFirst ? "justify-start pl-4 " : "justify-center ") +
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
                          <span className={"max-w-full truncate rounded px-1.5 py-0.5 text-xs font-medium " + memberFilterToneOf(option.value)}>
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
                          <span className={"max-w-full truncate rounded px-1.5 py-0.5 text-xs font-medium " + METHOD_META[option.value as ProjectManagementMethod].chipClass}>
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
type ProjectManagementPageProps = {
  me: MeResponse;
  dicts: Dicts;
  directory: DirectoryUser[];
  managerCandidates: ProjectManagerCandidate[];
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

  const codeWidth = rows.reduce(
    (width, row) => Math.max(width, row.code.length * CODE_CHAR_WIDTH + CODE_PADDING),
    CODE_MIN_WIDTH,
  );
  const columns = COLUMNS.map((column) =>
    column.key === "code" ? { ...column, width: codeWidth + "px", min: codeWidth } : column,
  );
  const activeViewLabelKey = PM_VIEW_TABS.find((tab) => tab.key === activeViewTab)?.labelKey ?? "pm.view.table";
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
                            const stageLabel = effectiveStage === null ? "" : stageText(locale, stageNameOf(effectiveStage));
                            content = rowEditable ? (
                              <div data-project-management-cell={cellKey} className="flex min-h-11 items-stretch">
                                <InlineOptionCell
                                  value={row.currentStageOverride ?? ""}
                                  options={stageOptions}
                                  ariaLabel={ariaLabel}
                                  bare
                                  triggerClassName="min-h-11 w-full !justify-center px-2 py-3 !text-center text-xs leading-5 text-zinc-600 hover:bg-blue-50/40"
                                  display={stageLabel === "" ? <span className="text-zinc-300">—</span> : <span>{stageLabel}</span>}
                                  onPick={(value) => {
                                    handleStageOverrideChange(row, value === "" ? null : value);
                                  }}
                                />
                              </div>
                            ) : (
                              <ReadOnlyCell value={stageLabel} label={ariaLabel} cellKey={cellKey} />
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
                                align="center"
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
                                  triggerClassName="flex min-h-11 w-full min-w-0 items-center justify-center gap-1 px-2 py-3 text-center text-xs leading-5 outline-none transition hover:bg-blue-50/40 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500"
                                  showChevron={false}
                                />
                              </div>
                            ) : (
                              <div
                                data-project-management-cell={cellKey}
                                className="min-h-11 truncate px-2 py-3 text-xs leading-5 text-zinc-400"
                              >
                                {regionLabel}
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

          {activeViewTab === "table" ? null : (
            <section
              role="tabpanel"
              id={"pm-view-panel-" + activeViewTab}
              aria-labelledby={"pm-view-tab-" + activeViewTab}
              data-project-management-view-placeholder={activeViewTab}
              className="flex min-h-[280px] items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center"
            >
              <div className="max-w-sm">
                <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">
                  <PmViewTabIcon view={activeViewTab} />
                </span>
                <p className="mt-3 text-sm font-semibold text-zinc-800">{t(activeViewLabelKey)}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{t("pm.view.pending")}</p>
              </div>
            </section>
          )}
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
