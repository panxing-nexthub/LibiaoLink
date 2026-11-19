import ExcelJS from "exceljs";
import type { PageExportSheetKey } from "@libiaolink/contracts";
import type {
  ExportImage,
  ExportPhotoLoader,
  ExportPhotoRef,
  ProjectExportWorkbookFileResult,
  ProjectExportWorkbookResult,
  WorkbookImagePlacement,
} from "./project-export.workbook.js";
import { sanitizeFileName } from "./project-export.workbook.js";
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
import type { PageExportCellValue } from "./page-export.mapping.js";

export interface PageExportWorkbookColumn {
  key: string;
  label: string;
  width: number;
  photo: boolean;
}

export interface PageExportWorkbookRow {
  values: Readonly<Record<string, PageExportCellValue>>;
  photos: Readonly<Record<string, readonly ExportPhotoRef[]>>;
}

export interface PageExportWorkbookSheet {
  key: PageExportSheetKey;
  name: string;
  columns: readonly PageExportWorkbookColumn[];
  rows: readonly PageExportWorkbookRow[];
}

export interface PageExportWorkbookPayload {
  projectId: string;
  project: { code: string; name: string };
  origin: string | null;
  sheets: readonly PageExportWorkbookSheet[];
  images: ReadonlyMap<string, ExportImage>;
}

const IMAGE_WIDTH_PX = 88;
const IMAGE_HEIGHT_PX = 64;
const IMAGE_GAP_PX = 4;
const EMU_PER_PIXEL = 9525;
const IMAGE_TOP_GAP_PX = 8;
const IMAGE_BOTTOM_GAP_PX = 10;
const IMAGE_PADDING_PX = 4;

function uniquePhotos(refs: readonly ExportPhotoRef[]): ExportPhotoRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.fileId)) return false;
    seen.add(ref.fileId);
    return true;
  });
}

function appendMissing(base: string, refs: readonly ExportPhotoRef[], images: ReadonlyMap<string, ExportImage>): string {
  const missing = refs.filter((ref) => !images.has(ref.fileId)).map((ref) => "（附图缺失）" + ref.name);
  if (missing.length === 0) return base;
  const note = missing.join("\n");
  return base === "" ? note : base + "\n" + note;
}

function columnWidthPx(widthChars: number): number {
  return Math.max(IMAGE_WIDTH_PX, widthChars * 7 + 5);
}

function imageCapacity(widthChars: number): number {
  return Math.max(1, Math.floor(columnWidthPx(widthChars) / (IMAGE_WIDTH_PX + IMAGE_GAP_PX)));
}

function imageBlockHeightPx(lines: number): number {
  if (lines <= 0) return 0;
  return IMAGE_TOP_GAP_PX + lines * IMAGE_HEIGHT_PX + (lines - 1) * IMAGE_GAP_PX + IMAGE_BOTTOM_GAP_PX;
}

function placeImages(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  refs: readonly ExportPhotoRef[],
  images: ReadonlyMap<string, ExportImage>,
  column: number,
  rowNumber: number,
  capacity: number,
  baseHeightPx: number,
): number {
  const available = uniquePhotos(refs).filter((ref) => images.has(ref.fileId));
  const widthPx = columnWidthPx(sheet.getColumn(column).width ?? 8.43);
  for (let index = 0; index < available.length; index += 1) {
    const ref = available[index];
    if (ref === undefined) continue;
    const image = images.get(ref.fileId);
    if (image === undefined) continue;
    const slot = index % capacity;
    const line = Math.floor(index / capacity);
    const itemsOnLine = Math.min(capacity, available.length - line * capacity);
    const lineWidthPx = itemsOnLine * IMAGE_WIDTH_PX + Math.max(0, itemsOnLine - 1) * IMAGE_GAP_PX;
    const xOffsetPx = Math.max(IMAGE_PADDING_PX, (widthPx - lineWidthPx) / 2 + slot * (IMAGE_WIDTH_PX + IMAGE_GAP_PX));
    const yOffsetPx = baseHeightPx + IMAGE_TOP_GAP_PX + line * (IMAGE_HEIGHT_PX + IMAGE_GAP_PX);
    const imageId = workbook.addImage({
      buffer: Uint8Array.from(image.bytes).buffer as ArrayBuffer,
      extension: image.extension,
    });
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

function setWidths(sheet: ExcelJS.Worksheet, columns: readonly PageExportWorkbookColumn[]): void {
  for (let index = 0; index < columns.length; index += 1) {
    sheet.getColumn(index + 1).width = columns[index]?.width ?? 8.43;
  }
}

function fitColumnWidths(
  sheet: ExcelJS.Worksheet,
  columns: readonly PageExportWorkbookColumn[],
  values: readonly string[],
): void {
  for (let index = 0; index < columns.length; index += 1) {
    const baseWidth = columns[index]?.width ?? 8.43;
    const nextWidth = fittedColumnWidth(values[index] ?? "", baseWidth);
    if (nextWidth > (sheet.getColumn(index + 1).width ?? baseWidth)) {
      sheet.getColumn(index + 1).width = nextWidth;
    }
  }
}

function widthsOf(sheet: ExcelJS.Worksheet, count: number): number[] {
  return Array.from({ length: count }, (_value, index) => sheet.getColumn(index + 1).width ?? 8.43);
}

function cellText(value: PageExportCellValue | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? String(value) : value;
}

function fitSheetWidths(sheet: ExcelJS.Worksheet, definition: PageExportWorkbookSheet): void {
  fitColumnWidths(sheet, definition.columns, definition.columns.map((column) => column.label));
  for (const row of definition.rows) {
    fitColumnWidths(
      sheet,
      definition.columns,
      definition.columns.map((column) => column.photo ? "" : cellText(row.values[column.key])),
    );
  }
}

function styleHeader(sheet: ExcelJS.Worksheet, columns: readonly PageExportWorkbookColumn[]): ExcelJS.Row {
  const labels = columns.map((column) => column.label);
  fitColumnWidths(sheet, columns, labels);
  const row = sheet.addRow(labels);
  row.height = headerRowHeightPx(labels, widthsOf(sheet, columns.length)) / EXPORT_PX_PER_POINT;
  for (let index = 1; index <= columns.length; index += 1) {
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

function applyLinkFont(cell: ExcelJS.Cell): void {
  const value = cell.value;
  if (value !== null && typeof value === "object" && "hyperlink" in value) {
    cell.font = { name: EXPORT_FONT_NAME, size: 10, color: { argb: "FF0563C1" }, underline: true };
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

function alignPhotoCell(sheet: ExcelJS.Worksheet, rowNumber: number, column: number, hasImages: boolean): void {
  if (!hasImages) return;
  const cell = sheet.getCell(rowNumber, column);
  cell.alignment = { vertical: "top", horizontal: "center", wrapText: true };
  applyLinkFont(cell);
}

function estimatedTextHeight(sheet: ExcelJS.Worksheet, values: readonly string[], count: number): number {
  return bodyRowHeightPx(values, widthsOf(sheet, count));
}

function plainText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "text" in value) return String(value.text ?? "");
  return "";
}

function sheetNameOf(value: string): string {
  let result = value;
  for (const char of ["[", "]", ":", "*", "?", "/", "\\"]) result = result.split(char).join("_");
  result = result.replace(/[\u0000-\u001f]/g, "").replace(/^\u0027+|\u0027+$/g, "").trim();
  return (result === "" ? "导出数据" : result).slice(0, 31);
}

function rowValues(sheet: PageExportWorkbookSheet, row: PageExportWorkbookRow): PageExportCellValue[] {
  return sheet.columns.map((column) => (column.photo ? null : row.values[column.key] ?? null));
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

async function addPageSheet(
  workbook: ExcelJS.Workbook,
  payload: PageExportWorkbookPayload,
  sheetDefinition: PageExportWorkbookSheet,
): Promise<ExcelJS.Worksheet> {
  const sheet = workbook.addWorksheet(sheetNameOf(sheetDefinition.name));
  setWidths(sheet, sheetDefinition.columns);
  fitSheetWidths(sheet, sheetDefinition);
  const widthPx = exportHeaderWidthPx(widthsOf(sheet, sheetDefinition.columns.length));
  await addExportHeader(workbook, sheet, payload.project, sheetDefinition.name, widthPx, sheetDefinition.columns.length);
  styleHeader(sheet, sheetDefinition.columns);
  for (const definition of sheetDefinition.rows) {
    const row = sheet.addRow(rowValues(sheetDefinition, definition));
    const photoColumns: Array<{ column: number; refs: readonly ExportPhotoRef[]; capacity: number }> = [];
    for (let index = 0; index < sheetDefinition.columns.length; index += 1) {
      const column = sheetDefinition.columns[index];
      if (column === undefined || !column.photo) continue;
      const refs = uniquePhotos(definition.photos[column.key] ?? []);
      row.getCell(index + 1).value = appendMissing("", refs, payload.images) || null;
      photoColumns.push({
        column: index + 1,
        refs,
        capacity: imageCapacity(sheet.getColumn(index + 1).width ?? column.width),
      });
    }
    styleBodyRow(sheet, row.number, sheetDefinition.columns.length);
    const texts = sheetDefinition.columns.map((_column, index) => plainText(row.getCell(index + 1)));
    const basePx = estimatedTextHeight(sheet, texts, sheetDefinition.columns.length);
    let imageLines = 0;
    for (const photo of photoColumns) {
      const available = uniquePhotos(photo.refs).filter((ref) => payload.images.has(ref.fileId)).length;
      imageLines = Math.max(imageLines, available === 0 ? 0 : Math.ceil(available / photo.capacity));
    }
    row.height = (basePx + imageBlockHeightPx(imageLines)) / EXPORT_PX_PER_POINT;
    for (const photo of photoColumns) {
      const available = uniquePhotos(photo.refs).filter((ref) => payload.images.has(ref.fileId)).length;
      alignPhotoCell(sheet, row.number, photo.column, available > 0);
      placeImages(workbook, sheet, photo.refs, payload.images, photo.column, row.number, photo.capacity, basePx);
    }
  }
  return sheet;
}

export async function buildPageExportWorkbook(payload: PageExportWorkbookPayload): Promise<ProjectExportWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  const sheetNames: string[] = [];
  for (const definition of payload.sheets) {
    sheetNames.push((await addPageSheet(workbook, payload, definition)).name);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), sheetNames };
}

export function pageExportFileName(project: { code: string; name: string }, sheets: readonly { name: string }[]): string {
  const suffix = sheets.map((sheet) => sanitizeFileName(sheet.name)).join("、");
  return "[" + sanitizeFileName(project.code) + "] " + sanitizeFileName(project.name) + " - " + suffix + ".xlsx";
}

export class PageExportWorkbookWriter {
  private readonly workbook: ExcelJS.stream.xlsx.WorkbookWriter;
  private readonly sheetNames: string[] = [];
  private readonly images = new Map<string, ExportImage>();
  private readonly imagePlacements: WorkbookImagePlacement[] = [];
  private committed = false;

  constructor(
    private readonly filePath: string,
    private readonly project: { code: string; name: string },
    private readonly photoLoader: ExportPhotoLoader,
  ) {
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: true });
  }

  async writeSheet(sheetDefinition: PageExportWorkbookSheet, rows: AsyncIterable<PageExportWorkbookRow>): Promise<void> {
    const name = sheetNameOf(sheetDefinition.name);
    const sheet = this.workbook.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 2, topLeftCell: "A3" }],
    });
    this.sheetNames.push(name);
    setWidths(sheet, sheetDefinition.columns);
    fitColumnWidths(sheet, sheetDefinition.columns, sheetDefinition.columns.map((column) => column.label));
    const headerRow = sheet.addRow([]);
    headerRow.height = EXPORT_HEADER_ROW_HEIGHT;
    const brandCell = headerRow.getCell(1);
    brandCell.value = "[" + this.project.code + "]  " + this.project.name + "   ·   " + sheetDefinition.name;
    brandCell.font = { name: EXPORT_FONT_NAME, size: 14, bold: true, color: { argb: "FF111827" } };
    brandCell.alignment = { vertical: "middle", horizontal: "center" };
    brandCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    headerRow.commit();
    styleHeader(sheet, sheetDefinition.columns).commit();

    for await (const definition of rows) {
      const row = sheet.addRow(rowValues(sheetDefinition, definition));
      const photoColumns: Array<{
        column: number;
        refs: readonly ExportPhotoRef[];
        images: ReadonlyMap<string, ExportImage>;
        capacity: number;
      }> = [];
      for (let index = 0; index < sheetDefinition.columns.length; index += 1) {
        const column = sheetDefinition.columns[index];
        if (column === undefined || !column.photo) continue;
        const refs = uniquePhotos(definition.photos[column.key] ?? []);
        const images = await this.photoLoader(refs);
        row.getCell(index + 1).value = appendMissing("", refs, images) || null;
        photoColumns.push({
          column: index + 1,
          refs,
          images,
          capacity: imageCapacity(sheet.getColumn(index + 1).width ?? column.width),
        });
      }
      styleBodyRow(sheet, row.number, sheetDefinition.columns.length);
      const texts = sheetDefinition.columns.map((_column, index) => plainText(row.getCell(index + 1)));
      fitColumnWidths(sheet, sheetDefinition.columns, texts);
      const basePx = estimatedTextHeight(sheet, texts, sheetDefinition.columns.length);
      let imageLines = 0;
      for (const photo of photoColumns) {
        const available = uniquePhotos(photo.refs).filter((ref) => photo.images.has(ref.fileId)).length;
        imageLines = Math.max(imageLines, available === 0 ? 0 : Math.ceil(available / photo.capacity));
      }
      row.height = (basePx + imageBlockHeightPx(imageLines)) / EXPORT_PX_PER_POINT;
      for (const photo of photoColumns) {
        const available = uniquePhotos(photo.refs).filter((ref) => photo.images.has(ref.fileId)).length;
        alignPhotoCell(sheet, row.number, photo.column, available > 0);
        this.placeThumbnails(sheet, photo.refs, photo.images, photo.column, row.number, photo.capacity, basePx);
      }
      row.commit();
    }

    const widthPx = exportHeaderWidthPx(widthsOf(sheet, sheetDefinition.columns.length));
    try {
      const header = await renderProjectExportHeader(this.project, sheetDefinition.name, widthPx);
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
        fitTo: { columns: sheetDefinition.columns.length, rows: 1 },
      });
    } catch {
      // 品牌图渲染失败时保留已写入的居中文字抬头。
    }
    sheet.commit();
  }

  async commit(): Promise<ProjectExportWorkbookFileResult> {
    if (this.committed) throw new Error("页面导出工作簿已经提交");
    this.committed = true;
    await this.workbook.commit();
    return {
      filePath: this.filePath,
      sheetNames: this.sheetNames,
      images: this.images,
      imagePlacements: this.imagePlacements,
    };
  }

  async abort(): Promise<void> {
    if (this.committed) return;
    this.committed = true;
    await this.workbook.commit().catch(() => undefined);
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
    const available = uniquePhotos(refs).filter((ref) => images.has(ref.fileId));
    const widthPx = columnWidthPx(sheet.getColumn(column).width ?? 8.43);
    for (let index = 0; index < available.length; index += 1) {
      const ref = available[index];
      if (ref === undefined) continue;
      const image = images.get(ref.fileId);
      if (image === undefined) continue;
      const slot = index % capacity;
      const line = Math.floor(index / capacity);
      const itemsOnLine = Math.min(capacity, available.length - line * capacity);
      const lineWidthPx = itemsOnLine * IMAGE_WIDTH_PX + Math.max(0, itemsOnLine - 1) * IMAGE_GAP_PX;
      this.images.set(ref.fileId, image);
      this.imagePlacements.push({
        sheetId: sheet.id,
        row: rowNumber,
        column,
        fileId: ref.fileId,
        xOffsetPx: Math.max(IMAGE_PADDING_PX, (widthPx - lineWidthPx) / 2 + slot * (IMAGE_WIDTH_PX + IMAGE_GAP_PX)),
        yOffsetPx: baseHeightPx + IMAGE_TOP_GAP_PX + line * (IMAGE_HEIGHT_PX + IMAGE_GAP_PX),
        widthPx: IMAGE_WIDTH_PX,
        heightPx: IMAGE_HEIGHT_PX,
      });
    }
  }
}
