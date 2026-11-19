import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { ExportImage } from "./project-export.types.js";

type NapiCanvas = typeof import("@napi-rs/canvas");

const HEADER_HEIGHT_PX = 80;
export const EXPORT_FONT_NAME = "Microsoft YaHei";
const SYSTEM_FONT_FAMILIES = ["Microsoft YaHei", "微软雅黑"] as const;
const LOGO_FILE = "libiao-brand-logo.svg";
const FONT_REGULAR_FILE = "fonts/SourceHanSansSC-Regular.otf";
const FONT_BOLD_FILE = "fonts/SourceHanSansSC-Bold.otf";
const FONT_REGULAR = "LibiaoLink Export Sans";
const FONT_BOLD = "LibiaoLink Export Sans Bold";
const CACHE_LIMIT = 32;

let canvasApiPromise: Promise<NapiCanvas> | null = null;
let logoPromise: Promise<Awaited<ReturnType<NapiCanvas["loadImage"]>>> | null = null;
let fontsReady = false;
let fontRegularFamily = FONT_REGULAR;
let fontBoldFamily = FONT_BOLD;
const headerCache = new Map<string, ExportImage>();

function assetPath(fileName: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "assets", fileName),
    join(here, "..", "..", "..", "assets", fileName),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error("导出表头资产缺失：" + fileName);
  return found;
}

async function loadCanvasApi(): Promise<NapiCanvas> {
  canvasApiPromise ??= import("@napi-rs/canvas");
  return await canvasApiPromise;
}

function ensureFonts(canvasApi: NapiCanvas): void {
  if (fontsReady) return;
  const systemFamily = SYSTEM_FONT_FAMILIES.find((family) => canvasApi.GlobalFonts.has(family));
  if (systemFamily !== undefined) {
    fontRegularFamily = systemFamily;
    fontBoldFamily = systemFamily;
    fontsReady = true;
    return;
  }
  const regular = canvasApi.GlobalFonts.registerFromPath(assetPath(FONT_REGULAR_FILE), FONT_REGULAR);
  const bold = canvasApi.GlobalFonts.registerFromPath(assetPath(FONT_BOLD_FILE), FONT_BOLD);
  if (!regular || !bold) throw new Error("导出表头字体注册失败");
  fontsReady = true;
}

function setFont(ctx: SKRSContext2D, bold: boolean, size: number): void {
  const family = bold ? fontBoldFamily : fontRegularFamily;
  ctx.font = (bold ? "700 " : "400 ") + String(size) + 'px "' + family + '"';
}

function ellipsize(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 0) {
    chars.pop();
    const candidate = chars.join("") + "…";
    if (ctx.measureText(candidate).width <= maxWidth) return candidate;
  }
  return "…";
}

function fitTitle(
  ctx: SKRSContext2D,
  value: string,
  maxWidth: number,
  start: number,
  min: number,
): { text: string; size: number; width: number } {
  let size = start;
  while (size > min) {
    setFont(ctx, true, size);
    if (ctx.measureText(value).width <= maxWidth) break;
    size -= 1;
  }
  setFont(ctx, true, size);
  const text = ellipsize(ctx, value, maxWidth);
  return { text, size, width: ctx.measureText(text).width };
}

function headerKey(project: { code: string; name: string }, sheetLabel: string, widthPx: number): string {
  return project.code + "\u0000" + project.name + "\u0000" + sheetLabel + "\u0000" + String(widthPx);
}

function remember(key: string, image: ExportImage): ExportImage {
  headerCache.set(key, image);
  if (headerCache.size > CACHE_LIMIT) {
    const first = headerCache.keys().next().value;
    if (first !== undefined) headerCache.delete(first);
  }
  return image;
}

export function exportHeaderWidthPx(widths: readonly number[]): number {
  return widths.reduce((sum, width) => sum + Math.max(20, Math.round(width * 7 + 5)), 0);
}

export const EXPORT_HEADER_ROW_HEIGHT = 60;
export const EXPORT_HEADER_HEIGHT_PX = HEADER_HEIGHT_PX;

export async function renderProjectExportHeader(
  project: { code: string; name: string },
  sheetLabel: string,
  requestedWidthPx: number,
): Promise<ExportImage> {
  const widthPx = Math.max(240, Math.round(requestedWidthPx));
  const key = headerKey(project, sheetLabel, widthPx);
  const cached = headerCache.get(key);
  if (cached !== undefined) return cached;

  const canvasApi = await loadCanvasApi();
  ensureFonts(canvasApi);
  logoPromise ??= canvasApi.loadImage(assetPath(LOGO_FILE));
  const logo = await logoPromise;

  const scale = 2;
  const canvas = canvasApi.createCanvas(widthPx * scale, HEADER_HEIGHT_PX * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  const gradient = ctx.createLinearGradient(0, 0, 0, HEADER_HEIGHT_PX);
  gradient.addColorStop(0, "#FFFFFF");
  gradient.addColorStop(0.52, "#F6F6F6");
  gradient.addColorStop(1, "#DBDBDB");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, widthPx, HEADER_HEIGHT_PX);

  ctx.strokeStyle = "#D8DEE6";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, widthPx - 1, HEADER_HEIGHT_PX - 1);

  const compact = widthPx < 760;
  const veryCompact = widthPx < 520;
  const logoHeight = veryCompact ? 30 : compact ? 38 : 47;
  const logoWidth = logoHeight * 156 / 55;
  const logoX = veryCompact ? 12 : 22;
  const logoY = (HEADER_HEIGHT_PX - logoHeight) / 2;
  ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);

  ctx.textBaseline = "middle";
  ctx.fillStyle = "#111111";
  let leftLimit = logoX + logoWidth + (veryCompact ? 12 : 18);
  if (!compact) {
    setFont(ctx, true, 13.5);
    const confidential = "商业秘密文件 / Confidential";
    ctx.fillText(confidential, leftLimit, HEADER_HEIGHT_PX / 2 + 0.5);
    leftLimit += ctx.measureText(confidential).width + 26;
  }

  const rightLimit = widthPx - (veryCompact ? 12 : 22);
  const available = Math.max(24, rightLimit - leftLimit);
  const title = "[" + project.code + "]  " + project.name + "   ·   " + sheetLabel;
  const startSize = widthPx >= 1800 ? 22 : widthPx >= 1400 ? 20 : compact ? 16 : 18;
  const fitted = fitTitle(ctx, title, available, startSize, veryCompact ? 10 : 11);

  let titleX = widthPx / 2;
  if (fitted.width / 2 > widthPx / 2 - leftLimit || fitted.width / 2 > rightLimit - widthPx / 2) {
    titleX = leftLimit + available / 2;
  }
  if (compact) titleX = leftLimit + available / 2;
  ctx.textAlign = "center";
  ctx.fillText(fitted.text, titleX, HEADER_HEIGHT_PX / 2 + 0.5);

  return remember(key, {
    bytes: canvas.toBuffer("image/png"),
    extension: "png",
  });
}
