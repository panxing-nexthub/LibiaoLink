import ExcelJS from "exceljs";
import {
  EXPORT_FONT_NAME,
  EXPORT_HEADER_HEIGHT_PX,
  EXPORT_HEADER_ROW_HEIGHT,
  exportHeaderWidthPx,
  renderProjectExportHeader,
} from "./project-export.header.js";
import {
  bodyRowHeightPx,
  EXPORT_PX_PER_POINT,
  fittedColumnWidth,
  headerRowHeightPx,
} from "./export-layout.js";

/** 项目导出工作簿：纯数据 + 已加载图片 → xlsx 字节。模板列序对齐企微智能表格样例。 */

import type { ExportImage, ExportImageExtension } from "./project-export.types.js";

export type { ExportImage, ExportImageExtension } from "./project-export.types.js";



export type ExportPhotoLoader = (refs: readonly ExportPhotoRef[]) => Promise<ReadonlyMap<string, ExportImage>>;

export interface WorkbookImagePlacement {
  sheetId: number;
  row: number;
  column: number;
  fileId: string;
  xOffsetPx: number;
  yOffsetPx: number;
  widthPx: number;
  heightPx: number;
  /** 设置后改用 twoCellAnchor，按覆盖的列数和行数贴合表格边界。 */
  fitTo?: { columns: number; rows: number };
}

export interface ExportFileLink {
  id: string;
  name: string;
  /** ZIP 导出时为工作簿相对的附件路径；普通在线导出不设置。 */
  href?: string;
}

export interface ExportPhotoRef {
  fileId: string;
  name: string;
  /** ZIP 导出时为工作簿相对的附件路径；普通在线导出不设置。 */
  href?: string;
}

export interface ProjectExportTaskRow {
  description: string;
  managers: string;
  owners: string;
  status: string;
  progress: number | null;
  onTime: string;
  deliverables: string;
  note: string;
  plannedStart: string;
  plannedEnd: string;
  headcount: number | null;
  estimatedDays: number | null;
  actualEnd: string;
  stage: string;
  priority: string;
  latestChangeDate: string;
  files: ExportFileLink[];
  changeDates: string[];
}

export interface ProjectExportDailyReportRow {
  date: string;
  author: string;
  doneWork: string;
  plan: string;
  onsitePhotos: ExportPhotoRef[];
  headcount: number | null;
}

export interface ProjectExportIssueRow {
  date: string;
  reporter: string;
  description: string;
  category: string;
  solution: string;
  photos: ExportPhotoRef[];
  state: string;
}

export interface ProjectExportChangeRow {
  changedAt: string;
  stage: string;
  files: ExportFileLink[];
  description: string;
  beforeText: string;
  afterText: string;
  reason: string;
  applicant: string;
  writer: string;
  afterVersion: string;
  afterFiles: ExportFileLink[];
  progress: string;
  related: string;
  beforePhotos: ExportPhotoRef[];
  afterPhotos: ExportPhotoRef[];
}

export interface ProjectExportStakeholderRow {
  name: string;
  phone: string;
  wechat: string;
  email: string;
  title: string;
  company: string;
  writer: string;
  role: string;
}

export interface ProjectExportAttachmentRow {
  sourcePage: string;
  sourceRow: number;
  sourceRecord: string;
  attachmentType: string;
  fileName: string;
  relativePath: string;
  sizeBytes: number | null;
  status: string;
}

export interface ProjectExportPayload {
  project: { id: string; code: string; name: string };
  origin: string | null;
  tasks: ProjectExportTaskRow[];
  reports: ProjectExportDailyReportRow[];
  issues: ProjectExportIssueRow[];
  changes: ProjectExportChangeRow[];
  stakeholders: ProjectExportStakeholderRow[];
  images: Map<string, ExportImage>;
  /** ZIP 模式附加的「附件清单」Sheet；不传则该 Sheet 不存在。 */
  attachmentSheet?: ProjectExportAttachmentRow[];
  /** ZIP 模式每个附图单元格最多嵌几张缩略图；普通导出不传。 */
  imageLimitPerCell?: number;
}

export interface ProjectExportWorkbookResult {
  buffer: Buffer;
  sheetNames: string[];
}

export interface ProjectExportWorkbookFileResult {
  filePath: string;
  sheetNames: string[];
  images: ReadonlyMap<string, ExportImage>;
  imagePlacements: readonly WorkbookImagePlacement[];
}

const TASK_HEADERS = [
  "任务描述",
  "项目经理",
  "任务负责人",
  "任务状态",
  "项目进度",
  "是否按时交付",
  "输出成果文件",
  "项目进展描述",
  "开始日期",
  "预计完成日期",
  "预计所需施工人数",
  "预计所需天数",
  "实际完成日期",
  "阶段性里程",
  "紧急重要度",
  "最近变更日期",
  "文件",
  "变更关联",
];

const REPORT_HEADERS = [
  "日期",
  "填写者",
  "当日完成工作",
  "明日计划",
  "现场工作附图",
  "施工人数",
];

const ISSUE_HEADERS = [
  "提出日期",
  "提出人",
  "问题描述",
  "问题归类",
  "解决方案或建议",
  "问题附图",
  "问题是否处理",
];

const CHANGE_HEADERS = [
  "变更时间",
  "变更阶段",
  "变更文件",
  "变更内容描述",
  "变更前",
  "变更后",
  "变更原因",
  "变更申请人",
  "填写者",
  "变更后文件版本",
  "变更后文件",
  "进度",
  "关联",
];

const STAKEHOLDER_HEADERS = [
  "干系人姓名",
  "电话 / WhatsApp",
  "微信",
  "邮箱 Email",
  "职务 / 责任板块",
  "所属公司",
  "填写者",
  "干系人角色",
];

const TASK_WIDTHS: Record<number, number> = { 1: 43, 2: 16.4, 3: 18.9, 4: 13.8, 5: 10, 6: 12, 7: 14, 8: 23.2, 9: 19.8, 10: 15.5, 11: 11.2, 12: 13.8, 13: 14, 14: 17.2, 15: 13.8, 16: 16.4, 17: 21.5, 18: 16 };
const REPORT_WIDTHS: Record<number, number> = { 1: 14, 2: 20, 3: 42, 4: 36, 5: 58, 6: 12 };
const ISSUE_WIDTHS: Record<number, number> = { 1: 14, 2: 18, 3: 42, 4: 22, 5: 38, 6: 42, 7: 14 };
const CHANGE_WIDTHS: Record<number, number> = { 1: 21.5, 2: 13.8, 3: 18.9, 4: 23.2, 5: 30, 6: 30, 7: 23.2, 8: 16.4, 9: 16.4, 10: 23.2, 11: 21.5, 12: 13.8, 13: 21.5 };
const STAKEHOLDER_WIDTHS: Record<number, number> = { 1: 22, 2: 22, 3: 16, 4: 30, 5: 28, 6: 24, 7: 18, 8: 22 };

const ATTACHMENT_HEADERS = ["来源页面", "来源行", "来源记录", "附件类型", "文件名", "相对路径", "文件大小", "状态"];
const ATTACHMENT_WIDTHS: Record<number, number> = { 1: 16, 2: 9, 3: 30, 4: 18, 5: 42, 6: 62, 7: 14, 8: 10 };

const IMAGE_WIDTH_PX = 88;
const IMAGE_HEIGHT_PX = 64;
const IMAGE_GAP_PX = 4;
const IMAGE_TOP_GAP_PX = 8;
const IMAGE_BOTTOM_GAP_PX = 10;
const PX_PER_POINT = EXPORT_PX_PER_POINT;
const EMU_PER_PIXEL = 9525;
const IMAGE_PADDING_PX = 4;

const SHANGHAI_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function partsOf(value: string): { year: string; month: string; day: string; hour: string; minute: string } | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly !== null) {
    return { year: dateOnly[1] ?? "", month: dateOnly[2] ?? "", day: dateOnly[3] ?? "", hour: "00", minute: "00" };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const values: Record<string, string> = {};
  for (const part of SHANGHAI_PARTS.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return {
    year: values.year ?? "",
    month: values.month ?? "",
    day: values.day ?? "",
    hour: values.hour === "24" ? "00" : (values.hour ?? ""),
    minute: values.minute ?? "",
  };
}

function monthDay(month: string, day: string): string {
  return String(Number(month)) + "月" + String(Number(day)) + "日";
}

export function formatTaskDate(value: string | null): string {
  if (value === null || value === "") return "";
  const parts = partsOf(value);
  return parts === null ? value : monthDay(parts.month, parts.day);
}

export function formatCalendarDate(value: string | null): string {
  if (value === null || value === "") return "";
  const parts = partsOf(value);
  if (parts === null) return value;
  return parts.year + "/" + String(Number(parts.month)) + "/" + String(Number(parts.day));
}

export function formatReportDay(value: string): string {
  const parts = partsOf(value);
  return parts === null ? value : parts.year + "年" + String(Number(parts.month)) + "月" + String(Number(parts.day)) + "日";
}

export function formatReportDate(value: string, state: string): string {
  const text = formatReportDay(value);
  return state === "draft" ? text + "（草稿）" : text;
}

export function formatReportTime(value: string): string {
  const parts = partsOf(value);
  if (parts === null) return value;
  return parts.year + "年" + String(Number(parts.month)) + "月" + String(Number(parts.day)) + "日 " + parts.hour + ":" + parts.minute;
}

export function numbered(values: readonly string[]): string {
  const clean = values.map((value) => value.trim()).filter((value) => value !== "");
  return clean.map((value, index) => String(index + 1) + " " + value).join("\n");
}

export function sanitizeFileName(value: string): string {
  const result = value
    .replace(/[\\/:*?\u0022<>|\[\]\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return result === "" ? "项目" : result.slice(0, 120).replace(/[. ]+$/g, "");
}

export function projectExportFileName(project: { code: string; name: string }): string {
  return "[" + sanitizeFileName(project.code) + "] " + sanitizeFileName(project.name) + ".xlsx";
}

/** ZIP 根目录 / 包内 xlsx 共用文件名：保留方括号编号，仅清理跨平台非法字符。 */
export function projectExportArchiveStem(project: { code: string; name: string }): string {
  const clean = (value: string, fallback: string): string => {
    const result = value
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 120)
      .replace(/[. ]+$/g, "");
    return result === "" ? fallback : result;
  };
  const code = clean(project.code, "项目").replace(/^\[+|\]+$/g, "");
  return "[" + code + "] " + clean(project.name, "项目");
}

export function projectExportArchiveWorkbookName(project: { code: string; name: string }): string {
  return projectExportArchiveStem(project) + ".xlsx";
}

export function projectExportArchiveFileName(project: { code: string; name: string }): string {
  return projectExportArchiveStem(project) + ".zip";
}

/** 企微样例的「变更后文件版本」= 文件名去掉最后一级扩展名（版本名沿用文件名），不是 vN。 */
export function versionNameOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
}

export function normalizeHttpOrigin(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function sheetNameOf(value: string): string {
  let result = value;
  for (const char of ["[", "]", ":", "*", "?", "/", "\\"]) result = result.split(char).join("_");
  result = result.replace(/[\u0000-\u001f]/g, "").replace(/^\u0027+|\u0027+$/g, "").trim();
  if (result === "") result = "项目任务";
  return result.slice(0, 31);
}

function fileLink(origin: string | null, projectId: string): string | null {
  if (origin === null) return null;
  return origin + "/#/project/" + encodeURIComponent(projectId) + "?view=files";
}

function firstArchiveHref(refs: readonly { href?: string }[]): string | null {
  for (const ref of refs) if (ref.href !== undefined && ref.href !== "") return ref.href;
  return null;
}

function filesValue(files: readonly ExportFileLink[], origin: string | null, projectId: string): ExcelJS.CellValue {
  if (files.length === 0) return null;
  const text = files.map((file) => file.name).join("\n");
  const link = firstArchiveHref(files) ?? fileLink(origin, projectId);
  if (link === null) return text;
  return { text, hyperlink: link, tooltip: files[0]?.name ?? text };
}

function linkedText(text: string, tooltip: string, link: string | null): ExcelJS.CellValue {
  if (text === "") return null;
  if (link === null) return text;
  return { text, hyperlink: link, tooltip };
}

/** ZIP 模式附图单元格：保留一张可点缩略图摘要，完整文件名在「附件清单」Sheet。 */
function photoArchiveValue(refs: readonly ExportPhotoRef[], label: string, origin: string | null, projectId: string): ExcelJS.CellValue {
  const unique = uniquePhotos(refs);
  if (unique.length === 0) return null;
  const missing = unique.filter((ref) => ref.href === undefined).length;
  const text = String(unique.length) + " 张" + label + (missing > 0 ? "（含" + String(missing) + " 份缺失）" : "");
  return linkedText(text, unique.map((ref) => ref.name).join("\n"), firstArchiveHref(unique) ?? fileLink(origin, projectId));
}

function appendArchivePhotoLine(base: string, refs: readonly ExportPhotoRef[], label: string, origin: string | null, projectId: string): ExcelJS.CellValue {
  const unique = uniquePhotos(refs);
  if (unique.length === 0) return base === "" ? null : base;
  const missing = unique.filter((ref) => ref.href === undefined).length;
  const summary = String(unique.length) + " 张" + label + (missing > 0 ? "（含" + String(missing) + " 份缺失）" : "");
  const text = base === "" ? summary : base + "\n" + summary;
  return linkedText(text, unique.map((ref) => ref.name).join("\n"), firstArchiveHref(unique) ?? fileLink(origin, projectId));
}

function applyLinkFont(cell: ExcelJS.Cell): void {
  if (cell.value !== null && typeof cell.value === "object" && "hyperlink" in cell.value) {
    cell.font = { name: EXPORT_FONT_NAME, size: 10, color: { argb: "FF0563C1" }, underline: true };
  }
}

function fitColumnWidths(
  sheet: ExcelJS.Worksheet,
  baseWidths: Record<number, number>,
  values: readonly string[],
): void {
  for (let index = 0; index < values.length; index += 1) {
    const baseWidth = baseWidths[index + 1] ?? 8.43;
    const nextWidth = fittedColumnWidth(values[index] ?? "", baseWidth);
    if (nextWidth > (sheet.getColumn(index + 1).width ?? baseWidth)) {
      sheet.getColumn(index + 1).width = nextWidth;
    }
  }
}

function widthsOf(sheet: ExcelJS.Worksheet, count: number): number[] {
  return Array.from({ length: count }, (_value, index) => sheet.getColumn(index + 1).width ?? 8.43);
}

function styleHeader(
  sheet: ExcelJS.Worksheet,
  headers: readonly string[],
  baseWidths: Record<number, number>,
): ExcelJS.Row {
  fitColumnWidths(sheet, baseWidths, headers);
  const row = sheet.addRow([...headers]);
  row.height = headerRowHeightPx(headers, widthsOf(sheet, headers.length)) / EXPORT_PX_PER_POINT;
  for (let index = 1; index <= headers.length; index += 1) {
    const cell = row.getCell(index);
    cell.font = { name: EXPORT_FONT_NAME, size: 10, bold: true, color: { argb: "FF111827" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6F8" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFE4E7EC" } },
      bottom: { style: "thin", color: { argb: "FFC9D0D8" } },
      left: { style: "thin", color: { argb: "FFD9DEE5" } },
      right: { style: "thin", color: { argb: "FFD9DEE5" } },
    };
  }
  return row;
}

function sheetWidthsPx(widths: Record<number, number>, count: number): number {
  return exportHeaderWidthPx(
    Array.from({ length: count }, (_value, index) => widths[index + 1] ?? 8.43),
  );
}

async function addExportHeader(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  project: { code: string; name: string },
  sheetLabel: string,
  widthPx: number,
  columnCount: number,
): Promise<void> {
  const width = Math.max(240, widthPx);
  sheet.mergeCells(1, 1, 1, columnCount);
  const brandCell = sheet.getCell(1, 1);
  brandCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
  sheet.getRow(1).height = EXPORT_HEADER_ROW_HEIGHT;
  sheet.views = [{ state: "frozen", ySplit: 2, topLeftCell: "A3" }];
  try {
    const header = await renderProjectExportHeader(project, sheetLabel, width);
    const imageId = workbook.addImage({
      buffer: Uint8Array.from(header.bytes).buffer as ArrayBuffer,
      extension: header.extension,
    });
    sheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      br: { nativeCol: columnCount, nativeColOff: 0, nativeRow: 1, nativeRowOff: 0 },
      editAs: "twoCell",
    } as unknown as ExcelJS.ImageRange);
  } catch {
    brandCell.value = "[" + project.code + "]  " + project.name + "   ·   " + sheetLabel;
    brandCell.font = { name: EXPORT_FONT_NAME, size: 16, bold: true, color: { argb: "FF111827" } };
    brandCell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    brandCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  }
}

function setWidths(sheet: ExcelJS.Worksheet, widths: Record<number, number>, count: number): void {
  for (let index = 1; index <= count; index += 1) {
    sheet.getColumn(index).width = widths[index] ?? 8.43;
  }
}

function styleBodyRow(sheet: ExcelJS.Worksheet, rowNumber: number, count: number): void {
  for (let index = 1; index <= count; index += 1) {
    const cell = sheet.getCell(rowNumber, index);
    cell.font = { name: EXPORT_FONT_NAME, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    applyLinkFont(cell);
  }
}

/** 图片格保留图片区，文字从顶部开始，图片在其下方居中排布。 */
function alignPhotoCell(sheet: ExcelJS.Worksheet, rowNumber: number, column: number, hasImages: boolean): void {
  if (!hasImages) return;
  const cell = sheet.getCell(rowNumber, column);
  cell.alignment = { vertical: "top", horizontal: "center", wrapText: true };
  applyLinkFont(cell);
}

function estimatedTextHeight(sheet: ExcelJS.Worksheet, values: readonly string[], columns: readonly number[]): number {
  const widths = columns.map((column) => sheet.getColumn(column).width ?? 8.43);
  return bodyRowHeightPx(values, widths);
}

function plainText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "text" in value) return String(value.text ?? "");
  return "";
}

function appendMissing(base: string, missing: readonly string[]): string {
  if (missing.length === 0) return base;
  const note = missing.map((name) => "（附图缺失）" + name).join("\n");
  return base === "" ? note : base + "\n" + note;
}

function uniquePhotos(refs: readonly ExportPhotoRef[]): ExportPhotoRef[] {
  const seen = new Set<string>();
  const result: ExportPhotoRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.fileId)) continue;
    seen.add(ref.fileId);
    result.push(ref);
  }
  return result;
}

function imageCapacity(widthChars: number, gapPx = 0): number {
  return Math.max(1, Math.floor((widthChars * 7 + 5 + gapPx) / (IMAGE_WIDTH_PX + IMAGE_GAP_PX)));
}

function imageBlockHeightPx(lines: number): number {
  if (lines <= 0) return 0;
  return IMAGE_TOP_GAP_PX + lines * IMAGE_HEIGHT_PX + (lines - 1) * IMAGE_GAP_PX + IMAGE_BOTTOM_GAP_PX;
}

function missingNames(refs: readonly ExportPhotoRef[], images: ReadonlyMap<string, ExportImage>): string[] {
  return refs.filter((ref) => !images.has(ref.fileId)).map((ref) => ref.name);
}

function availableRefs(refs: readonly ExportPhotoRef[], images: ReadonlyMap<string, ExportImage>): ExportPhotoRef[] {
  return refs.filter((ref) => images.has(ref.fileId));
}

function placeImages(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  refs: readonly ExportPhotoRef[],
  images: Map<string, ExportImage>,
  column: number,
  rowNumber: number,
  capacity: number,
  baseHeightPx: number,
  maxCount = Number.MAX_SAFE_INTEGER,
): number {
  const available = availableRefs(refs, images).slice(0, Math.max(0, maxCount));
  const columnWidthChars = sheet.getColumn(column).width ?? 8.43;
  const columnWidthPx = Math.max(IMAGE_WIDTH_PX, columnWidthChars * 7 + 5);
  for (let index = 0; index < available.length; index += 1) {
    const ref = available[index];
    if (ref === undefined) continue;
    const image = images.get(ref.fileId);
    if (image === undefined) continue;
    const slot = index % capacity;
    const line = Math.floor(index / capacity);
    const itemsOnLine = Math.min(capacity, available.length - line * capacity);
    const lineWidthPx = itemsOnLine * IMAGE_WIDTH_PX + Math.max(0, itemsOnLine - 1) * IMAGE_GAP_PX;
    const xOffsetPx = Math.max(IMAGE_PADDING_PX, (columnWidthPx - lineWidthPx) / 2 + slot * (IMAGE_WIDTH_PX + IMAGE_GAP_PX));
    const yOffsetPx = baseHeightPx + IMAGE_TOP_GAP_PX + line * (IMAGE_HEIGHT_PX + IMAGE_GAP_PX);
    const imageBuffer = Uint8Array.from(image.bytes).buffer as ArrayBuffer;
    const imageId = workbook.addImage({ buffer: imageBuffer, extension: image.extension });
    const position = {
      tl: {
        col: column - 1,
        row: rowNumber - 1,
        nativeCol: column - 1,
        nativeColOff: Math.round(xOffsetPx * EMU_PER_PIXEL),
        nativeRow: rowNumber - 1,
        nativeRowOff: Math.round(yOffsetPx * EMU_PER_PIXEL),
      },
      ext: { width: IMAGE_WIDTH_PX, height: IMAGE_HEIGHT_PX },
      editAs: "oneCell",
    };
    sheet.addImage(imageId, position as unknown as ExcelJS.ImageRange);
  }
  return available.length;
}

async function addTaskSheet(workbook: ExcelJS.Workbook, payload: ProjectExportPayload, name: string): Promise<ExcelJS.Worksheet> {
  const sheet = workbook.addWorksheet(name);
  setWidths(sheet, TASK_WIDTHS, TASK_HEADERS.length);
  await addExportHeader(workbook, sheet, payload.project, "项目任务", sheetWidthsPx(TASK_WIDTHS, TASK_HEADERS.length), TASK_HEADERS.length);
  styleHeader(sheet, TASK_HEADERS, TASK_WIDTHS);
  for (const task of payload.tasks) {
    const row = sheet.addRow([
      task.description,
      task.managers,
      task.owners,
      task.status,
      task.progress,
      task.onTime,
      task.deliverables,
      task.note,
      task.plannedStart,
      task.plannedEnd,
      task.headcount,
      task.estimatedDays,
      task.actualEnd,
      task.stage,
      task.priority,
      task.latestChangeDate,
      null,
      task.changeDates.join("\n"),
    ]);
    row.getCell(17).value = filesValue(task.files, payload.origin, payload.project.id);
    styleBodyRow(sheet, row.number, TASK_HEADERS.length);
    const texts: string[] = [];
    for (let col = 1; col <= TASK_HEADERS.length; col += 1) texts.push(plainText(row.getCell(col)));
    fitColumnWidths(sheet, TASK_WIDTHS, texts);
    row.height = estimatedTextHeight(sheet, texts, Array.from({ length: TASK_HEADERS.length }, (_value, index) => index + 1)) / PX_PER_POINT;
  }
  return sheet;
}

async function addReportSheet(workbook: ExcelJS.Workbook, payload: ProjectExportPayload, name: string): Promise<ExcelJS.Worksheet> {
  const sheet = workbook.addWorksheet(name);
  setWidths(sheet, REPORT_WIDTHS, REPORT_HEADERS.length);
  await addExportHeader(workbook, sheet, payload.project, "日报记录", sheetWidthsPx(REPORT_WIDTHS, REPORT_HEADERS.length), REPORT_HEADERS.length);
  styleHeader(sheet, REPORT_HEADERS, REPORT_WIDTHS);
  const archiveMode = payload.attachmentSheet !== undefined;
  const imageLimit = payload.imageLimitPerCell ?? Number.MAX_SAFE_INTEGER;
  for (const report of payload.reports) {
    const onsite = uniquePhotos(report.onsitePhotos);
    const row = sheet.addRow([
      report.date,
      report.author,
      report.doneWork,
      report.plan,
      archiveMode ? photoArchiveValue(onsite, "现场附图", payload.origin, payload.project.id) : (appendMissing("", missingNames(onsite, payload.images)) || null),
      report.headcount,
    ]);
    styleBodyRow(sheet, row.number, REPORT_HEADERS.length);
    const texts = Array.from({ length: REPORT_HEADERS.length }, (_value, index) => plainText(row.getCell(index + 1)));
    fitColumnWidths(sheet, REPORT_WIDTHS, texts);
    const basePx = estimatedTextHeight(sheet, texts, Array.from({ length: REPORT_HEADERS.length }, (_value, index) => index + 1));
    const onsiteAvailable = Math.min(availableRefs(onsite, payload.images).length, imageLimit);
    const capacity = imageCapacity(sheet.getColumn(5).width ?? REPORT_WIDTHS[5] ?? 58);
    const imageLines = onsiteAvailable === 0 ? 0 : Math.ceil(onsiteAvailable / capacity);
    row.height = (basePx + imageBlockHeightPx(imageLines)) / PX_PER_POINT;
    alignPhotoCell(sheet, row.number, 5, onsiteAvailable > 0);
    placeImages(workbook, sheet, onsite, payload.images, 5, row.number, capacity, basePx, imageLimit);
  }
  return sheet;
}

async function addIssueSheet(workbook: ExcelJS.Workbook, payload: ProjectExportPayload, name: string): Promise<ExcelJS.Worksheet> {
  const sheet = workbook.addWorksheet(name);
  setWidths(sheet, ISSUE_WIDTHS, ISSUE_HEADERS.length);
  await addExportHeader(workbook, sheet, payload.project, "问题汇总", sheetWidthsPx(ISSUE_WIDTHS, ISSUE_HEADERS.length), ISSUE_HEADERS.length);
  styleHeader(sheet, ISSUE_HEADERS, ISSUE_WIDTHS);
  const archiveMode = payload.attachmentSheet !== undefined;
  const imageLimit = payload.imageLimitPerCell ?? Number.MAX_SAFE_INTEGER;
  for (const issue of payload.issues) {
    const photos = uniquePhotos(issue.photos);
    const row = sheet.addRow([
      issue.date,
      issue.reporter,
      issue.description,
      issue.category,
      issue.solution,
      archiveMode ? photoArchiveValue(photos, "问题附图", payload.origin, payload.project.id) : (appendMissing("", missingNames(photos, payload.images)) || null),
      issue.state,
    ]);
    styleBodyRow(sheet, row.number, ISSUE_HEADERS.length);
    const texts = Array.from({ length: ISSUE_HEADERS.length }, (_value, index) => plainText(row.getCell(index + 1)));
    fitColumnWidths(sheet, ISSUE_WIDTHS, texts);
    const basePx = estimatedTextHeight(sheet, texts, Array.from({ length: ISSUE_HEADERS.length }, (_value, index) => index + 1));
    const available = Math.min(availableRefs(photos, payload.images).length, imageLimit);
    const capacity = imageCapacity(sheet.getColumn(6).width ?? ISSUE_WIDTHS[6] ?? 42);
    const imageLines = available === 0 ? 0 : Math.ceil(available / capacity);
    row.height = (basePx + imageBlockHeightPx(imageLines)) / PX_PER_POINT;
    alignPhotoCell(sheet, row.number, 6, available > 0);
    placeImages(workbook, sheet, photos, payload.images, 6, row.number, capacity, basePx, imageLimit);
  }
  return sheet;
}

async function addChangeSheet(workbook: ExcelJS.Workbook, payload: ProjectExportPayload, name: string): Promise<ExcelJS.Worksheet> {
  const sheet = workbook.addWorksheet(name);
  setWidths(sheet, CHANGE_WIDTHS, CHANGE_HEADERS.length);
  await addExportHeader(workbook, sheet, payload.project, "变更管理", sheetWidthsPx(CHANGE_WIDTHS, CHANGE_HEADERS.length), CHANGE_HEADERS.length);
  styleHeader(sheet, CHANGE_HEADERS, CHANGE_WIDTHS);
  const archiveMode = payload.attachmentSheet !== undefined;
  const imageLimit = payload.imageLimitPerCell ?? Number.MAX_SAFE_INTEGER;
  for (const change of payload.changes) {
    const before = uniquePhotos(change.beforePhotos);
    const after = uniquePhotos(change.afterPhotos);
    const row = sheet.addRow([
      change.changedAt,
      change.stage,
      null,
      change.description,
      archiveMode
        ? appendArchivePhotoLine(change.beforeText, before, "变更前附图", payload.origin, payload.project.id)
        : (appendMissing(change.beforeText, missingNames(before, payload.images)) || null),
      archiveMode
        ? appendArchivePhotoLine(change.afterText, after, "变更后附图", payload.origin, payload.project.id)
        : (appendMissing(change.afterText, missingNames(after, payload.images)) || null),
      change.reason,
      change.applicant,
      change.writer,
      change.afterVersion,
      null,
      change.progress,
      change.related,
    ]);
    row.getCell(3).value = filesValue(change.files, payload.origin, payload.project.id);
    row.getCell(11).value = filesValue(change.afterFiles, payload.origin, payload.project.id);
    styleBodyRow(sheet, row.number, CHANGE_HEADERS.length);
    const texts = Array.from({ length: CHANGE_HEADERS.length }, (_value, index) => plainText(row.getCell(index + 1)));
    fitColumnWidths(sheet, CHANGE_WIDTHS, texts);
    const basePx = estimatedTextHeight(sheet, texts, Array.from({ length: CHANGE_HEADERS.length }, (_value, index) => index + 1));
    const beforeAvailable = Math.min(availableRefs(before, payload.images).length, imageLimit);
    const afterAvailable = Math.min(availableRefs(after, payload.images).length, imageLimit);
    const beforeCapacity = imageCapacity(sheet.getColumn(5).width ?? CHANGE_WIDTHS[5] ?? 30);
    const afterCapacity = imageCapacity(sheet.getColumn(6).width ?? CHANGE_WIDTHS[6] ?? 30);
    const imageLines = Math.max(
      beforeAvailable === 0 ? 0 : Math.ceil(beforeAvailable / beforeCapacity),
      afterAvailable === 0 ? 0 : Math.ceil(afterAvailable / afterCapacity),
    );
    row.height = (basePx + imageBlockHeightPx(imageLines)) / PX_PER_POINT;
    alignPhotoCell(sheet, row.number, 5, beforeAvailable > 0);
    alignPhotoCell(sheet, row.number, 6, afterAvailable > 0);
    placeImages(workbook, sheet, before, payload.images, 5, row.number, beforeCapacity, basePx, imageLimit);
    placeImages(workbook, sheet, after, payload.images, 6, row.number, afterCapacity, basePx, imageLimit);
  }
  return sheet;
}

async function addStakeholderSheet(workbook: ExcelJS.Workbook, payload: ProjectExportPayload, name: string): Promise<ExcelJS.Worksheet> {
  const sheet = workbook.addWorksheet(name);
  setWidths(sheet, STAKEHOLDER_WIDTHS, STAKEHOLDER_HEADERS.length);
  await addExportHeader(workbook, sheet, payload.project, "干系人", sheetWidthsPx(STAKEHOLDER_WIDTHS, STAKEHOLDER_HEADERS.length), STAKEHOLDER_HEADERS.length);
  styleHeader(sheet, STAKEHOLDER_HEADERS, STAKEHOLDER_WIDTHS);
  for (const item of payload.stakeholders) {
    const row = sheet.addRow([item.name, item.phone, item.wechat, item.email, item.title, item.company, item.writer, item.role]);
    styleBodyRow(sheet, row.number, STAKEHOLDER_HEADERS.length);
    const texts: string[] = [];
    for (let col = 1; col <= STAKEHOLDER_HEADERS.length; col += 1) texts.push(plainText(row.getCell(col)));
    fitColumnWidths(sheet, STAKEHOLDER_WIDTHS, texts);
    row.height = estimatedTextHeight(sheet, texts, Array.from({ length: STAKEHOLDER_HEADERS.length }, (_value, index) => index + 1)) / PX_PER_POINT;
  }
  return sheet;
}

async function addAttachmentSheet(workbook: ExcelJS.Workbook, payload: ProjectExportPayload, name: string): Promise<ExcelJS.Worksheet> {
  const sheet = workbook.addWorksheet(name);
  setWidths(sheet, ATTACHMENT_WIDTHS, ATTACHMENT_HEADERS.length);
  await addExportHeader(workbook, sheet, payload.project, "附件清单", sheetWidthsPx(ATTACHMENT_WIDTHS, ATTACHMENT_HEADERS.length), ATTACHMENT_HEADERS.length);
  styleHeader(sheet, ATTACHMENT_HEADERS, ATTACHMENT_WIDTHS);
  for (const item of payload.attachmentSheet ?? []) {
    const row = sheet.addRow([
      item.sourcePage,
      item.sourceRow,
      item.sourceRecord,
      item.attachmentType,
      item.fileName,
      item.relativePath,
      item.sizeBytes,
      item.status,
    ]);
    row.getCell(7).numFmt = "#,##0";
    styleBodyRow(sheet, row.number, ATTACHMENT_HEADERS.length);
    const texts: string[] = [];
    for (let col = 1; col <= ATTACHMENT_HEADERS.length; col += 1) texts.push(plainText(row.getCell(col)));
    fitColumnWidths(sheet, ATTACHMENT_WIDTHS, texts);
    row.height = estimatedTextHeight(sheet, texts, Array.from({ length: ATTACHMENT_HEADERS.length }, (_value, index) => index + 1)) / PX_PER_POINT;
  }
  return sheet;
}

export async function buildProjectExportWorkbook(payload: ProjectExportPayload): Promise<ProjectExportWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LibiaoLink";
  workbook.lastModifiedBy = "LibiaoLink";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.title = payload.project.code + " " + payload.project.name;
  const sheetNames = projectExportSheetNames(payload.project);
  const [taskSheetName, reportSheetName, issueSheetName, changeSheetName, stakeholderSheetName] = sheetNames;
  if (
    taskSheetName === undefined ||
    reportSheetName === undefined ||
    issueSheetName === undefined ||
    changeSheetName === undefined ||
    stakeholderSheetName === undefined
  ) {
    throw new Error("项目导出 Sheet 配置不完整");
  }
  await addTaskSheet(workbook, payload, taskSheetName);
  await addReportSheet(workbook, payload, reportSheetName);
  await addIssueSheet(workbook, payload, issueSheetName);
  await addChangeSheet(workbook, payload, changeSheetName);
  await addStakeholderSheet(workbook, payload, stakeholderSheetName);
  if (payload.attachmentSheet !== undefined) {
    const attachmentSheetName = projectExportAttachmentSheetName(payload.project, sheetNames);
    sheetNames.push(attachmentSheetName);
    await addAttachmentSheet(workbook, payload, attachmentSheetName);
  }
  const bytes = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(bytes as unknown as Uint8Array);
  return { buffer, sheetNames };
}

export function projectExportSheetNames(project: { name: string }): string[] {
  const reportSheetName = "日报记录";
  const issueSheetName = "问题汇总";
  const changeSheetName = "变更管理";
  const stakeholderSheetName = "干系人";
  const fixed = [reportSheetName, issueSheetName, changeSheetName, stakeholderSheetName, "附件清单"];
  let taskSheetName = sheetNameOf(project.name);
  if (fixed.includes(taskSheetName)) taskSheetName = sheetNameOf(taskSheetName + " 项目");
  return [taskSheetName, reportSheetName, issueSheetName, changeSheetName, stakeholderSheetName];
}

function projectExportAttachmentSheetName(project: { name: string }, existing: readonly string[]): string {
  if (!existing.includes("附件清单")) return "附件清单";
  let base = sheetNameOf(project.name + " 附件清单");
  if (!existing.includes(base)) return base;
  base = sheetNameOf(base + " 附件");
  return base;
}

/**
 * 大项目流式工作簿写入器：按 Sheet / 行提交到临时文件，内存只保留当前页与当前行。
 * ExcelJS 4.4 的流式写入不支持图片；本类先记录图片锚点，落盘后由服务层注入 DrawingML 缩略图，
 * 由服务层仅在 stream 模式使用。
 */
export class ProjectExportWorkbookWriter {
  private readonly workbook: ExcelJS.stream.xlsx.WorkbookWriter;
  private readonly images = new Map<string, ExportImage>();
  private readonly imagePlacements: WorkbookImagePlacement[] = [];
  readonly sheetNames: string[];
  private committed = false;

  constructor(
    readonly filePath: string,
    private readonly project: { id: string; code: string; name: string },
    private readonly origin: string | null,
    private readonly photoLoader: ExportPhotoLoader,
    now = new Date(),
  ) {
    this.sheetNames = projectExportSheetNames(project);
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: false,
    });
    this.workbook.creator = "LibiaoLink";
    this.workbook.lastModifiedBy = "LibiaoLink";
    this.workbook.created = now;
    this.workbook.modified = now;
    this.workbook.title = project.code + " " + project.name;
  }

  async writeTasks(rows: AsyncIterable<ProjectExportTaskRow>): Promise<void> {
    const sheet = await this.createSheet(this.sheetNames[0] ?? "项目任务", TASK_WIDTHS, TASK_HEADERS, "项目任务");
    for await (const task of rows) {
      const row = sheet.addRow([
        task.description,
        task.managers,
        task.owners,
        task.status,
        task.progress,
        task.onTime,
        task.deliverables,
        task.note,
        task.plannedStart,
        task.plannedEnd,
        task.headcount,
        task.estimatedDays,
        task.actualEnd,
        task.stage,
        task.priority,
        task.latestChangeDate,
        null,
        task.changeDates.join("\n"),
      ]);
      row.getCell(17).value = filesValue(task.files, this.origin, this.project.id);
      styleBodyRow(sheet, row.number, TASK_HEADERS.length);
      const texts: string[] = [];
      for (let col = 1; col <= TASK_HEADERS.length; col += 1) texts.push(plainText(row.getCell(col)));
      fitColumnWidths(sheet, TASK_WIDTHS, texts);
      row.height = estimatedTextHeight(sheet, texts, Array.from({ length: TASK_HEADERS.length }, (_value, index) => index + 1)) / PX_PER_POINT;
      row.commit();
    }
    sheet.commit();
  }

  async writeReports(rows: AsyncIterable<ProjectExportDailyReportRow>): Promise<void> {
    const sheet = await this.createSheet(this.sheetNames[1] ?? "日报记录", REPORT_WIDTHS, REPORT_HEADERS, "日报记录");
    for await (const report of rows) {
      const onsite = uniquePhotos(report.onsitePhotos);
      const onsiteImages = await this.photoLoader(onsite);
      const row = sheet.addRow([
        report.date,
        report.author,
        report.doneWork,
        report.plan,
        appendMissing("", missingNames(onsite, onsiteImages)) || null,
        report.headcount,
      ]);
      styleBodyRow(sheet, row.number, REPORT_HEADERS.length);
      const texts = Array.from({ length: REPORT_HEADERS.length }, (_value, index) => plainText(row.getCell(index + 1)));
      fitColumnWidths(sheet, REPORT_WIDTHS, texts);
      const basePx = estimatedTextHeight(sheet, texts, Array.from({ length: REPORT_HEADERS.length }, (_value, index) => index + 1));
      const capacity = imageCapacity(sheet.getColumn(5).width ?? REPORT_WIDTHS[5] ?? 58);
      const available = availableRefs(onsite, onsiteImages);
      const imageLines = available.length === 0 ? 0 : Math.ceil(available.length / capacity);
      row.height = (basePx + imageBlockHeightPx(imageLines)) / PX_PER_POINT;
      alignPhotoCell(sheet, row.number, 5, available.length > 0);
      this.placeThumbnails(sheet, onsite, onsiteImages, 5, row.number, capacity, basePx);
      row.commit();
    }
    sheet.commit();
  }

  async writeIssues(rows: AsyncIterable<ProjectExportIssueRow>): Promise<void> {
    const sheet = await this.createSheet(this.sheetNames[2] ?? "问题汇总", ISSUE_WIDTHS, ISSUE_HEADERS, "问题汇总");
    for await (const issue of rows) {
      const photos = uniquePhotos(issue.photos);
      const images = await this.photoLoader(photos);
      const row = sheet.addRow([
        issue.date,
        issue.reporter,
        issue.description,
        issue.category,
        issue.solution,
        appendMissing("", missingNames(photos, images)) || null,
        issue.state,
      ]);
      styleBodyRow(sheet, row.number, ISSUE_HEADERS.length);
      const texts = Array.from({ length: ISSUE_HEADERS.length }, (_value, index) => plainText(row.getCell(index + 1)));
      fitColumnWidths(sheet, ISSUE_WIDTHS, texts);
      const basePx = estimatedTextHeight(sheet, texts, Array.from({ length: ISSUE_HEADERS.length }, (_value, index) => index + 1));
      const capacity = imageCapacity(sheet.getColumn(6).width ?? ISSUE_WIDTHS[6] ?? 42);
      const available = availableRefs(photos, images);
      const imageLines = available.length === 0 ? 0 : Math.ceil(available.length / capacity);
      row.height = (basePx + imageBlockHeightPx(imageLines)) / PX_PER_POINT;
      alignPhotoCell(sheet, row.number, 6, available.length > 0);
      this.placeThumbnails(sheet, photos, images, 6, row.number, capacity, basePx);
      row.commit();
    }
    sheet.commit();
  }

  async writeChanges(rows: AsyncIterable<ProjectExportChangeRow>): Promise<void> {
    const sheet = await this.createSheet(this.sheetNames[3] ?? "变更管理", CHANGE_WIDTHS, CHANGE_HEADERS, "变更管理");
    for await (const change of rows) {
      const before = uniquePhotos(change.beforePhotos);
      const after = uniquePhotos(change.afterPhotos);
      const beforeImages = await this.photoLoader(before);
      const afterImages = await this.photoLoader(after);
      const row = sheet.addRow([
        change.changedAt,
        change.stage,
        null,
        change.description,
        appendMissing(change.beforeText, missingNames(before, beforeImages)) || null,
        appendMissing(change.afterText, missingNames(after, afterImages)) || null,
        change.reason,
        change.applicant,
        change.writer,
        change.afterVersion,
        null,
        change.progress,
        change.related,
      ]);
      row.getCell(3).value = filesValue(change.files, this.origin, this.project.id);
      row.getCell(11).value = filesValue(change.afterFiles, this.origin, this.project.id);
      styleBodyRow(sheet, row.number, CHANGE_HEADERS.length);
      const texts = Array.from({ length: CHANGE_HEADERS.length }, (_value, index) => plainText(row.getCell(index + 1)));
      fitColumnWidths(sheet, CHANGE_WIDTHS, texts);
      const basePx = estimatedTextHeight(sheet, texts, Array.from({ length: CHANGE_HEADERS.length }, (_value, index) => index + 1));
      const beforeCapacity = imageCapacity(sheet.getColumn(5).width ?? CHANGE_WIDTHS[5] ?? 30);
      const afterCapacity = imageCapacity(sheet.getColumn(6).width ?? CHANGE_WIDTHS[6] ?? 30);
      const beforeAvailable = availableRefs(before, beforeImages);
      const afterAvailable = availableRefs(after, afterImages);
      const imageLines = Math.max(
        beforeAvailable.length === 0 ? 0 : Math.ceil(beforeAvailable.length / beforeCapacity),
        afterAvailable.length === 0 ? 0 : Math.ceil(afterAvailable.length / afterCapacity),
      );
      row.height = (basePx + imageBlockHeightPx(imageLines)) / PX_PER_POINT;
      alignPhotoCell(sheet, row.number, 5, beforeAvailable.length > 0);
      alignPhotoCell(sheet, row.number, 6, afterAvailable.length > 0);
      this.placeThumbnails(sheet, before, beforeImages, 5, row.number, beforeCapacity, basePx);
      this.placeThumbnails(sheet, after, afterImages, 6, row.number, afterCapacity, basePx);
      row.commit();
    }
    sheet.commit();
  }

  async writeStakeholders(rows: AsyncIterable<ProjectExportStakeholderRow>): Promise<void> {
    const sheet = await this.createSheet(this.sheetNames[4] ?? "干系人", STAKEHOLDER_WIDTHS, STAKEHOLDER_HEADERS, "干系人");
    for await (const item of rows) {
      const row = sheet.addRow([item.name, item.phone, item.wechat, item.email, item.title, item.company, item.writer, item.role]);
      styleBodyRow(sheet, row.number, STAKEHOLDER_HEADERS.length);
      const texts: string[] = [];
      for (let col = 1; col <= STAKEHOLDER_HEADERS.length; col += 1) texts.push(plainText(row.getCell(col)));
      fitColumnWidths(sheet, STAKEHOLDER_WIDTHS, texts);
      row.height = estimatedTextHeight(sheet, texts, Array.from({ length: STAKEHOLDER_HEADERS.length }, (_value, index) => index + 1)) / PX_PER_POINT;
      row.commit();
    }
    sheet.commit();
  }

  async commit(): Promise<ProjectExportWorkbookFileResult> {
    if (this.committed) throw new Error("项目导出工作簿已经提交");
    this.committed = true;
    await this.workbook.commit();
    return {
      filePath: this.filePath,
      sheetNames: this.sheetNames,
      images: this.images,
      imagePlacements: this.imagePlacements,
    };
  }

  /** 异常路径尽力完成 ZIP 收尾，让底层文件句柄关闭；随后由调用方删除临时目录。 */
  async abort(): Promise<void> {
    if (this.committed) return;
    this.committed = true;
    await this.workbook.commit().catch(() => undefined);
  }

  private async createSheet(
    name: string,
    widths: Record<number, number>,
    headers: readonly string[],
    sheetLabel: string,
  ): Promise<ExcelJS.Worksheet> {
    const sheet = this.workbook.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 2, topLeftCell: "A3" }],
    });
    setWidths(sheet, widths, headers.length);
    fitColumnWidths(sheet, widths, headers);
    const widthPx = exportHeaderWidthPx(widthsOf(sheet, headers.length));
    const headerRow = sheet.addRow([]);
    headerRow.height = EXPORT_HEADER_ROW_HEIGHT;
    try {
      const header = await renderProjectExportHeader(this.project, sheetLabel, widthPx);
      const fileId = "export-header-" + String(sheet.id);
      this.images.set(fileId, header);
      this.imagePlacements.push({
        sheetId: sheet.id,
        row: 1,
        column: 1,
        fileId,
        xOffsetPx: 0,
        yOffsetPx: 0,
        widthPx,
        heightPx: EXPORT_HEADER_HEIGHT_PX,
        fitTo: { columns: headers.length, rows: 1 },
      });
    } catch {
      const cell = headerRow.getCell(1);
      cell.value = "[" + this.project.code + "]  " + this.project.name + "   ·   " + sheetLabel;
      cell.font = { name: EXPORT_FONT_NAME, size: 14, bold: true, color: { argb: "FF111827" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    }
    headerRow.commit();
    styleHeader(sheet, headers, widths).commit();
    return sheet;
  }

  private placeThumbnails(
    sheet: ExcelJS.Worksheet,
    refs: readonly ExportPhotoRef[],
    images: ReadonlyMap<string, ExportImage>,
    column: number,
    rowNumber: number,
    capacity: number,
    baseHeightPx: number,
  ): void {
    const available = availableRefs(refs, images);
    const columnWidthChars = sheet.getColumn(column).width ?? 8.43;
    const columnWidthPx = Math.max(IMAGE_WIDTH_PX, columnWidthChars * 7 + 5);
    for (let index = 0; index < available.length; index += 1) {
      const ref = available[index];
      if (ref === undefined) continue;
      const image = images.get(ref.fileId);
      if (image === undefined) continue;
      const line = Math.floor(index / capacity);
      const itemsOnLine = Math.min(capacity, available.length - line * capacity);
      const lineWidthPx = itemsOnLine * IMAGE_WIDTH_PX + Math.max(0, itemsOnLine - 1) * IMAGE_GAP_PX;
      this.images.set(ref.fileId, image);
      this.imagePlacements.push({
        sheetId: sheet.id,
        row: rowNumber,
        column,
        fileId: ref.fileId,
        xOffsetPx: Math.max(IMAGE_PADDING_PX, (columnWidthPx - lineWidthPx) / 2 + (index % capacity) * (IMAGE_WIDTH_PX + IMAGE_GAP_PX)),
        yOffsetPx: baseHeightPx + IMAGE_TOP_GAP_PX + line * (IMAGE_HEIGHT_PX + IMAGE_GAP_PX),
        widthPx: IMAGE_WIDTH_PX,
        heightPx: IMAGE_HEIGHT_PX,
      });
    }
  }
}
