/**
 * 现场问题专报 v16：按确认稿重做版式，保留动态数据、自动换行与全量附图。
 * 蓝白品牌风、顶部品牌 Logo、居中标题、三段式信息卡与分组问题卡。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Image as CanvasImage, SKRSContext2D } from "@napi-rs/canvas";
import type {
  DailyReportPosterData,
  DailyReportPosterFontPaths,
  DailyReportPosterIssue,
  DailyReportPosterPhoto,
} from "./daily-report.poster.types.js";

type NapiCanvas = typeof import("@napi-rs/canvas");

const WIDTH = 1440;
const STAGE_PAD = 24;
const POSTER_X = 24;
const POSTER_Y = 24;
const POSTER_RADIUS = 34;
const POSTER_INSET = 58;
const CONTENT_X = POSTER_X + POSTER_INSET;
const CONTENT_WIDTH = WIDTH - POSTER_X * 2 - POSTER_INSET * 2;
const HERO_HEIGHT = 320;
const FACT_HEIGHT = 96;
const FACT_GAP = 20;
const CARD_RADIUS = 20;
const CARD_PAD = 26;
const ISSUE_BADGE = 54;
const ISSUE_TITLE_SIZE = 30;
const ISSUE_TITLE_LINE_HEIGHT = 40;
const ISSUE_COLUMN_GAP = 28;
const PHOTO_GAP = 14;
const PHOTO_HEIGHT = 172;
const PHOTO_CAPTION_HEIGHT = 24;
const ISSUE_GAP = 22;

const COLORS = {
  stage: "#e6ebf3",
  paper: "#f6f9fe",
  white: "#ffffff",
  ink: "#10213f",
  titleInk: "#07162d",
  bodyInk: "#172b4d",
  muted: "#52657d",
  soft: "#f4f7fc",
  line: "#e7edf7",
  lineStrong: "#dce6f3",
  blue: "#2f63d6",
  blueSoft: "#edf3ff",
  yellow: "#ffc400",
  orange: "#ef6a3d",
  orangeDeep: "#c94a24",
  orangeSoft: "#fff1eb",
  green: "#2f7b54",
  greenSoft: "#eaf7f0",
};

const FONT_REGULAR = "LibiaoLink Issue Source Han Sans";
const FONT_BOLD = "LibiaoLink Issue Source Han Sans Bold";
const BUNDLED_FONT = "SourceHanSansSC-Regular.otf";
const BUNDLED_FONT_BOLD = "SourceHanSansSC-Bold.otf";
const CANVAS_MODULE = "@napi-rs/canvas";

let canvasApiPromise: Promise<NapiCanvas> | null = null;
let fontRegistration = "";

async function loadCanvasApi(): Promise<NapiCanvas> {
  canvasApiPromise ??= import(CANVAS_MODULE);
  return await canvasApiPromise;
}

function resolveAssetPath(folder: string, fileName: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "assets", folder, fileName),
    join(here, "..", "..", "..", "assets", folder, fileName),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error("问题专报资产缺失：" + folder + "/" + fileName);
  }
  return found;
}

function fontAssetPath(fileName: string): string {
  return resolveAssetPath("fonts", fileName);
}

function posterAssetPath(fileName: string): string {
  return resolveAssetPath("", fileName);
}

function ensureFonts(globalFonts: NapiCanvas["GlobalFonts"], paths?: DailyReportPosterFontPaths): void {
  const regular = paths?.regular?.trim() || fontAssetPath(BUNDLED_FONT);
  const bold = paths?.bold?.trim() || fontAssetPath(BUNDLED_FONT_BOLD);
  const key = regular + "\n" + bold;
  if (fontRegistration === key) return;
  const regularFace = globalFonts.registerFromPath(regular, FONT_REGULAR);
  const boldFace = globalFonts.registerFromPath(bold, FONT_BOLD);
  if (regularFace === null || boldFace === null) {
    throw new Error("问题专报字体注册失败");
  }
  fontRegistration = key;
}

function setFont(ctx: SKRSContext2D, bold: boolean, size: number): void {
  ctx.font = String(size) + "px " + (bold ? FONT_BOLD : FONT_REGULAR);
}

function textWidth(ctx: SKRSContext2D, text: string): number {
  return ctx.measureText(text).width;
}

function drawSpaced(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
  color: string,
  align: "left" | "center" | "right" = "left",
): number {
  let width = 0;
  for (const char of Array.from(text)) {
    width += ctx.measureText(char).width + spacing;
  }
  width = Math.max(0, width - spacing);
  let cursor = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
  ctx.fillStyle = color;
  for (const char of Array.from(text)) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + spacing;
  }
  return width;
}

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = String(text ?? "").replace(/\r/g, "").split("\n");
  const lines: string[] = [];
  const forbidden = "，。！？；：、）】》」』％%";
  for (const paragraph of paragraphs) {
    const clean = paragraph.trim();
    if (clean.length === 0) continue;
    let line = "";
    for (const char of Array.from(clean)) {
      const candidate = line + char;
      if (line.length > 0 && textWidth(ctx, candidate) > maxWidth) {
        if (forbidden.includes(char)) {
          lines.push(candidate);
          line = "";
        } else {
          lines.push(line);
          line = char;
        }
      } else {
        line = candidate;
      }
    }
    if (line.length > 0) lines.push(line);
  }
  return lines.length > 0 ? lines : ["未填写"];
}

function parseIssueRecords(text: string | null): string[] {
  const rawLines = String(text ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const sourceLines = rawLines.length === 1
    ? (rawLines[0] ?? "").split(/\s+(?=\d{1,2}[.、．:：)）]?\s+)/u).filter((line) => line.trim().length > 0)
    : rawLines;
  const cleaned = sourceLines
    .map((line) => line.replace(/^(?:[（(]\s*\d{1,2}\s*[)）]|\d{1,2}\s*[:：.、．)）]|[①-⑳]|[•·]|[-—–])\s*/u, "").trim())
    .map((line) => line.replace(/^([1-9])\s+/u, "").trim())
    .filter((line) => line.length > 0);
  return cleaned.length > 0 ? cleaned : [];
}

function roundedPath(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function fillRoundRect(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number, color: string): void {
  roundedPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function fitSingleLine(ctx: SKRSContext2D, text: string, maxWidth: number, startSize: number, minSize: number): number {
  for (let size = startSize; size >= minSize; size -= 1) {
    setFont(ctx, true, size);
    if (textWidth(ctx, text) <= maxWidth) return size;
  }
  return minSize;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function photoCount(issues: readonly DailyReportPosterIssue[]): number {
  return issues.reduce((sum, issue) => sum + issue.photos.length, 0);
}

function issueStateStyle(state: string): { label: string; background: string; foreground: string } {
  if (state === "open") return { label: "待处理", background: COLORS.orangeSoft, foreground: COLORS.orangeDeep };
  if (state === "in_progress") return { label: "处理中", background: "#fff4e7", foreground: "#b75b19" };
  if (state === "done") return { label: "已完成", background: COLORS.greenSoft, foreground: COLORS.green };
  return { label: state || "未标记", background: "#eef2f7", foreground: COLORS.muted };
}

function weekdayLabel(dateText: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateText);
  if (match === null) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(date.getTime())) return "";
  const zh = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const en = ["SUN.", "MON.", "TUE.", "WED.", "THU.", "FRI.", "SAT."];
  const day = date.getUTCDay();
  return (en[day] ?? "") + " " + (zh[day] ?? "");
}

function drawDocumentIcon(ctx: SKRSContext2D, cx: number, cy: number, color: string, background: string): void {
  fillRoundRect(ctx, cx - 27, cy - 27, 54, 54, 27, background);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundedPath(ctx, cx - 9, cy - 12, 18, 24, 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy - 5);
  ctx.lineTo(cx + 5, cy - 5);
  ctx.moveTo(cx - 5, cy);
  ctx.lineTo(cx + 5, cy);
  ctx.moveTo(cx - 5, cy + 5);
  ctx.lineTo(cx + 2, cy + 5);
  ctx.stroke();
  ctx.restore();
}

function drawUserIcon(ctx: SKRSContext2D, cx: number, cy: number, color: string, background: string): void {
  fillRoundRect(ctx, cx - 27, cy - 27, 54, 54, 27, background);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy - 5, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy + 11, 10, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.restore();
}

function drawPhotoIcon(ctx: SKRSContext2D, cx: number, cy: number, color: string, background: string): void {
  fillRoundRect(ctx, cx - 27, cy - 27, 54, 54, 27, background);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundedPath(ctx, cx - 12, cy - 9, 24, 18, 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 4, cy - 3, 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy + 6);
  ctx.lineTo(cx - 3, cy);
  ctx.lineTo(cx + 2, cy + 4);
  ctx.lineTo(cx + 6, cy + 1);
  ctx.lineTo(cx + 10, cy + 6);
  ctx.stroke();
  ctx.restore();
}

const V16_SINGLE_PHOTO_MAX_HEIGHT = 340;
const V16_DEFAULT_PHOTO_ASPECT = 4 / 3;

interface V16PhotoBox {
  width: number;
  height: number;
}

function v16PhotoAspect(image: CanvasImage | undefined): number {
  if (image === undefined || image.width <= 0 || image.height <= 0) return V16_DEFAULT_PHOTO_ASPECT;
  return image.width / image.height;
}

/** 单图按原始比例完整展示：先顶到最大高度，再按比例收窄宽度，绝不裁切。 */
function v16SinglePhotoBox(image: CanvasImage | undefined, maxWidth: number): V16PhotoBox {
  const aspect = v16PhotoAspect(image);
  const width = Math.min(maxWidth, Math.round(V16_SINGLE_PHOTO_MAX_HEIGHT * aspect));
  return { width, height: Math.round(width / aspect) };
}

function drawImageCover(ctx: SKRSContext2D, image: CanvasImage, x: number, y: number, width: number, height: number): void {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = Math.max(0, (image.width - sourceWidth) / 2);
  const sourceY = Math.max(0, (image.height - sourceHeight) / 2);
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

/** 单图两侧留白只用纯色底，不叠加模糊 / 阴影。 */
function drawV16SinglePhotoFrame(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = V16.soft;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#d8e3f0";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
}

async function prepareIssueImages(
  canvasApi: NapiCanvas,
  issues: readonly DailyReportPosterIssue[],
  images: ReadonlyMap<string, Buffer>,
): Promise<Map<string, CanvasImage>> {
  const decoded = new Map<string, CanvasImage>();
  const photos = issues.flatMap((issue) => issue.photos);
  await Promise.all(
    photos.map(async (photo) => {
      const bytes = images.get(photo.fileId);
      if (bytes === undefined) return;
      try {
        decoded.set(photo.fileId, await canvasApi.loadImage(bytes));
      } catch {
        // 单张附图损坏不影响整张海报，绘制时显示占位。
      }
    }),
  );
  return decoded;
}



const V16 = {
  paper: "#f7faff",
  white: "#ffffff",
  navy: "#0b2a5e",
  title: "#071d46",
  ink: "#172b4d",
  muted: "#5b6e86",
  soft: "#f4f8fe",
  line: "#dfe8f4",
  lineStrong: "#d3e0f0",
  accent: "#2f68d8",
  blueSoft: "#edf4ff",
  sky: "#e2f3ff",
  skyInk: "#0b5f9e",
  amberSoft: "#fff3df",
  amberInk: "#b35e1b",
  greenSoft: "#e8f7ef",
  greenInk: "#2f7b54",
  graySoft: "#eef2f7",
} as const;

const V16_CARD_PAD = 28;
const V16_CARD_RADIUS = 20;
const V16_FACT_HEIGHT = 96;
const V16_FACT_GAP = 20;
const V16_ISSUE_GAP = 22;
const V16_PHOTO_GAP = 14;
const V16_PHOTO_HEIGHT = 190;
const V16_PHOTO_CAPTION_HEIGHT = 26;
const V16_STATUS_WIDTH = 136;

interface V16MetaLayout {
  projectLines: string[];
  projectSize: number;
  projectLineHeight: number;
  height: number;
}

interface V16TextRow {
  lines: string[];
  height: number;
}

interface V16IssueLayout {
  category: string;
  categorySize: number;
  ownerWidth: number;
  problemRows: V16TextRow[];
  solutionRows: V16TextRow[];
  leftWidth: number;
  rightWidth: number;
  photoWidth: number;
  photoHeight: number;
  photoColumns: number;
  photoOffsetX: number;
  photoRows: number;
  photoGridHeight: number;
  problemBlockHeight: number;
  lowerHeaderTop: number;
  bodyTop: number;
  bodyHeight: number;
  solutionHeight: number;
  cardHeight: number;
}

interface V16StateStyle {
  label: string;
  background: string;
  foreground: string;
  icon: "alert" | "clock" | "check";
}

function v16StateStyle(state: string): V16StateStyle {
  if (state === "open") {
    return { label: "未解决", background: V16.sky, foreground: V16.skyInk, icon: "alert" };
  }
  if (state === "in_progress") {
    return { label: "处理中", background: V16.amberSoft, foreground: V16.amberInk, icon: "clock" };
  }
  if (state === "done") {
    return { label: "已完成", background: V16.greenSoft, foreground: V16.greenInk, icon: "check" };
  }
  return { label: state || "未标记", background: V16.graySoft, foreground: V16.muted, icon: "alert" };
}

function parseIssueLines(text: string | null): string[] {
  return String(text ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^(?:[（(]\s*\d{1,2}\s*[)）]|\d{1,2}\s*[:：.、．)）]|[①-⑳]|[•·]|[-—–])\s*/u, "").trim())
    .map((line) => line.replace(/^([1-9])\s+/u, "").trim())
    .filter((line) => line.length > 0);
}

function layoutV16Meta(ctx: SKRSContext2D, data: DailyReportPosterData): V16MetaLayout {
  const projectName = data.projectName.trim() || "未填写项目";
  let projectSize = 22;
  let projectLines: string[] = [];
  for (; projectSize >= 16; projectSize -= 1) {
    setFont(ctx, true, projectSize);
    projectLines = wrapText(ctx, projectName, 640);
    if (projectLines.length <= 1 || projectSize === 16) break;
  }
  const projectLineHeight = Math.round(projectSize * 1.22);
  return {
    projectLines,
    projectSize,
    projectLineHeight,
    height: Math.max(44, projectLines.length * projectLineHeight + 2),
  };
}

function layoutV16Issue(
  ctx: SKRSContext2D,
  issue: DailyReportPosterIssue,
  cardWidth: number,
  decoded?: ReadonlyMap<string, CanvasImage>,
): V16IssueLayout {
  const innerWidth = cardWidth - V16_CARD_PAD * 2;
  const category = issue.categories.length > 0 ? issue.categories.join(" / ") : "未归类";
  const ownerName = issue.ownerName ?? "待分派";
  setFont(ctx, false, 15);
  const ownerLabelWidth = textWidth(ctx, "处理人");
  setFont(ctx, true, 18);
  const ownerValueWidth = textWidth(ctx, ownerName);
  const ownerWidth = Math.ceil(ownerLabelWidth + ownerValueWidth + 42);
  const categoryMaxWidth = Math.max(180, innerWidth - (ownerWidth + V16_STATUS_WIDTH + 82) - 70);
  const categorySize = fitSingleLine(ctx, category, categoryMaxWidth, 32, 20);

  setFont(ctx, false, 20);
  const problemItems = parseIssueLines(issue.title);
  const problemRows = (problemItems.length > 0 ? problemItems : ["未填写问题描述"]).map((item) => {
    const lines = wrapText(ctx, item, innerWidth - 100);
    return { lines, height: Math.max(54, lines.length * 26 + 18) };
  });
  const problemBlockHeight = problemRows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, problemRows.length - 1) * 5;

  const hasPhotos = issue.photos.length > 0;
  const columnGap = 30;
  const leftWidth = hasPhotos ? Math.floor((innerWidth - columnGap) * 0.43) : innerWidth;
  const rightWidth = hasPhotos ? innerWidth - columnGap - leftWidth : 0;

  setFont(ctx, false, 18);
  const solutionRows = parseIssueRecords(issue.solution).map((record) => {
    const lines = wrapText(ctx, record, Math.max(120, leftWidth - 48));
    return { lines, height: Math.max(38, lines.length * 24 + 12) };
  });
  const solutionHeight = solutionRows.length > 0
    ? solutionRows.reduce((sum, row) => sum + row.height, 0) + (solutionRows.length - 1) * 4
    : 54;

  const photoColumns = issue.photos.length === 1 ? 1 : 2;
  const singlePhoto = issue.photos.length === 1
    ? v16SinglePhotoBox(decoded?.get(issue.photos[0]?.fileId ?? ""), rightWidth)
    : undefined;
  const photoWidth = hasPhotos
    ? singlePhoto?.width ?? (rightWidth - V16_PHOTO_GAP * (photoColumns - 1)) / photoColumns
    : 0;
  const photoHeight = singlePhoto?.height ?? V16_PHOTO_HEIGHT;
  const photoOffsetX = singlePhoto === undefined ? 0 : Math.round((rightWidth - singlePhoto.width) / 2);
  const photoRows = hasPhotos ? Math.ceil(issue.photos.length / photoColumns) : 0;
  const photoGridHeight = hasPhotos
    ? photoRows * (photoHeight + V16_PHOTO_CAPTION_HEIGHT) + Math.max(0, photoRows - 1) * V16_PHOTO_GAP
    : 0;

  const problemTop = 126;
  const lowerHeaderTop = problemTop + problemBlockHeight + 24;
  const bodyTop = lowerHeaderTop + 38;
  const bodyHeight = Math.max(solutionHeight, photoGridHeight);
  const cardHeight = bodyTop + bodyHeight + 30;

  return {
    category,
    categorySize,
    ownerWidth,
    problemRows,
    solutionRows,
    leftWidth,
    rightWidth,
    photoWidth,
    photoHeight,
    photoColumns,
    photoOffsetX,
    photoRows,
    photoGridHeight,
    problemBlockHeight,
    lowerHeaderTop,
    bodyTop,
    bodyHeight,
    solutionHeight,
    cardHeight,
  };
}


function drawV16BriefcaseIcon(ctx: SKRSContext2D, cx: number, cy: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  roundedPath(ctx, cx - 10, cy - 6, 20, 14, 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy - 6);
  ctx.lineTo(cx - 5, cy - 9);
  ctx.lineTo(cx + 5, cy - 9);
  ctx.lineTo(cx + 5, cy - 6);
  ctx.stroke();
  ctx.restore();
}

function drawV16CalendarIcon(ctx: SKRSContext2D, cx: number, cy: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  roundedPath(ctx, cx - 9, cy - 10, 18, 20, 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy - 4);
  ctx.lineTo(cx + 9, cy - 4);
  ctx.moveTo(cx - 5, cy - 13);
  ctx.lineTo(cx - 5, cy - 8);
  ctx.moveTo(cx + 5, cy - 13);
  ctx.lineTo(cx + 5, cy - 8);
  ctx.stroke();
  ctx.restore();
}

function drawV16LinkIcon(ctx: SKRSContext2D, cx: number, cy: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(cx - 6, cy, 6, Math.PI * 0.35, Math.PI * 1.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 6, cy, 6, Math.PI * 1.35, Math.PI * 0.58);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 3, cy);
  ctx.lineTo(cx + 3, cy);
  ctx.stroke();
  ctx.restore();
}

function drawV16Skyline(ctx: SKRSContext2D): void {
  ctx.save();
  ctx.translate(WIDTH - 430, POSTER_Y + 32);
  ctx.strokeStyle = "rgba(65,92,127,0.13)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(0, 132);
  ctx.lineTo(390, 132);
  ctx.moveTo(26, 132);
  ctx.lineTo(26, 95);
  ctx.lineTo(112, 95);
  ctx.lineTo(112, 132);
  ctx.moveTo(28, 108);
  ctx.lineTo(110, 108);
  ctx.moveTo(134, 132);
  ctx.lineTo(134, 76);
  ctx.lineTo(216, 76);
  ctx.lineTo(216, 132);
  ctx.moveTo(151, 76);
  ctx.lineTo(151, 96);
  ctx.lineTo(199, 96);
  ctx.lineTo(199, 76);
  ctx.moveTo(255, 132);
  ctx.lineTo(255, 28);
  ctx.moveTo(226, 49);
  ctx.lineTo(355, 49);
  ctx.moveTo(255, 49);
  ctx.lineTo(301, 28);
  ctx.moveTo(326, 49);
  ctx.lineTo(326, 82);
  ctx.moveTo(326, 82);
  ctx.arc(326, 87, 5, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.restore();
}

function drawV16Hero(
  ctx: SKRSContext2D,
  data: DailyReportPosterData,
  meta: V16MetaLayout,
  brandLogo: CanvasImage | undefined,
): void {
  const x = POSTER_X;
  const y = POSTER_Y;
  const width = WIDTH - POSTER_X * 2;

  if (brandLogo !== undefined) {
    const logoWidth = 166;
    const logoHeight = logoWidth * (55 / 156);
    ctx.drawImage(brandLogo, x + 58, y + 22, logoWidth, logoHeight);
  }

  ctx.textAlign = "center";
  setFont(ctx, true, 58);
  ctx.fillStyle = V16.title;
  ctx.fillText("现场问题专报", WIDTH / 2, y + 82);
  setFont(ctx, false, 13);
  drawSpaced(ctx, "FIELD ISSUE REPORT", WIDTH / 2, y + 112, 7.6, "#65768c", "center");
  fillRoundRect(ctx, WIDTH / 2 - 34, y + 126, 68, 4, 2, "#f4b500");
  ctx.textAlign = "left";

  const metaTop = y + 140;
  drawV16BriefcaseIcon(ctx, x + 70, metaTop + 11, "#2e5f9e");
  setFont(ctx, false, 17);
  ctx.fillStyle = "#526985";
  ctx.fillText("项目名称", x + 92, metaTop + 17);
  ctx.strokeStyle = V16.lineStrong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 176, metaTop - 2);
  ctx.lineTo(x + 176, metaTop + 25);
  ctx.stroke();
  setFont(ctx, true, meta.projectSize);
  ctx.fillStyle = V16.title;
  meta.projectLines.forEach((line, index) => {
    ctx.fillText(line, x + 196, metaTop + 18 + index * meta.projectLineHeight);
  });

  const dateText = data.reportDate.replaceAll("-", ".");
  const dateWidth = Math.max(118, textWidth(ctx, dateText) + 52);
  drawV16CalendarIcon(ctx, x + width - 58 - dateWidth, metaTop + 10, "#2e5f9e");
  ctx.textAlign = "right";
  setFont(ctx, true, 22);
  ctx.fillStyle = V16.title;
  ctx.fillText(dateText, x + width - 58, metaTop + 18);
  ctx.textAlign = "left";
}

function drawV16Facts(ctx: SKRSContext2D, data: DailyReportPosterData, y: number): void {
  const cardWidth = (CONTENT_WIDTH - V16_FACT_GAP * 2) / 3;
  const cards = [
    { label: "项目编号", value: data.projectCode || "未填写", icon: "document" as const },
    { label: "项目经理", value: data.managers.join(" / ") || "未填写", icon: "user" as const },
    { label: "问题附图", value: String(photoCount(data.issues)) + " 张", icon: "photo" as const },
  ];

  cards.forEach((card, index) => {
    const x = CONTENT_X + index * (cardWidth + V16_FACT_GAP);
    fillRoundRect(ctx, x, y + 5, cardWidth, V16_FACT_HEIGHT, 16, "rgba(23,54,96,0.055)");
    fillRoundRect(ctx, x, y, cardWidth, V16_FACT_HEIGHT, 16, V16.white);
    ctx.strokeStyle = V16.line;
    ctx.lineWidth = 1;
    roundedPath(ctx, x, y, cardWidth, V16_FACT_HEIGHT, 16);
    ctx.stroke();

    const iconColor = "#2f65b8";
    const iconBackground = "#edf4ff";
    if (card.icon === "document") drawDocumentIcon(ctx, x + 56, y + 48, iconColor, iconBackground);
    if (card.icon === "user") drawUserIcon(ctx, x + 56, y + 48, iconColor, iconBackground);
    if (card.icon === "photo") drawPhotoIcon(ctx, x + 56, y + 48, iconColor, iconBackground);

    setFont(ctx, false, 17);
    ctx.fillStyle = "#526985";
    ctx.fillText(card.label, x + 98, y + 38);
    const size = fitSingleLine(ctx, card.value, cardWidth - 126, 24, 18);
    setFont(ctx, true, size);
    ctx.fillStyle = V16.title;
    ctx.fillText(card.value, x + 98, y + 70);
  });
}

function drawV16Stage(ctx: SKRSContext2D, data: DailyReportPosterData, y: number): void {
  const stageText = data.stages.length > 0 ? data.stages.join(" / ") : "未关联";
  drawV16LinkIcon(ctx, CONTENT_X + 10, y + 11, "#2e5f9e");
  setFont(ctx, true, 18);
  ctx.fillStyle = "#334b6b";
  ctx.fillText("关联阶段", CONTENT_X + 32, y + 18);
  const labelWidth = textWidth(ctx, "关联阶段");
  ctx.strokeStyle = V16.lineStrong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CONTENT_X + 52 + labelWidth, y + 1);
  ctx.lineTo(CONTENT_X + 52 + labelWidth, y + 23);
  ctx.stroke();
  setFont(ctx, false, 18);
  ctx.fillStyle = data.stages.length > 0 ? "#315a91" : V16.muted;
  ctx.fillText(stageText, CONTENT_X + 72 + labelWidth, y + 18);
}

function drawV16StateIcon(ctx: SKRSContext2D, cx: number, cy: number, style: V16StateStyle): void {
  ctx.save();
  ctx.strokeStyle = style.foreground;
  ctx.fillStyle = style.foreground;
  ctx.lineWidth = 1.8;
  if (style.icon === "alert") {
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillRect(cx - 1.05, cy - 4.5, 2.1, 5.6);
    ctx.beginPath();
    ctx.arc(cx, cy + 4.2, 1.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (style.icon === "clock") {
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx, cy + 1);
    ctx.lineTo(cx + 4, cy + 3);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy);
    ctx.lineTo(cx - 1, cy + 3.5);
    ctx.lineTo(cx + 5, cy - 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawV16StatePill(ctx: SKRSContext2D, x: number, y: number, style: V16StateStyle): void {
  fillRoundRect(ctx, x, y, V16_STATUS_WIDTH, 40, 9, style.background);
  setFont(ctx, true, 17);
  const textW = textWidth(ctx, style.label);
  const groupWidth = 18 + 8 + textW;
  const startX = x + (V16_STATUS_WIDTH - groupWidth) / 2;
  drawV16StateIcon(ctx, startX + 9, y + 20, style);
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.fillStyle = style.foreground;
  ctx.fillText(style.label, startX + 26, y + 20.5);
  ctx.restore();
}


function drawV16Photo(
  ctx: SKRSContext2D,
  image: CanvasImage | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  index: number,
): void {
  ctx.save();
  ctx.fillStyle = "#edf3fa";
  ctx.fillRect(x, y, width, height);
  if (image !== undefined) {
    drawImageCover(ctx, image, x, y, width, height);
  } else {
    drawPhotoIcon(ctx, x + width / 2, y + height / 2 - 4, "#8095ae", "#e4edf8");
    setFont(ctx, false, 13);
    ctx.fillStyle = "#7f92aa";
    ctx.textAlign = "center";
    ctx.fillText("附图暂不可用", x + width / 2, y + height / 2 + 34);
    ctx.textAlign = "left";
  }
  ctx.strokeStyle = "#d8e3f0";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.restore();

  setFont(ctx, true, 13);
  drawSpaced(ctx, "PHOTO " + pad2(index + 1), x + width / 2, y + height + 20, 1.8, "#253954", "center");
}

function drawV16SolutionRows(
  ctx: SKRSContext2D,
  issue: DailyReportPosterIssue,
  layout: V16IssueLayout,
  x: number,
  y: number,
): void {
  if (layout.solutionRows.length === 0) {
    fillRoundRect(ctx, x, y, layout.leftWidth, 54, 10, V16.soft);
    setFont(ctx, false, 17);
    ctx.fillStyle = V16.muted;
    ctx.fillText("暂无解决方案或建议", x + 18, y + 33);
    return;
  }

  let cursor = y;
  layout.solutionRows.forEach((row, index) => {
    ctx.fillStyle = "#eef4ff";
    ctx.beginPath();
    ctx.arc(x + 12, cursor + 18, 11, 0, Math.PI * 2);
    ctx.fill();
    setFont(ctx, true, 12.5);
    ctx.fillStyle = "#2b5b9a";
    ctx.textAlign = "center";
    ctx.fillText(String(index + 1), x + 12, cursor + 22);
    ctx.textAlign = "left";
    setFont(ctx, false, 18);
    ctx.fillStyle = V16.ink;
    row.lines.forEach((line, lineIndex) => {
      ctx.fillText(line, x + 34, cursor + 24 + lineIndex * 24);
    });
    cursor += row.height + 4;
  });
}

function drawV16IssueCard(
  ctx: SKRSContext2D,
  issue: DailyReportPosterIssue,
  index: number,
  decoded: ReadonlyMap<string, CanvasImage>,
  x: number,
  y: number,
  width: number,
  layout: V16IssueLayout,
): void {
  fillRoundRect(ctx, x, y + 7, width, layout.cardHeight, V16_CARD_RADIUS, "rgba(20,44,82,0.065)");
  fillRoundRect(ctx, x, y, width, layout.cardHeight, V16_CARD_RADIUS, V16.white);
  ctx.strokeStyle = V16.line;
  ctx.lineWidth = 1;
  roundedPath(ctx, x, y, width, layout.cardHeight, V16_CARD_RADIUS);
  ctx.stroke();

  fillRoundRect(ctx, x + V16_CARD_PAD, y + 26, 56, 56, 11, "#081f4b");
  setFont(ctx, true, 24);
  ctx.fillStyle = V16.white;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pad2(index + 1), x + V16_CARD_PAD + 28, y + 55);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  setFont(ctx, true, layout.categorySize);
  ctx.fillStyle = V16.title;
  ctx.fillText(layout.category, x + V16_CARD_PAD + 78, y + 66);

  const style = v16StateStyle(issue.state);
  const statusX = x + width - V16_CARD_PAD - V16_STATUS_WIDTH;
  const ownerRight = statusX - 14;
  const ownerX = ownerRight - layout.ownerWidth;
  fillRoundRect(ctx, ownerX, y + 34, layout.ownerWidth, 40, 9, V16.blueSoft);
  ctx.save();
  ctx.textBaseline = "middle";
  setFont(ctx, false, 15);
  ctx.fillStyle = "#2f65b8";
  ctx.fillText("处理人", ownerX + 16, y + 54);
  const labelWidth = textWidth(ctx, "处理人");
  setFont(ctx, true, 18);
  ctx.fillStyle = V16.ink;
  ctx.fillText(issue.ownerName ?? "待分派", ownerX + 16 + labelWidth + 10, y + 54);
  ctx.restore();
  drawV16StatePill(ctx, statusX, y + 34, style);

  ctx.strokeStyle = V16.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + V16_CARD_PAD, y + 108);
  ctx.lineTo(x + width - V16_CARD_PAD, y + 108);
  ctx.stroke();

  let cursor = y + 126;
  layout.problemRows.forEach((row, rowIndex) => {
    ctx.fillStyle = "#edf4ff";
    ctx.beginPath();
    ctx.arc(x + V16_CARD_PAD + 12, cursor + 26, 12, 0, Math.PI * 2);
    ctx.fill();
    setFont(ctx, true, 13);
    ctx.fillStyle = "#2b5b9a";
    ctx.textAlign = "center";
    ctx.fillText(String(rowIndex + 1), x + V16_CARD_PAD + 12, cursor + 30.5);
    ctx.textAlign = "left";
    setFont(ctx, false, 20);
    ctx.fillStyle = V16.ink;
    row.lines.forEach((line, lineIndex) => {
      ctx.fillText(line, x + V16_CARD_PAD + 36, cursor + 34 + lineIndex * 26);
    });
    ctx.strokeStyle = "#e9eef6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + V16_CARD_PAD, cursor + row.height - 1);
    ctx.lineTo(x + width - V16_CARD_PAD, cursor + row.height - 1);
    ctx.stroke();
    cursor += row.height + 5;
  });

  const lowerTop = y + layout.lowerHeaderTop;
  const rightX = x + V16_CARD_PAD + layout.leftWidth + 30;
  fillRoundRect(ctx, x + V16_CARD_PAD, lowerTop + 2, 4, 22, 2, "#2f68d8");
  setFont(ctx, true, 20);
  ctx.fillStyle = V16.title;
  ctx.fillText("解决方案或建议", x + V16_CARD_PAD + 16, lowerTop + 20);
  if (issue.photos.length > 0) {
    fillRoundRect(ctx, rightX, lowerTop + 2, 4, 22, 2, "#2f68d8");
    setFont(ctx, true, 20);
    ctx.fillStyle = V16.title;
    ctx.fillText("问题附图", rightX + 16, lowerTop + 20);
  }

  if (issue.photos.length > 0) {
    ctx.strokeStyle = "#e5ecf5";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + V16_CARD_PAD + layout.leftWidth + 15, lowerTop);
    ctx.lineTo(x + V16_CARD_PAD + layout.leftWidth + 15, y + layout.cardHeight - 24);
    ctx.stroke();
  }

  const bodyTop = y + layout.bodyTop;
  drawV16SolutionRows(ctx, issue, layout, x + V16_CARD_PAD, bodyTop);

  if (issue.photos.length > 0) {
    issue.photos.forEach((photo, photoIndex) => {
      const column = photoIndex % layout.photoColumns;
      const row = Math.floor(photoIndex / layout.photoColumns);
      if (layout.photoColumns === 1 && issue.photos.length === 1) {
        drawV16SinglePhotoFrame(ctx, rightX, bodyTop, layout.rightWidth, layout.photoHeight);
      }
      const photoX = rightX + layout.photoOffsetX + column * (layout.photoWidth + V16_PHOTO_GAP);
      const photoY = bodyTop + row * (layout.photoHeight + V16_PHOTO_CAPTION_HEIGHT + V16_PHOTO_GAP);
      drawV16Photo(ctx, decoded.get(photo.fileId), photoX, photoY, layout.photoWidth, layout.photoHeight, photoIndex);
    });
  }
}

function drawV16EmptyIssueCard(ctx: SKRSContext2D, x: number, y: number, width: number): number {
  const height = 188;
  fillRoundRect(ctx, x, y + 6, width, height, V16_CARD_RADIUS, "rgba(20,44,82,0.06)");
  fillRoundRect(ctx, x, y, width, height, V16_CARD_RADIUS, V16.white);
  ctx.strokeStyle = V16.line;
  ctx.lineWidth = 1;
  roundedPath(ctx, x, y, width, height, V16_CARD_RADIUS);
  ctx.stroke();
  setFont(ctx, true, 24);
  ctx.fillStyle = V16.title;
  ctx.fillText("本日报未关联现场问题", x + V16_CARD_PAD, y + 83);
  setFont(ctx, false, 16);
  ctx.fillStyle = V16.muted;
  ctx.fillText("问题处理进展以 LibiaoLink 系统记录为准。", x + V16_CARD_PAD, y + 119);
  return height;
}


/** 现场问题专报 v16：按确认稿输出蓝白版式，内容按真实数据动态增高。 */
export async function renderDailyReportIssuePosterV16(
  data: DailyReportPosterData,
  images: ReadonlyMap<string, Buffer> = new Map(),
  fonts?: DailyReportPosterFontPaths,
): Promise<Buffer> {
  const canvasApi = await loadCanvasApi();
  ensureFonts(canvasApi.GlobalFonts, fonts);

  const measure = canvasApi.createCanvas(WIDTH, 1).getContext("2d");
  const meta = layoutV16Meta(measure, data);
  const decoded = await prepareIssueImages(canvasApi, data.issues, images);
  const issueLayouts = data.issues.map((issue) => layoutV16Issue(measure, issue, CONTENT_WIDTH, decoded));
  const issuesHeight = data.issues.length === 0
    ? 188
    : issueLayouts.reduce((sum, layout) => sum + layout.cardHeight, 0) + Math.max(0, issueLayouts.length - 1) * V16_ISSUE_GAP;

  const factsY = POSTER_Y + 140 + meta.height + 14;
  const stageY = factsY + V16_FACT_HEIGHT + 16;
  const cardsY = stageY + 52;
  const posterBottom = cardsY + issuesHeight + 28;
  const posterHeight = posterBottom - POSTER_Y;
  const finalHeight = posterBottom + STAGE_PAD;

  const canvas = canvasApi.createCanvas(WIDTH, finalHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = COLORS.stage;
  ctx.fillRect(0, 0, WIDTH, finalHeight);

  ctx.save();
  roundedPath(ctx, POSTER_X + 1, POSTER_Y + 12, WIDTH - POSTER_X * 2 - 2, posterHeight, POSTER_RADIUS);
  ctx.fillStyle = "rgba(20,44,82,0.10)";
  ctx.fill();
  ctx.restore();

  roundedPath(ctx, POSTER_X, POSTER_Y, WIDTH - POSTER_X * 2, posterHeight, POSTER_RADIUS);
  ctx.fillStyle = V16.paper;
  ctx.fill();
  ctx.save();
  roundedPath(ctx, POSTER_X, POSTER_Y, WIDTH - POSTER_X * 2, posterHeight, POSTER_RADIUS);
  ctx.clip();

  const heroGradient = ctx.createLinearGradient(POSTER_X, POSTER_Y, POSTER_X + WIDTH * 0.58, POSTER_Y + 330);
  heroGradient.addColorStop(0, "#fbfdff");
  heroGradient.addColorStop(0.55, "#edf4ff");
  heroGradient.addColorStop(1, "#dfeaff");
  ctx.fillStyle = heroGradient;
  ctx.fillRect(POSTER_X, POSTER_Y, WIDTH - POSTER_X * 2, 330);

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 74;
  ctx.beginPath();
  ctx.arc(WIDTH - 155, POSTER_Y - 235, 360, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(63,108,182,0.08)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(WIDTH - 470, POSTER_Y + 260, 260, 160, -0.08, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(WIDTH - 470, POSTER_Y + 260, 350, 230, -0.08, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  drawV16Skyline(ctx);

  let brandLogo: CanvasImage | undefined;
  try {
    brandLogo = await canvasApi.loadImage(readFileSync(posterAssetPath("libiao-brand-logo.svg")));
  } catch {
    brandLogo = undefined;
  }

  drawV16Hero(ctx, data, meta, brandLogo);
  drawV16Facts(ctx, data, factsY);
  drawV16Stage(ctx, data, stageY);

  let cursor = cardsY;
  if (data.issues.length === 0) {
    drawV16EmptyIssueCard(ctx, CONTENT_X, cursor, CONTENT_WIDTH);
  } else {
    data.issues.forEach((issue, index) => {
      const layout = issueLayouts[index];
      if (layout === undefined) return;
      drawV16IssueCard(ctx, issue, index, decoded, CONTENT_X, cursor, CONTENT_WIDTH, layout);
      cursor += layout.cardHeight + V16_ISSUE_GAP;
    });
  }

  ctx.restore();
  ctx.strokeStyle = "rgba(110,139,180,0.22)";
  ctx.lineWidth = 1;
  roundedPath(ctx, POSTER_X, POSTER_Y, WIDTH - POSTER_X * 2, posterHeight, POSTER_RADIUS);
  ctx.stroke();

  return canvas.toBuffer("image/png");
}
