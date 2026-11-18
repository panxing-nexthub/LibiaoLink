/**
 * 日报群同步海报 v14：浅蓝科技背景、小黄车机器人主视觉、白底圆角卡片与直角现场图。
 * 设计基准为 2026-11-17 定稿；服务端按真实数据动态增高，不截断任务与现场图。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Image as CanvasImage, SKRSContext2D } from "@napi-rs/canvas";
import type {
  DailyReportPosterData,
  DailyReportPosterFontPaths,
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
const HERO_HEIGHT = 334;
const FACT_HEIGHT = 96;
const PANEL_RADIUS = 18;
const TASK_GAP = 22;
const TASK_PANEL_WIDTH = (CONTENT_WIDTH - TASK_GAP) / 2;
const PHOTO_PANEL_PADDING = 16;
const PHOTO_GAP = 18;
const PHOTO_INNER_WIDTH = CONTENT_WIDTH - PHOTO_PANEL_PADDING * 2;
const PHOTO_WIDTH = (PHOTO_INNER_WIDTH - PHOTO_GAP) / 2;
const PHOTO_CAPTION_HEIGHT = 28;

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
};

const FONT_REGULAR = "LibiaoLink Daily Source Han Sans";
const FONT_BOLD = "LibiaoLink Daily Source Han Sans Bold";
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
    throw new Error("日报海报资产缺失：" + folder + "/" + fileName);
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
    throw new Error("日报海报字体注册失败");
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

function parseItems(text: string | null): string[] {
  const lines = String(text ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const cleaned = lines
    .map((line) => line.replace(/^(?:[（(]\s*\d{1,2}\s*[)）]|\d{1,2}\s*[:：.、．)）]|[①-⑳]|[•·]|[-—–])\s*/u, "").trim())
    .map((line) => line.replace(/^([1-9])\s+/u, "").trim())
    .filter((line) => line.length > 0);
  return cleaned.length > 0 ? cleaned : ["未填写"];
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

function strokeRoundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
  lineWidth = 1,
): void {
  roundedPath(ctx, x, y, width, height, radius);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
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

function fitSingleLine(ctx: SKRSContext2D, text: string, maxWidth: number, startSize: number, minSize: number): number {
  for (let size = startSize; size >= minSize; size -= 1) {
    setFont(ctx, true, size);
    if (textWidth(ctx, text) <= maxWidth) return size;
  }
  return minSize;
}

function drawDocumentIcon(ctx: SKRSContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.strokeStyle = COLORS.blue;
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

function drawUserIcon(ctx: SKRSContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.strokeStyle = COLORS.blue;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy - 5, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy + 11, 10, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.restore();
}

function drawGroupIcon(ctx: SKRSContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.strokeStyle = COLORS.blue;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx - 5, cy - 5, 4.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 7, cy - 7, 3.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx - 6, cy + 10, 9, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 8, cy + 9, 7.5, Math.PI * 1.2, Math.PI * 1.95);
  ctx.stroke();
  ctx.restore();
}

interface HeaderLayout {
  height: number;
  projectLines: string[];
  projectSize: number;
  projectLineHeight: number;
}

function layoutHeader(ctx: SKRSContext2D, data: DailyReportPosterData): HeaderLayout {
  let projectSize = 37;
  let projectLines: string[] = [];
  for (; projectSize >= 25; projectSize -= 2) {
    setFont(ctx, true, projectSize);
    projectLines = wrapText(ctx, data.projectName, 450);
    if (projectLines.length <= 2 || projectSize === 25) break;
  }
  const projectLineHeight = Math.round(projectSize * 1.08);
  const overflowLines = Math.max(0, projectLines.length - 2);
  return {
    height: HERO_HEIGHT + overflowLines * (projectLineHeight + 4),
    projectLines,
    projectSize,
    projectLineHeight,
  };
}

function drawHero(ctx: SKRSContext2D, data: DailyReportPosterData, header: HeaderLayout, robot: CanvasImage | undefined, brandLogo: CanvasImage | undefined): void {
  const x = POSTER_X;
  const y = POSTER_Y;
  const width = WIDTH - POSTER_X * 2;
  ctx.save();
  roundedPath(ctx, x, y, width, header.height, POSTER_RADIUS);
  ctx.clip();

  const gradient = ctx.createLinearGradient(x, y, x + width, y + header.height);
  gradient.addColorStop(0, "#fbfdff");
  gradient.addColorStop(0.56, "#edf4ff");
  gradient.addColorStop(1, "#dfeaff");
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, header.height);

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.62)";
  ctx.lineWidth = 70;
  ctx.beginPath();
  ctx.arc(x + width + 305, y - 330, 430, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(78,123,212,0.18)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(x + 845, y + 305, 285, 210, -0.04, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + 845, y + 305, 360, 285, -0.04, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(x + 782, y + 186);
  ctx.rotate(-0.12);
  ctx.strokeStyle = "rgba(255,196,0,0.62)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 250, 82, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(36,70,126,0.08)";
  ctx.beginPath();
  ctx.ellipse(x + 805, y + 280, 225, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (robot !== undefined) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.drawImage(robot, x + 537, y + 38, 536, 238);
    ctx.restore();
  }

  if (brandLogo !== undefined) {
    const logoWidth = 166;
    const logoHeight = logoWidth * (55 / 156);
    ctx.drawImage(brandLogo, x + 58, y + 17, logoWidth, logoHeight);
  }

  ctx.fillStyle = COLORS.yellow;
  ctx.beginPath();
  ctx.moveTo(x + 60, y + 84);
  ctx.lineTo(x + 69, y + 84);
  ctx.lineTo(x + 59, y + 158);
  ctx.lineTo(x + 50, y + 158);
  ctx.closePath();
  ctx.fill();

  setFont(ctx, true, 72);
  ctx.fillStyle = COLORS.titleInk;
  ctx.fillText("现场日报", x + 86, y + 145);
  setFont(ctx, false, 11);
  drawSpaced(ctx, "DAILY FIELD REPORT", x + 87, y + 171, 5.4, "#66788f", "left");

  setFont(ctx, false, 10);
  drawSpaced(ctx, "PROJECT / 项目", x + 58, y + 229, 2, "#5f7189", "left");
  setFont(ctx, true, header.projectSize);
  ctx.fillStyle = COLORS.titleInk;
  header.projectLines.forEach((line, index) => {
    setFont(ctx, true, header.projectSize);
    ctx.fillStyle = COLORS.titleInk;
    ctx.fillText(line, x + 58, y + 273 + index * header.projectLineHeight);
  });

  ctx.textAlign = "right";
  setFont(ctx, false, 10);
  drawSpaced(ctx, "REPORT DATE / 日报日期", x + width - 58, y + 61, 1.8, "#50637b", "right");
  setFont(ctx, true, 40);
  ctx.fillStyle = "#07162d";
  ctx.fillText(data.reportDate.replaceAll("-", "."), x + width - 58, y + 104);
  const week = weekdayLabel(data.reportDate);
  if (week !== "") {
    setFont(ctx, true, 11);
    const pillRight = x + width - 58;
    const pillWidth = textWidth(ctx, week) + 28;
    fillRoundRect(ctx, pillRight - pillWidth, y + 119, pillWidth, 30, 15, "rgba(255,255,255,0.82)");
    ctx.fillStyle = "#3d4e68";
    ctx.textAlign = "center";
    ctx.fillText(week, pillRight - pillWidth / 2, y + 138);
    ctx.textAlign = "right";
  }
  ctx.textAlign = "left";

  ctx.restore();
}

interface FactCard {
  label: string;
  value: string;
  unit?: string;
  icon: "document" | "user" | "group";
}

function drawFacts(ctx: SKRSContext2D, data: DailyReportPosterData, y: number): void {
  const gap = 20;
  const cards: FactCard[] = [
    { label: "项目编号", value: data.projectCode, icon: "document" },
    { label: "项目经理", value: data.managers.length > 0 ? data.managers.join(" / ") : "未设置", icon: "user" },
    {
      label: "现场人数",
      value: data.headcount === null ? "" : String(data.headcount),
      unit: data.headcount === null ? undefined : "人",
      icon: "group",
    },
  ];
  const cardWidth = (CONTENT_WIDTH - gap * (cards.length - 1)) / cards.length;
  cards.forEach((card, index) => {
    const x = CONTENT_X + index * (cardWidth + gap);
    roundedPath(ctx, x, y, cardWidth, FACT_HEIGHT, 18);
    ctx.fillStyle = COLORS.white;
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    const iconX = x + 22;
    const iconY = y + 21;
    fillRoundRect(ctx, iconX, iconY, 54, 54, 27, COLORS.blueSoft);
    const cx = iconX + 27;
    const cy = iconY + 27;
    if (card.icon === "document") drawDocumentIcon(ctx, cx, cy);
    if (card.icon === "user") drawUserIcon(ctx, cx, cy);
    if (card.icon === "group") drawGroupIcon(ctx, cx, cy);

    setFont(ctx, false, 18);
    ctx.fillStyle = "#334155";
    ctx.fillText(card.label, x + 94, y + 37);

    if (card.value !== "") {
      const maxValueWidth = cardWidth - 116;
      const valueSize = fitSingleLine(ctx, card.value, maxValueWidth - (card.unit === undefined ? 0 : 42), 30, 22);
      setFont(ctx, true, valueSize);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(card.value, x + 94, y + 75);
      if (card.unit !== undefined) {
        const width = textWidth(ctx, card.value);
        setFont(ctx, true, 18);
        ctx.fillText(card.unit, x + 94 + width + 5, y + 75);
      }
    }
  });
}

function drawStage(ctx: SKRSContext2D, data: DailyReportPosterData, y: number): void {
  const label = "关联阶段：";
  setFont(ctx, true, 18);
  ctx.fillStyle = "#334155";
  ctx.fillText(label, CONTENT_X, y + 24);
  const labelWidth = textWidth(ctx, label);
  let chipX = CONTENT_X + labelWidth + 9;
  const stages = data.stages.length > 0 ? data.stages : ["未关联"];
  for (const stage of stages) {
    setFont(ctx, true, 16);
    const width = textWidth(ctx, stage) + 28;
    if (chipX + width > CONTENT_X + CONTENT_WIDTH) break;
    fillRoundRect(ctx, chipX, y, width, 32, 8, COLORS.ink);
    ctx.fillStyle = COLORS.white;
    ctx.fillText(stage, chipX + 14, y + 23);
    chipX += width + 8;
  }
}

interface TaskRowLayout {
  lines: string[];
  height: number;
}

interface TaskPanelLayout {
  rows: TaskRowLayout[];
  height: number;
}

function layoutTaskPanel(ctx: SKRSContext2D, items: readonly string[]): TaskPanelLayout {
  const textMax = TASK_PANEL_WIDTH - 32 - 24 - 26 - 10;
  const rows = items.map((item) => {
    setFont(ctx, true, 16);
    const lines = wrapText(ctx, item, textMax);
    return { lines, height: Math.max(45, 20 + lines.length * 24) };
  });
  const rowsHeight = rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * 8;
  return { rows, height: Math.max(238, 15 + 42 + 9 + rowsHeight + 14) };
}

function drawTaskPanel(
  ctx: SKRSContext2D,
  panelX: number,
  panelY: number,
  panelHeight: number,
  panelNo: string,
  title: string,
  layout: TaskPanelLayout,
): void {
  roundedPath(ctx, panelX, panelY, TASK_PANEL_WIDTH, panelHeight, PANEL_RADIUS);
  ctx.fillStyle = COLORS.white;
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  const contentX = panelX + 16;
  const headerY = panelY + 15;
  fillRoundRect(ctx, contentX, headerY, 38, 38, 8, COLORS.ink);
  setFont(ctx, true, 18);
  ctx.fillStyle = COLORS.white;
  ctx.textAlign = "center";
  ctx.fillText(panelNo, contentX + 19, headerY + 25);
  ctx.textAlign = "left";
  setFont(ctx, true, 27);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(title, contentX + 51, headerY + 29);

  let rowY = headerY + 42 + 9;
  const rowWidth = TASK_PANEL_WIDTH - 32;
  layout.rows.forEach((row, index) => {
    fillRoundRect(ctx, contentX, rowY, rowWidth, row.height, 10, COLORS.soft);
    const centerY = rowY + row.height / 2;
    ctx.beginPath();
    ctx.arc(contentX + 12 + 13, centerY, 13, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.white;
    ctx.fill();
    ctx.strokeStyle = COLORS.lineStrong;
    ctx.lineWidth = 1;
    ctx.stroke();
    setFont(ctx, true, 15);
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), contentX + 25, centerY + 0.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    setFont(ctx, true, 16);
    ctx.fillStyle = COLORS.bodyInk;
    const textX = contentX + 12 + 26 + 10;
    const textStart = centerY - ((row.lines.length - 1) * 24) / 2;
    row.lines.forEach((line, lineIndex) => {
      ctx.fillText(line, textX, textStart + lineIndex * 24);
    });
    ctx.textBaseline = "alphabetic";
    rowY += row.height + 8;
  });
}

function galleryHeight(count: number): number {
  if (count === 0) return 220;
  if (count === 1) return PHOTO_CAPTION_HEIGHT + 282;
  if (count === 2) return PHOTO_CAPTION_HEIGHT + 282;
  const rows = Math.ceil(count / 2);
  return rows * (PHOTO_CAPTION_HEIGHT + 280) + Math.max(0, rows - 1) * 16;
}
function photosPanelHeight(count: number): number {
  return 13 + 42 + 10 + galleryHeight(count) + 15;
}

function drawPhotoLabel(ctx: SKRSContext2D, x: number, y: number, label: string): void {
  setFont(ctx, true, 10);
  const width = textWidth(ctx, label) + 22;
  const height = 32;
  fillRoundRect(ctx, x + 12, y + (height === 32 ? 0 : 0), width, height, 6, COLORS.ink);
  ctx.fillStyle = COLORS.white;
  ctx.fillText(label, x + 23, y + 21);
}

function drawImageCover(ctx: SKRSContext2D, image: CanvasImage, x: number, y: number, width: number, height: number): void {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = Math.max(0, (image.width - sourceWidth) / 2);
  const sourceY = Math.max(0, (image.height - sourceHeight) / 2);
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawPhoto(
  ctx: SKRSContext2D,
  image: CanvasImage | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  if (image === undefined) {
    ctx.fillStyle = "#edf2f8";
    ctx.fillRect(x, y, width, height);
    setFont(ctx, false, 16);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "center";
    ctx.fillText("图片未能载入", x + width / 2, y + height / 2 + 5);
    ctx.textAlign = "left";
  } else {
    drawImageCover(ctx, image, x, y, width, height);
  }
  ctx.restore();

  ctx.strokeStyle = COLORS.lineStrong;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

  setFont(ctx, true, 10);
  drawSpaced(ctx, label, x + 1, y + height + 18, 1.4, COLORS.ink, "left");
}
function drawPhotosPanel(
  ctx: SKRSContext2D,
  photos: readonly DailyReportPosterPhoto[],
  images: ReadonlyMap<string, CanvasImage>,
  y: number,
): number {
  const height = photosPanelHeight(photos.length);
  roundedPath(ctx, CONTENT_X, y, CONTENT_WIDTH, height, PANEL_RADIUS);
  ctx.fillStyle = COLORS.white;
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  const innerX = CONTENT_X + PHOTO_PANEL_PADDING;
  const headerY = y + 13;
  fillRoundRect(ctx, innerX, headerY, 38, 38, 8, COLORS.ink);
  setFont(ctx, true, 18);
  ctx.fillStyle = COLORS.white;
  ctx.textAlign = "center";
  ctx.fillText("03", innerX + 19, headerY + 25);
  ctx.textAlign = "left";
  setFont(ctx, true, 27);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText("现场纪实", innerX + 51, headerY + 29);

  const galleryY = headerY + 42 + 10;
  if (photos.length === 0) {
    fillRoundRect(ctx, innerX, galleryY, PHOTO_INNER_WIDTH, 220, 0, "#edf2f8");
    setFont(ctx, true, 20);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText("今日未上传现场照片", innerX + 20, galleryY + 88);
    setFont(ctx, false, 14);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("日报文字内容已完整保留。", innerX + 20, galleryY + 120);
    return height;
  }

  if (photos.length === 1) {
    drawPhoto(ctx, images.get(photos[0]?.fileId ?? ""), innerX, galleryY, PHOTO_INNER_WIDTH, 282, "PHOTO 01");
    return height;
  }

  if (photos.length === 2) {
    drawPhoto(ctx, images.get(photos[0]?.fileId ?? ""), innerX, galleryY, PHOTO_WIDTH, 282, "PHOTO 01");
    drawPhoto(ctx, images.get(photos[1]?.fileId ?? ""), innerX + PHOTO_WIDTH + PHOTO_GAP, galleryY, PHOTO_WIDTH, 282, "PHOTO 02");
    return height;
  }

  let cursor = galleryY;
  for (let index = 0; index < photos.length; index += 2) {
    const second = photos[index + 1];
    drawPhoto(ctx, images.get(photos[index]?.fileId ?? ""), innerX, cursor, PHOTO_WIDTH, 280, "PHOTO " + String(index + 1).padStart(2, "0"));
    if (second !== undefined) {
      drawPhoto(ctx, images.get(second.fileId), innerX + PHOTO_WIDTH + PHOTO_GAP, cursor, PHOTO_WIDTH, 280, "PHOTO " + String(index + 2).padStart(2, "0"));
    }
    cursor += 280 + PHOTO_CAPTION_HEIGHT;
    if (index + 2 < photos.length) cursor += 16;
  }
  return height;
}

function drawFooter(ctx: SKRSContext2D, posterBottom: number): void {
  const y = posterBottom - 40;
  setFont(ctx, false, 9);
  ctx.strokeStyle = COLORS.yellow;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CONTENT_X, y - 4);
  ctx.lineTo(CONTENT_X + CONTENT_WIDTH - 70, y - 4);
  ctx.stroke();
  ctx.textAlign = "right";
  setFont(ctx, false, 9);
  ctx.fillStyle = "#60738b";
  ctx.fillText("01 / 01", CONTENT_X + CONTENT_WIDTH, y);
  ctx.textAlign = "left";
}

async function preparePhotoImages(
  canvasApi: NapiCanvas,
  photos: readonly DailyReportPosterPhoto[],
  buffers: ReadonlyMap<string, Buffer>,
): Promise<Map<string, CanvasImage>> {
  const decoded = new Map<string, CanvasImage>();
  await Promise.all(
    photos.map(async (photo) => {
      const buffer = buffers.get(photo.fileId);
      if (buffer === undefined) return;
      try {
        decoded.set(photo.fileId, await canvasApi.loadImage(buffer));
      } catch {
        // 坏图只影响当前片位。
      }
    }),
  );
  return decoded;
}

export async function renderDailyReportPosterV14(
  data: DailyReportPosterData,
  images: ReadonlyMap<string, Buffer> = new Map(),
  fonts?: DailyReportPosterFontPaths,
): Promise<Buffer> {
  const canvasApi = await loadCanvasApi();
  ensureFonts(canvasApi.GlobalFonts, fonts);

  const measure = canvasApi.createCanvas(WIDTH, 1).getContext("2d");
  const header = layoutHeader(measure, data);
  const doneItems = parseItems(data.doneWork);
  const planItems = parseItems(data.plan);
  const doneLayout = layoutTaskPanel(measure, doneItems);
  const planLayout = layoutTaskPanel(measure, planItems);
  const tasksHeight = Math.max(doneLayout.height, planLayout.height);
  const panelHeight = photosPanelHeight(data.photos.length);

  const posterHeight =
    header.height +
    24 +
    FACT_HEIGHT +
    16 +
    34 +
    18 +
    tasksHeight +
    16 +
    panelHeight +
    10 +
    18 +
    24;
  const finalHeight = POSTER_Y + posterHeight + STAGE_PAD;

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
  ctx.fillStyle = COLORS.paper;
  ctx.fill();

  let robot: CanvasImage | undefined;
  try {
    robot = await canvasApi.loadImage(readFileSync(posterAssetPath("daily-report-robot.png")));
  } catch {
    robot = undefined;
  }
  let brandLogo: CanvasImage | undefined;
  try {
    brandLogo = await canvasApi.loadImage(readFileSync(posterAssetPath("libiao-brand-logo.svg")));
  } catch {
    brandLogo = undefined;
  }
  drawHero(ctx, data, header, robot, brandLogo);

  let y = POSTER_Y + header.height + 24;
  drawFacts(ctx, data, y);
  y += FACT_HEIGHT + 16;
  drawStage(ctx, data, y);
  y += 34 + 18;

  drawTaskPanel(ctx, CONTENT_X, y, tasksHeight, "01", "今日完成", { ...doneLayout, height: tasksHeight });
  drawTaskPanel(ctx, CONTENT_X + TASK_PANEL_WIDTH + TASK_GAP, y, tasksHeight, "02", "明日计划", { ...planLayout, height: tasksHeight });
  y += tasksHeight + 16;

  const decoded = await preparePhotoImages(canvasApi, data.photos, images);
  y += drawPhotosPanel(ctx, data.photos, decoded, y) + 10;

  const posterBottom = POSTER_Y + posterHeight;
  drawFooter(ctx, posterBottom);
  return canvas.toBuffer("image/png");
}
