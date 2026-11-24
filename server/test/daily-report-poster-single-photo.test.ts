/**
 * 单图回归：日报 / 问题专报只有一张图时，必须按原始比例完整展示，
 * 不能用 cover 裁掉上下或左右边缘。测试图四边画红色边框，渲染后检查红框完整出现。
 */
import { describe, expect, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  renderDailyReportIssuePoster,
  renderDailyReportPoster,
  type DailyReportPosterData,
} from "../src/modules/notify/daily-report.poster.js";

function framedPhoto(width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#dbe7f7";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ff1f1f";
  const edge = 18;
  ctx.fillRect(0, 0, width, edge);
  ctx.fillRect(0, height - edge, width, edge);
  ctx.fillRect(0, 0, edge, height);
  ctx.fillRect(width - edge, 0, edge, height);
  return canvas.toBuffer("image/png");
}

interface RedBounds {
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  maxRowCount: number;
}

async function redPixelBounds(buffer: Buffer): Promise<RedBounds> {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  const bounds: RedBounds = { count: 0, minX: image.width, minY: image.height, maxX: -1, maxY: -1, maxRowCount: 0 };
  for (let y = 0; y < image.height; y += 1) {
    let rowCount = 0;
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      if (r > 220 && g < 80 && b < 80) {
        bounds.count += 1;
        rowCount += 1;
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.maxY = Math.max(bounds.maxY, y);
      }
    }
    bounds.maxRowCount = Math.max(bounds.maxRowCount, rowCount);
  }
  return bounds;
}

const DATA: DailyReportPosterData = {
  projectId: "11111111-1111-4111-8111-111111111111",
  projectCode: "LBGN26052",
  projectName: "单图完整展示回归",
  managers: ["应石宏伟"],
  reportId: "22222222-2222-4222-8222-222222222222",
  reportDate: "2026-11-23",
  state: "submitted",
  authorName: "陈工",
  headcount: 2,
  doneWork: "1 强弱电安装\n2 等待物料到仓第8天",
  plan: "1 预计明天物料到仓卸货",
  stages: ["硬件实施"],
  submittedAt: "2026-11-23T10:42:00.000Z",
  photos: [{ fileId: "portrait", name: "p.png", objectKey: "p.png", mime: "image/png" }],
  issues: [],
};

describe("海报单图完整展示", () => {
  it("日报单张竖图保留完整上下边框", async () => {
    const images = new Map([["portrait", framedPhoto(900, 1200)]]);
    const bounds = await redPixelBounds(await renderDailyReportPoster(DATA, images));
    expect(bounds.count).toBeGreaterThan(1_000);
    expect(bounds.maxY - bounds.minY).toBeGreaterThan(520);
    expect(bounds.maxRowCount).toBeGreaterThan(300);
  }, 20_000);

  it("问题专报单张竖图保留完整上下边框", async () => {
    const images = new Map([["portrait", framedPhoto(900, 1200)]]);
    const data: DailyReportPosterData = {
      ...DATA,
      photos: [],
      issues: [
        {
          id: "issue-1",
          title: "现场问题单图回归",
          categories: ["施工质量"],
          ownerName: "应石宏伟",
          state: "in_progress",
          solution: "1 已安排复核\n2 调整后复测",
          photos: [{ fileId: "portrait", name: "p.png", objectKey: "p.png", mime: "image/png" }],
        },
      ],
    };
    const bounds = await redPixelBounds(await renderDailyReportIssuePoster(data, images));
    expect(bounds.count).toBeGreaterThan(500);
    expect(bounds.maxY - bounds.minY).toBeGreaterThan(280);
    expect(bounds.maxRowCount).toBeGreaterThan(160);
  }, 20_000);
});
