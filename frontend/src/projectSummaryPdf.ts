/**
 * AI 项目总结文档 → PDF（直接下载）。
 *
 * 只做前端截图封装：把当前总结文档节点克隆到视口外固定 A4 宽度画布，
 * 等字体 / 图片就绪后按 2 倍分辨率截图，再按 A4 纵向切片封装进 pdf-lib。
 * 不新增请求、不写库、不产生审计；与页面同一份 DOM，所见即所得。
 */
const PAGE_CSS_WIDTH = 794;
const PAGE_CSS_HEIGHT = 1123;
const RENDER_SCALE = 2;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned === "" ? "项目总结.pdf" : cleaned.endsWith(".pdf") ? cleaned : cleaned + ".pdf";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function inlineImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute("src") ?? "";
    if (src === "" || src.startsWith("data:") || src.startsWith("blob:")) return;
    try {
      const response = await fetch(src, { credentials: "include" });
      if (!response.ok) return;
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(blob);
      });
      image.src = dataUrl;
    } catch {
      // 取不到签名图时保留原 src，截图仍可继续。
    }
  }));
}

async function waitForImages(root: HTMLElement): Promise<void> {
  const pending = Array.from(root.querySelectorAll("img"))
    .filter((image) => !image.complete)
    .map((image) => new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    }));
  if (pending.length === 0) return;
  await Promise.race([Promise.all(pending).then(() => undefined), delay(5000)]);
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value === null) reject(new Error("canvas toBlob failed"));
      else resolve(value);
    }, "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportProjectSummaryPdf(root: HTMLElement, title: string): Promise<void> {
  await Promise.race([document.fonts.ready.catch(() => undefined), delay(5000)]);

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position: fixed; left: -20000px; top: 0; width: " + String(PAGE_CSS_WIDTH) + "px; " +
    "background: #ffffff; pointer-events: none; z-index: -1;";

  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "width: " + String(PAGE_CSS_WIDTH) + "px; padding: 32px 40px; background: #ffffff; " +
    "box-sizing: border-box; color: #18181b;";

  const clone = root.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-ai-summary-document");
  clone.style.width = String(PAGE_CSS_WIDTH - 80) + "px";
  wrapper.appendChild(clone);
  host.appendChild(wrapper);
  document.body.appendChild(host);

  try {
    await inlineImages(wrapper);
    await waitForImages(wrapper);

    const [{ default: html2canvas }, { PDFDocument }] = await Promise.all([
      import("html2canvas-pro"),
      import("pdf-lib"),
    ]);

    const canvas = await html2canvas(wrapper, {
      backgroundColor: "#ffffff",
      scale: RENDER_SCALE,
      useCORS: true,
      logging: false,
      width: PAGE_CSS_WIDTH,
      height: Math.ceil(wrapper.scrollHeight),
      windowWidth: PAGE_CSS_WIDTH,
      windowHeight: Math.max(PAGE_CSS_HEIGHT, Math.ceil(wrapper.scrollHeight)),
      scrollX: 0,
      scrollY: 0,
    });

    const pdf = await PDFDocument.create();
    pdf.setTitle(title);
    pdf.setSubject("LibiaoLink AI project summary");
    pdf.setCreator("LibiaoLink");
    pdf.setProducer("LibiaoLink");

    const pageCanvasHeight = Math.round(PAGE_CSS_HEIGHT * RENDER_SCALE);
    try {
      for (let offset = 0; offset < canvas.height; offset += pageCanvasHeight) {
        const sliceHeight = Math.min(pageCanvasHeight, canvas.height - offset);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = pageCanvasHeight;
        const context = pageCanvas.getContext("2d");
        if (context === null) throw new Error("canvas 2d context unavailable");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        context.drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
        try {
          const png = await canvasToPng(pageCanvas);
          const image = await pdf.embedPng(png);
          const page = pdf.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
          page.drawImage(image, { x: 0, y: 0, width: A4_WIDTH_PT, height: A4_HEIGHT_PT });
        } finally {
          pageCanvas.width = 0;
          pageCanvas.height = 0;
        }
      }
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }

    const bytes = await pdf.save({ useObjectStreams: true });
    downloadBlob(new Blob([toArrayBuffer(bytes)], { type: "application/pdf" }), safeFileName(title));
  } finally {
    host.remove();
  }
}
