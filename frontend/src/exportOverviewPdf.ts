/**
 * 项目总览导出（PDF）——业务口径 2026-10-09：「按钮 用于导出项目总览的数据 导出要美观给客户看的 间距也要合适 先考虑 pdf 格式吧」。
 *
 * 口径（详见 `前端功能需求.md` §6.16）：
 * - 导出内容 = 当前项目的项目总览：项目信息 + 汇总统计 + 阶段进度 + 任务明细（分组 / 行序同「项目总览」任务表）；
 * - 数据准备（阶段分组 / 计数 / 文本与进度口径）收敛在 `overviewExportShared.ts`；
 * - 产物 = PDF：报告 HTML 先经现有预览分页器拆成 A4 横版页，再由 html2canvas-pro 逐页栅格化、pdf-lib 封装，
 *   生成后由浏览器直接下载（不再唤起系统打印窗口）；分页、版式和语言口径与面板左侧预览同源；
 *   中文字体优先引用本机 Microsoft YaHei UI / Microsoft YaHei，未安装时回退自托管 Noto Sans SC Variable；页面按 2 倍分辨率输出；
 *   日期单元格沿用自托管 Noto Sans SC 数字字形并关闭等宽数字，避免 ISO 连字符在雅黑下显得松散；
 * - 配色与状态口径和页面同源：五个状态色签取 `components/TaskBoard.tsx` 的 STATUS_TAG_CLASS 同色（100 档底 +
 *   700 / 800 档字）；整体进度算法同同文件的 ProjectSummary（已完成 / 总数，四舍五入）；
 * - 数据只用调用方已取到的页面数据（project / tasks / summary），导出不额外发请求、不写库、不产生审计。
 * - 2026-10-10 追订（业务口径「暂时先不做页面双语吧 先导出pdf双语 图一 pdf导出 不需要框起来的三行 然后增加预计施工人数」）：
 *   ① 明细表撤「按时交付 / 输出成果文件 / 实际完成」三列、补「预计所需施工人数」（同页面 headcount 口径）；
 *   ② 报告固定文案 / 表头 / 状态签 / 阶段名 / 进度档位补英文小字（中英双语）—— 任务英文名用自带 titleEn，人名 / 编号 / 日期 / 进展描述等数据不翻译。
 *   ③ 抬头改版（业务口径「只保留项目经理 然后最上方导出logo用我这个svg 项目总览报告改成项目进度报告 顶格只保留logo 下方再显示标题」）：
 *      报告名改「项目进度报告 Project Progress Report」；顶部 logo 独占一行（36px 高，改用业务提供的 `public/libiao-logo.svg`，不动站内 logo），
 *      标题与生成时间下移到 logo 下方一行（标题居左、生成时间居右）；项目信息标签只保留「项目经理」（撤状态 / 当前阶段 / 创建时间 / 最近更新四枚）。
 *   ④ 抬头去生成时间（业务 2026-10-10 追加：「生成时间 Generated at …这个也不需要」）：头部右侧撤掉生成时间，logo 下方仅保留标题（左对齐）；生成时间只留在页脚自动生成说明一句里。
 *   ⑤ 抬头只留 logo（业务 2026-10-10 再追加：「这个也不需要了 顶部只保留logo」）：撤抬头标题行（.head__meta / .head__title 及其英文小字规则整条删除），头部只剩 logo；浏览器 <title> 仍为「项目进度报告 Project Progress Report」（另存 PDF 的窗口标题 / 文件名可读）。
 *   ⑥ 项目名后缀（业务 2026-10-10 追加：「后面中心点 加进度报告四个字」）：hero 里的项目名后拼「 · 进度报告」——只加中文四个字，不配英文小字（数据值本不翻译）。
 *   ⑦ hero 左右对调（业务 2026-10-10 追加「左右顺序换一下」）：整体进度块（大号百分比 / 进度条 / 最慢·最新阶段）换到左、项目信息块（编号 / 名称 / 标签）换到右；文本对齐镜像（进度块左对齐、信息块右对齐 + 标签行末端对齐）。
 *   ⑧ 进度列放宽不折行（业务 2026-10-10 追加「右侧空间很大英文不必换行」）：hero 进度列 170 / 190px → 240px —— 实测现有数据两行自然宽 214px、九阶段名最坏（硬件实施 Hardware Implementation / 加工采购 Processing & Procurement）231px，240px 内单行放得下。
 *   ⑨ 标题置顶（业务 2026-10-10 追加「中文标题放在最上方」）：hero 信息块内「项目名 · 进度报告」大标题提到最上，项目编号行下移到标题之下（名称 margin 0、编号行补 2px 上距）。
 *   ⑩ 明细不截断（业务 2026-10-10 追加「这种英文不应该省略 表格宽度可以加宽 不强制在一页展示」）：描述列副行（英文名 + 进展）撤字符截断（原 40 / 56 字）与单行 ellipsis、改自然换行；描述列 29% → 31%（经理 / 负责人列各让 1%）；不再一页优先，页数随内容。
 *   ⑪ 英文小字不重复阿拉伯数字（业务 2026-10-10 追加「然后导出的阿拉伯数字是不需要翻译的」）：分组头英文收成 completed、任务明细 note 英文去掉条数、整体进度英文去掉（已完成 X / Y）、页脚英文去掉生成时间、超量截断提示英文去掉条数 —— 数字属数据、语言无关，只保留在中文主文案一处。
 *   ⑫ 进展描述单列（业务 2026-10-10 追加「项目进展描述单例一列吧 然后需要翻译」）：任务名称副行只留英文名；「任务描述 Task Description」独立成列（第 3 列），列数 9 → 10、列宽重排（2026-11-19 平衡为 3 / 18 / 15.5 / 8 / 8.5 / 8 / 8 / 7.5 / 12 / 11.5 %）、分组头 colspan 同步；列内中文原文 + 英文小字译文（⑬ 追订接线）。
 *   ⑬ 进展描述译文接线（业务 2026-10-10「现在导出没有接入翻译」）：导出前把该列去重非空文本经 translateApi.ts
 *      （POST /api/v1/translate，契约对齐翻译服务 /translate）翻成英文、补在中文原文下方小字；通道不通静默降级为只出中文
 *      （导出照常、不报错）；开发环境代理见 vite.config.ts（TRANSLATE_ORIGIN），生产由后端按同契约实现 —— 见 §6.16 ⑯。
 *      **2026-10-13 追订（§6.16 ㉑）：译文改为「写进展描述时后台预热」（translateApi.ts 会话缓存 + prefetchZhToEn），
 *      导出命中缓存即取、仅未预热条目现场翻（通道不通仍静默降级只出中文）。**
 *   ⑭ 抬头英译 + 页脚删除（业务 2026-10-10「图一也要翻译 最后的结尾也不需要」）：hero 项目名下方补英译小字
 *      （项目名经翻译通道 + 固定后缀 · Progress Report；通道不通则不出英文行）；整条页脚（品牌行 + 自动生成落款）删除 ——
 *      正文之后不再有落款行。
 *   ⑮ 序号列表头去「#」（业务 2026-10-10「这个#号删除」）：表头首格留空，行号照常出（1…N）。
 *   ⑯ 阶段进度说明去前缀（业务 2026-10-10「按项目总览的九个这个前半段字删除」）：说明句改为「施工阶段统计完成情况」（英文小字不动）。
 *   2026-10-23 追订（业务口径「这边导入加入 日文和韩文 也要翻译」）：主体语言扩为 zh / en / ja / ko；
 *   固定文案走四语词典，日 / 韩主体的项目名、任务名、进展描述按 target=ja|ko 走翻译通道，中文降为小字；
 *   报告内联 Noto Sans JP / KR，中文小字仍用 Noto Sans SC。
 *   2026-11-19 跨尺寸排版锁定（业务反馈「不同尺寸电脑打开预览效果不一样 / 下载也不一样」）：
 *   预览与 PDF 复用同一份最终预览 HTML；报告画布固定 1122 × 793.7008 CSS px，预览与离屏导出 iframe 固定 1190 × 880，
 *   html2canvas-pro 固定按 1122 px 窗口和报告页尺寸截图，均不再读取宿主窗口 / iframe 当前宽度；表头主次文案各占一行并禁止换行。
 *   2026-11-19 导出视觉与预览对齐（业务反馈「效果还是不行 和预览有差距」）：
 *   PDF 捕获改走 html2canvas-pro 的 foreignObjectRendering，由浏览器按预览同一套布局做原生排版后再栅格化，消除 Canvas 字体度量造成的基线偏差；
 *   捕获前把报告 logo 转成 data URI、把章节标题 / 右侧说明锁成单行并留 3px 右侧余量，既避免克隆中裂图 / 换行，也不改变预览本身的排版；
 *   PDF 页面尺寸改为报告画布按 96dpi 换算的 841.5 × 595.2756pt，页面图片不再做非整数缩放；中文正文优先引用本机 Microsoft YaHei UI / Microsoft YaHei（仅字体栈引用，不打包字体文件），未安装时回退自托管 Noto Sans SC。
 */
import notoSansJpCss from "@fontsource-variable/noto-sans-jp/index.css?inline";
import notoSansKrCss from "@fontsource-variable/noto-sans-kr/index.css?inline";
import notoSansScCss from "@fontsource-variable/noto-sans-sc/index.css?inline";
import { TEMP_TASK_STAGE, daysBetweenInclusive, type ProjectTask, type TaskStatus } from "./data/tasks";
import { additionalStageName, projectTaskStageNames, stageKeyOfName, stageNameOf } from "./taskApi";
import { translateZhTo, type TranslationTarget } from "./translateApi";
import overviewPreviewPagedCss from "./overviewPreviewPaged.css?inline";
import overviewPreviewPagedScriptUrl from "./overviewPreviewPaged.js?url";
import { projectManagerText } from "./types";
import {
  countsOf,
  dateText,
  groupedByStage,
  isDoneStatus,
  ownersText,
  progressLabel,
  progressPct,
  DEFAULT_OVERVIEW_EXPORT_OPTIONS,
  DEFAULT_OVERVIEW_TASK_COLUMNS,
  resolvedOverviewExportName,
  visibleOverviewTaskColumns,
  type OverviewExportInput,
  type OverviewExportLanguage,
  type OverviewExportOptions,
  type OverviewTaskColumnKey,
  type OverviewTaskColumns,
  type StageGroup,
} from "./overviewExportShared";

export type { OverviewExportInput, OverviewExportLanguage, OverviewExportOptions, OverviewExportStageOption } from "./overviewExportShared";

/** 无译文时的缺省映射（静默降级：导出保持中文原文；容错口径见 translateApi.ts）。 */
const EMPTY_TRANSLATIONS: ReadonlyMap<string, string> = new Map();

/** 五个状态色（与页面色签同源；text = 状态圆点与主文案，bar = 明细行进度条）。 */
type StatusTint = { text: string; bar: string };

const STATUS_TINT: Record<TaskStatus, StatusTint> = {
  已完成: { text: "#047857", bar: "#10b981" },
  提前完成: { text: "#a21caf", bar: "#d946ef" },
  进行中: { text: "#b45309", bar: "#f59e0b" },
  待开始: { text: "#0369a1", bar: "#0ea5e9" },
  已延期: { text: "#be123c", bar: "#f43f5e" },
};

/** PDF 生成用离屏 iframe 的 id（再点一次导出先撤掉上一枚，避免多份报告叠着生成）。 */
const PDF_FRAME_ID = "overview-export-pdf-frame";
/** A4 横版报告画布（CSS px；与 overviewPreviewPaged.css 的 .preview-page 常量保持同步）。 */
export const OVERVIEW_REPORT_PAGE_WIDTH = 1122;
export const OVERVIEW_REPORT_PAGE_HEIGHT = 793.7008;
/** 预览 iframe 固定视口；PDF 离屏 iframe 复用同一尺寸，避免宿主窗口参与报告排版。 */
export const OVERVIEW_PREVIEW_FRAME_WIDTH = 1190;
export const OVERVIEW_PREVIEW_FRAME_HEIGHT = 880;
/** 渲染分辨率：A4 横版内容区 1122 × 793.7 CSS px，2 倍输出约 192 dpi。 */
const PDF_RENDER_SCALE = 2;
/** PDF 页面点尺寸：报告画布按 96dpi 换算，保证 1122 CSS px ↔ 841.5pt、793.7008 CSS px ↔ 595.2756pt 严格 1:1。 */
const PDF_PAGE_WIDTH_PT = (OVERVIEW_REPORT_PAGE_WIDTH * 72) / 96;
const PDF_PAGE_HEIGHT_PT = (OVERVIEW_REPORT_PAGE_HEIGHT * 72) / 96;
/** 等预览分页 / 字体 / logo 就绪的上限；超时直接失败，避免一直卡着导出浮层。 */
const PDF_READY_TIMEOUT_MS = 15_000;
/** 仅供 PDF 截图时使用的页面样式：去掉预览背景、阴影和页码，页面本身保留原有页边距。 */
const PDF_CAPTURE_STYLE = `
  html, body {
    width: ${OVERVIEW_REPORT_PAGE_WIDTH}px !important;
    min-width: ${OVERVIEW_REPORT_PAGE_WIDTH}px !important;
    max-width: ${OVERVIEW_REPORT_PAGE_WIDTH}px !important;
    background: #ffffff !important;
    -webkit-text-size-adjust: 100% !important;
    text-size-adjust: 100% !important;
  }
  body.preview-document {
    width: ${OVERVIEW_REPORT_PAGE_WIDTH}px !important;
    min-width: ${OVERVIEW_REPORT_PAGE_WIDTH}px !important;
    padding: 0 !important;
    visibility: visible !important;
  }
  .preview-pages {
    width: ${OVERVIEW_REPORT_PAGE_WIDTH}px !important;
    min-width: ${OVERVIEW_REPORT_PAGE_WIDTH}px !important;
    gap: 0 !important;
  }
  .preview-page { flex: none !important; box-shadow: none !important; }
  .preview-page__number { display: none !important; }
  .section__title { flex-wrap: nowrap !important; white-space: nowrap !important; }
  .section__title > * { flex-shrink: 0 !important; }
  .section__note { flex: 0 0 auto !important; margin-right: 3px !important; white-space: nowrap !important; }
`;

/**
 * 四语报告词典（2026-10-23 追订）：中文 / 英文 / 日文 / 韩文主体共用一套固定文案口径。
 * 报告的数据值仍不在这里翻译 —— 项目名 / 任务名 / 进展描述走 translateApi.ts。
 */
type LanguageStrings = { en: string; ja: string; ko: string };

const STAGE_TEXT: Record<string, LanguageStrings> = {
  售前规划: { en: "Presales Planning", ja: "プリセールス計画", ko: "프리세일즈 기획" },
  设计开发: { en: "Design & Development", ja: "設計・開発", ko: "설계 및 개발" },
  加工采购: { en: "Processing & Procurement", ja: "加工・調達", ko: "가공 및 조달" },
  组装发货: { en: "Assembly & Shipping", ja: "組立・出荷", ko: "조립 및 출하" },
  硬件实施: { en: "Hardware Implementation", ja: "ハードウェア実装", ko: "하드웨어 구축" },
  软件部署: { en: "Software Deployment", ja: "ソフトウェア配備", ko: "소프트웨어 배포" },
  试运行: { en: "Trial Run", ja: "試運転", ko: "시운전" },
  投产阶段: { en: "Production", ja: "生産段階", ko: "생산 단계" },
  验收: { en: "Acceptance", ja: "検収", ko: "검수" },
  临时任务: { en: "Temporary Tasks", ja: "臨時タスク", ko: "임시 작업" },
  项目总览: { en: "Project Overview", ja: "プロジェクト概要", ko: "프로젝트 개요" },
};

const STATUS_TEXT: Record<TaskStatus, LanguageStrings> = {
  已完成: { en: "Completed", ja: "完了", ko: "완료" },
  提前完成: { en: "Ahead of Schedule", ja: "予定前完了", ko: "조기 완료" },
  进行中: { en: "In Progress", ja: "進行中", ko: "진행 중" },
  待开始: { en: "Not Started", ja: "未着手", ko: "시작 전" },
  已延期: { en: "Overdue", ja: "遅延", ko: "지연" },
};

const PROGRESS_TEXT: Record<string, LanguageStrings> = {
  未开始: { en: "Not Started", ja: "未着手", ko: "미시작" },
  刚开工: { en: "Just Started", ja: "着工直後", ko: "착수 직후" },
  完成一半: { en: "Halfway", ja: "半ば完了", ko: "절반 완료" },
  快完成了: { en: "Nearly Done", ja: "まもなく完了", ko: "거의 완료" },
  已完成: { en: "Completed", ja: "完了", ko: "완료" },
};

const FIXED_TEXT: Record<string, LanguageStrings> = {
  ...STAGE_TEXT,
  ...STATUS_TEXT,
  ...PROGRESS_TEXT,
  整体进度: { en: "Overall Progress", ja: "全体進捗", ko: "전체 진행률" },
  任务总数: { en: "Total Tasks", ja: "タスク総数", ko: "전체 작업" },
  完成: { en: "completed", ja: "完了", ko: "완료" },
  全部完成: { en: "All Completed", ja: "すべて完了", ko: "모두 완료" },
  暂无任务: { en: "No tasks", ja: "タスクなし", ko: "작업 없음" },
  天: { en: "days", ja: "日", ko: "일" },
  峰值: { en: "Peak", ja: "ピーク", ko: "최대" },
  平均: { en: "Avg", ja: "平均", ko: "평균" },
  "人/天": { en: "people/day", ja: "人/日", ko: "명/일" },
  待分配: { en: "Unassigned", ja: "未割当", ko: "미배정" },
  项目编号: { en: "Project Code", ja: "プロジェクト番号", ko: "프로젝트 번호" },
  项目经理: { en: "Project Manager", ja: "プロジェクト責任者", ko: "프로젝트 관리자" },
  阶段进度: { en: "Stage Progress", ja: "ステージ進捗", ko: "단계 진행률" },
  施工阶段统计完成情况: { en: "Completion by construction stage", ja: "施工段階ごとの完了状況", ko: "시공 단계별 완료 현황" },
  任务明细: { en: "Task Details", ja: "タスク詳細", ko: "작업 상세" },
  任务名称: { en: "Task Name", ja: "タスク名", ko: "작업 이름" },
  任务描述: { en: "Task Description", ja: "タスク説明", ko: "작업 설명" },
  任务负责人: { en: "Task Owners", ja: "タスク担当者", ko: "작업 담당자" },
  任务状态: { en: "Status", ja: "ステータス", ko: "상태" },
  开始日期: { en: "Start Date", ja: "開始日", ko: "시작일" },
  预计完成: { en: "Planned End", ja: "完了予定", ko: "완료 예정" },
  预计所需施工人数: { en: "Est. Headcount", ja: "必要作業人数（概算）", ko: "예상 투입 인원" },
  进度: { en: "Progress", ja: "進捗", ko: "진행률" },
  最新阶段: { en: "Latest Stage", ja: "最新ステージ", ko: "최신 단계" },
  项目进度报告: { en: "Project Progress Report", ja: "プロジェクト進捗報告", ko: "프로젝트 진행 보고서" },
  进度报告: { en: "Progress Report", ja: "進捗報告", ko: "진행 보고서" },
};

/** HTML 文本转义（任务名 / 负责人 / 项目名都是用户输入，一律转义后再拼进报告）。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\u0027/g, "&#39;");
}

function languageAttr(language: OverviewExportLanguage): string {
  return language === "zh" ? "zh-CN" : language;
}

/** 次要语言小字：中文主体放英文，其他主体放中文。 */
function secondaryText(value: string, language: OverviewExportLanguage): string {
  return `<span class="secondary" lang="${languageAttr(language)}">${escapeHtml(value)}</span>`;
}

/** 固定文案的目标语言值；缺词典时回退英文，再回退中文。 */
function localizedValue(zh: string, primary: OverviewExportLanguage): string {
  if (primary === "zh") {
    return zh;
  }
  const match = /^(.*?)([1-9][0-9]*)$/.exec(zh);
  if (match !== null && STAGE_TEXT[match[1]] !== undefined) {
    return STAGE_TEXT[match[1]][primary] + " " + match[2];
  }
  const strings = FIXED_TEXT[zh];
  if (strings === undefined) {
    return zh;
  }
  return strings[primary] || strings.en || zh;
}

/** 固定文案：主体语言为主文案，非中文主体的中文原文作小字；中文主体保留英文小字。 */
function fixedText(zh: string, primary: OverviewExportLanguage): string {
  const main = localizedValue(zh, primary);
  if (primary === "zh") {
    const english = localizedValue(zh, "en");
    return escapeHtml(main) + (english === zh ? "" : " " + secondaryText(english, "en"));
  }
  return escapeHtml(main) + (main === zh ? "" : " " + secondaryText(zh, "zh"));
}

/** 任务表头主 / 次文案各占一行；显式块级 + nowrap，避免系统字体缩放把列头重新挤成多行。 */
function tableHeadText(zh: string, primary: OverviewExportLanguage): string {
  const main = localizedValue(zh, primary);
  const secondary = primary === "zh" ? FIXED_TEXT[zh]?.en ?? "" : main === zh ? "" : zh;
  const secondaryLang = primary === "zh" ? "en" : "zh";
  return `<span class="th-main">${escapeHtml(main)}</span>` +
    (secondary === "" ? "" : `<span class="secondary" lang="${languageAttr(secondaryLang)}">${escapeHtml(secondary)}</span>`);
}

/** 数据值译文：主体语言在前；非中文主体把中文原文降为小字，译文缺失时逐项回退中文。 */
function translatedText(zh: string, translated: string | undefined, primary: OverviewExportLanguage): string {
  if (primary === "zh") {
    return escapeHtml(zh) + (translated === undefined || translated === "" ? "" : " " + secondaryText(translated, "en"));
  }
  const main = translated === undefined || translated === "" ? zh : translated;
  return escapeHtml(main) + (main === zh ? "" : " " + secondaryText(zh, "zh"));
}

/** 英文 / 韩文用半角冒号；中文 / 日文保持全角冒号。 */
function labelColon(primary: OverviewExportLanguage): string {
  return primary === "zh" || primary === "ja" ? "：" : ": ";
}

/** 预计所需施工人数：页面同口径（未填 / ≤0 出「—」，否则「N 人」）。 */
function headcountText(task: ProjectTask, primary: OverviewExportLanguage): string {
  if (task.headcount <= 0) {
    return `<span class="dim">—</span>`;
  }
  if (primary === "zh") {
    return String(task.headcount) + " 人";
  }
  const unit = primary === "en" ? " people " : primary === "ja" ? " 名 " : "명 ";
  return String(task.headcount) + unit + secondaryText("人", "zh");
}

/** 百分比文本：总数 0 时出「—」，避免 0 / 0 的假百分比。 */
function percentText(part: number, whole: number): string {
  return whole === 0 ? "—" : String(Math.round((part / whole) * 100)) + "%";
}

/**
 * 横条进度条（报告里唯一一种进度呈现：阶段进度 / 明细行进度共用）。
 * 单元素渐变填充：html2canvas-pro 对 overflow / 嵌套空 span 的裁剪会让下载 PDF 丢掉彩色填充，故不再用子节点。
 */
function barHtml(pct: number, color: string, extraClass: string): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const width = String(clamped) + "%";
  return "<div class=\"bar " + extraClass + "\" style=\"background: linear-gradient(to right, " + color + " 0%, " + color + " " + width + ", #eceef1 " + width + ", #eceef1 100%)\"></div>";
}

/** 汇总统计条里的一格（色点 + 数值 + 四语标签（占比）横排）。 */
function statHtml(label: string, value: string, hint: string, dot: string, primary: OverviewExportLanguage): string {
  const hintHtml = hint === "" ? "" : primary === "ko" ? " (" + hint + ")" : "（" + hint + "）";
  return (
    `<span class="stat">` +
    `<span class="stat__dot" style="background: ${dot}"></span>` +
    `<span class="stat__value">${value}</span>` +
    fixedText(label, primary) +
    hintHtml +
    `</span>`
  );
}

/* 阶段进度格按 5 列网格排，空阶段显示「暂无任务」。 */
function stageCellHtml(group: StageGroup, primary: OverviewExportLanguage): string {
  const pct = group.total === 0 ? 0 : Math.round((group.done / group.total) * 100);
  const fill = group.total === 0 ? "#d4d4d8" : pct === 100 ? "#10b981" : "#18181b";
  const countText =
    group.total === 0 ? fixedText("暂无任务", primary) : String(group.done) + " / " + String(group.total) + " · " + String(pct) + "%";
  return (
    `<div class="stage">` +
    `<div class="stage__head"><span class="stage__name">${fixedText(group.name, primary)}</span>` +
    `<span class="stage__count">${countText}</span></div>` +
    barHtml(pct, fill, "bar--stage") +
    `</div>`
  );
}

/** 阶段总体状态（折叠阶段的分组汇总行实时统计）：有延期优先标记；全部完成 = 已完成；有进展 = 进行中；否则待开始。 */
function stageOverallStatus(group: StageGroup): TaskStatus | null {
  if (group.total === 0) {
    return null;
  }
  if (group.done === group.total) {
    return "已完成";
  }
  if (group.tasks.some((task) => task.status === "已延期")) {
    return "已延期";
  }
  if (group.tasks.some((task) => task.status === "进行中" || isDoneStatus(task.status))) {
    return "进行中";
  }
  return "待开始";
}

/** 任务明细一行：按面板选择输出列；日 / 韩主体额外翻译任务标题，中文 / 英文主体保持 title / titleEn 口径。 */
function taskRowHtml(
  index: number,
  task: ProjectTask,
  managerText: string,
  translationMap: ReadonlyMap<string, string>,
  primary: OverviewExportLanguage,
  columns: OverviewTaskColumns,
): string {
  const tint = STATUS_TINT[task.status];
  const hasTitleEn = task.titleEn !== "";
  let titleMain = task.title;
  let titleSecondary = "";
  let titleLang = "zh-CN";
  if (primary === "en") {
    titleMain = hasTitleEn ? task.titleEn : task.title;
    titleSecondary = hasTitleEn ? task.title : "";
    titleLang = hasTitleEn ? "en" : "zh-CN";
  } else if (primary === "ja" || primary === "ko") {
    const translated = translationMap.get(task.title) ?? "";
    if (translated !== "") {
      titleMain = translated;
      titleSecondary = task.title;
      titleLang = primary;
    } else if (hasTitleEn) {
      titleMain = task.titleEn;
      titleSecondary = task.title;
      titleLang = "en";
    }
  } else if (hasTitleEn) {
    titleSecondary = task.titleEn;
  }
  const secondaryLang = primary === "zh" ? "en" : "zh-CN";
  const subHtml = titleSecondary === "" ? "" : `<span class="task__sub" lang="${secondaryLang}">${escapeHtml(titleSecondary)}</span>`;
  const translatedNote = task.note === "" ? "" : (translationMap.get(task.note) ?? "");
  const noteHtml = task.note === "" ? `<span class="dim">—</span>` : translatedText(task.note, translatedNote, primary);
  const ownersTextValue = ownersText(task);
  const ownersHtml = task.owners.length === 0
    ? primary === "zh" ? "待分配" : fixedText("待分配", primary)
    : escapeHtml(ownersTextValue);
  const progressZh = progressLabel(task.progress);
  const cells: Record<OverviewTaskColumnKey, string> = {
    title: `<td class="task"><span class="task__title" lang="${titleLang}">${escapeHtml(titleMain)}</span>${subHtml}</td>`,
    note: `<td class="pnote">${noteHtml}</td>`,
    managers: `<td class="managers"><span class="one-line">${escapeHtml(managerText)}</span></td>`,
    owners: `<td class="owners"><span class="one-line">${ownersHtml}</span></td>`,
    status: `<td><span class="chip" style="color: ${tint.text}">${fixedText(task.status, primary)}</span></td>`,
    startDate: `<td class="num date">${dateText(task.startDate)}</td>`,
    dueDate: `<td class="num date">${dateText(task.dueDate)}</td>`,
    headcount: `<td class="num">${headcountText(task, primary)}</td>`,
    progress: `<td class="progress">${barHtml(progressPct(task.progress), tint.bar, "bar--row")}<span class="progress__label">${fixedText(progressZh, primary)}</span></td>`,
  };
  return `<tr><td class="num">${String(index)}</td>${visibleOverviewTaskColumns(columns).map((column) => cells[column.key]).join("")}</tr>`;
}

/** 折叠阶段日期范围：忽略空值，取组内最早开始日期与最晚预计完成日期（契约日期为 ISO，可直接做字符串比较）。 */
function groupDateRange(group: StageGroup): { start: string; due: string } {
  let start = "";
  let due = "";
  for (const task of group.tasks) {
    if (task.startDate !== "" && (start === "" || task.startDate < start)) {
      start = task.startDate;
    }
    if (task.dueDate !== "" && (due === "" || task.dueDate > due)) {
      due = task.dueDate;
    }
  }
  return { start, due };
}

/** 阶段投入统计：开始 / 实际结束（缺实际结束用预计完成）、含首尾天数、单日峰值与平均每天人天。 */
type StageEffort = {
  start: string;
  end: string;
  days: number;
  peak: number;
  average: number;
  hasHeadcount: boolean;
};

/**
 * 阶段起止与人力统计（业务口径 2026-11-26「大阶段标题显示开始时间到实际结束时间、历时多少天；
 * 设计施工人数按日期汇总：一个任务 22-24 号 4 人 + 下一个任务 23-24 号 4 人 → 23 / 24 号 = 8 人/天；
 * 还要统计平均每天多少人天」）：单日人数 = 当天在做的所有任务 headcount 之和（含首尾），
 * 平均 = 阶段总人天 ÷ 阶段日历天数（含首尾）。
 */
function stageEffortOf(group: StageGroup): StageEffort | null {
  let start = "";
  let end = "";
  for (const task of group.tasks) {
    if (task.startDate !== "" && (start === "" || task.startDate < start)) {
      start = task.startDate;
    }
    const finish = task.doneDate !== "" ? task.doneDate : task.dueDate;
    if (finish !== "" && (end === "" || finish > end)) {
      end = finish;
    }
  }
  if (start === "" || end === "" || end < start) {
    return null;
  }
  const days = daysBetweenInclusive(start, end);
  if (days <= 0) {
    return null;
  }
  const covered = group.tasks.filter((task) => task.headcount > 0
    && task.startDate !== ""
    && (task.doneDate !== "" || task.dueDate !== ""));
  let peak = 0;
  let total = 0;
  if (covered.length > 0) {
    const startMs = Date.parse(start + "T00:00:00Z");
    for (let index = 0; index < days; index += 1) {
      const day = new Date(startMs + index * 86400000).toISOString().slice(0, 10);
      let sum = 0;
      for (const task of covered) {
        const finish = task.doneDate !== "" ? task.doneDate : task.dueDate;
        if (task.startDate <= day && day <= finish) {
          sum += task.headcount;
        }
      }
      peak = Math.max(peak, sum);
      total += sum;
    }
  }
  return {
    start,
    end,
    days,
    peak,
    average: covered.length === 0 ? 0 : Math.round((total / days) * 10) / 10,
    hasHeadcount: covered.length > 0,
  };
}

/** 阶段标题第二行：起止 / 历时 / 峰值 / 平均人天（无日期或人数时只显示能算出的部分）。 */
function stageMetaHtml(group: StageGroup, primary: OverviewExportLanguage): string {
  const effort = stageEffortOf(group);
  if (effort === null) {
    return "";
  }
  const parts = [
    escapeHtml(effort.start) + " → " + escapeHtml(effort.end),
    String(effort.days) + " " + escapeHtml(localizedValue("天", primary)),
  ];
  if (effort.hasHeadcount) {
    const unit = escapeHtml(localizedValue("人/天", primary));
    parts.push(escapeHtml(localizedValue("峰值", primary)) + " " + String(effort.peak) + " " + unit);
    parts.push(escapeHtml(localizedValue("平均", primary)) + " " + String(effort.average) + " " + unit);
  }
  return "<div class=\"grp__meta\">" + parts.join(" · ") + "</div>";
}

/** 折叠阶段与任务行共用当前列配置；折叠行把阶段汇总值放回对应可见列，隐藏列不再占位。 */
function groupSectionHtml(
  counter: { value: number },
  group: StageGroup,
  note: string | undefined,
  managerText: string,
  translationMap: ReadonlyMap<string, string>,
  primary: OverviewExportLanguage,
  collapsed: boolean,
  columns: OverviewTaskColumns,
): string {
  const visibleColumns = visibleOverviewTaskColumns(columns);
  const stageName = fixedText(group.name, primary);
  const noteHtml = note === undefined ? "" : `<span class="grp__note">${translatedText(note, translationMap.get(note), primary)}</span>`;
  const metaHtml = stageMetaHtml(group, primary);
  const countText = group.total === 0
    ? fixedText("暂无任务", primary)
    : String(group.done) + " / " + String(group.total) + " " + escapeHtml(localizedValue("完成", primary)) + " · " +
      (primary === "zh" ? secondaryText("completed", "en") : secondaryText("完成", "zh"));
  const groupHeading = (showCount = true) =>
    '<tr class="grp__head"><td colspan="' + String(visibleColumns.length + 1) + '"><div class="grp__heading">' +
    '<span class="grp__name">' + stageName + '</span>' +
    (showCount ? '<span class="grp__count">' + countText + '</span>' : '') +
    noteHtml +
    '</div>' + metaHtml + '</td></tr>';

  if (collapsed && group.total > 0) {
    counter.value += group.tasks.length;
    const pct = group.total === 0 ? 0 : Math.round((group.done / group.total) * 100);
    const status = stageOverallStatus(group);
    const tint = status === null ? { text: "#52525b" } : STATUS_TINT[status];
    const dateRange = groupDateRange(group);
    const fill = group.total === 0 ? "#d4d4d8" : pct === 100 ? "#10b981" : "#18181b";
    const cells: Record<OverviewTaskColumnKey, string> = {
      title: '<td class="grp__name">' + stageName + noteHtml + metaHtml + '</td>',
      note: '<td class="grp__count">' + countText + '</td>',
      managers: '<td class="managers"><span class="one-line">' + escapeHtml(managerText) + '</span></td>',
      owners: '<td class="owners"></td>',
      status: '<td class="grp__status"><span class="chip" style="color: ' + tint.text + '">' + fixedText(status ?? "暂无任务", primary) + '</span></td>',
      startDate: '<td class="num date">' + dateText(dateRange.start) + '</td>',
      dueDate: '<td class="num date">' + dateText(dateRange.due) + '</td>',
      headcount: '<td class="num"></td>',
      progress: '<td class="grp__progress-cell"><span class="grp__progress">' + barHtml(pct, fill, "bar--grp") + '<span>' + (group.total === 0 ? "—" : String(pct) + "%") + '</span></span></td>',
    };
    return (
      '<tbody class="grp">' +
      (!columns.title && note !== undefined ? groupHeading(false) : "") +
      '<tr class="grp__head grp__head--collapsed">' +
      '<td class="num"></td>' +
      visibleColumns.map((column) => cells[column.key]).join("") +
      '</tr>' +
      '</tbody>'
    );
  }
  const rows = group.tasks
    .map((task) => {
      counter.value += 1;
      return taskRowHtml(counter.value, task, managerText, translationMap, primary, columns);
    })
    .join("");
  return (
    '<tbody class="grp">' +
    groupHeading() +
    rows +
    '</tbody>'
  );
}

/** 报告的打印样式（自包含在 iframe 文档里：不依赖站内 Tailwind，也不反向影响站内样式）。 */
const REPORT_STYLE = `
  ${notoSansJpCss}
  ${notoSansKrCss}
  ${notoSansScCss}
  /* 2026-10-09 追订（先按「纸张竖着了 尽可能在一页展示」改竖版，再按「还是之前的横屏吧」回 **A4 横版**）：
     保留这轮的紧凑结构 —— 统计卡收成一条统计条、阶段进度 5 列网格、明细行英文名与进展描述并成一行小字并按
     列宽单行截断（nowrap + ellipsis），列宽按横版加宽后的单行内容重排（描述 / 交付物列更宽、日期列更窄）；
     字号 / 内边距回到横版舒适档。横版高度有限，按整行分页（表头逐页重复，行与分组头不跨页）。
     2026-10-10 追订（「这种英文不应该省略 表格宽度可以加宽 不强制在一页展示」）：副行撤字符截断与单行 ellipsis、改自然换行
     （overflow-wrap: anywhere），描述列 29% → 31%（经理 / 负责人列各让 1%）；行高随内容增长、页数不设上限。 */
  @page { size: A4 landscape; margin: 10mm 9mm 9mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact;
    -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  body { margin: 0; color: #1f2329; font-size: 10.5px; line-height: 1.45;
    -webkit-text-size-adjust: 100%; text-size-adjust: 100%;
    font-family: "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC Variable", "Source Han Sans SC", "Noto Sans SC", sans-serif; }
  body.primary-ja { font-family: "Noto Sans JP Variable", "Noto Sans SC Variable", "Noto Sans KR Variable", sans-serif; }
  body.primary-ko { font-family: "Noto Sans KR Variable", "Noto Sans SC Variable", "Noto Sans JP Variable", sans-serif; }
  .secondary[lang="zh-CN"] { font-family: "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC Variable", "Noto Sans JP Variable", "Noto Sans KR Variable", sans-serif; }
  .head { padding-bottom: 6px; border-bottom: 2px solid #18181b; }
  .head__logo { display: block; height: 36px; width: auto; }
  .hero { display: flex; align-items: flex-start; gap: 16px; margin-top: 8px; }
  .hero__left { flex: 1; min-width: 0; text-align: right; }
  .hero__code { margin: 2px 0 0; font-size: 10px; letter-spacing: 0.04em; color: #71717a; }
  .hero__name { margin: 0; font-size: 18px; line-height: 1.2; font-weight: 700; }
  .hero__name .secondary { display: block; margin-top: 2px; font-size: 10.5px; font-weight: 500; }
  .hero__tags { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px 6px; margin: 5px 0 0; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 999px; background: #f4f4f5; color: #52525b; font-size: 9.5px; }
  .hero__progress { flex: 0 0 240px; }
  .hero__pct { margin: 0; font-size: 25px; line-height: 1; font-weight: 700; font-variant-numeric: tabular-nums; text-align: left; }
  .hero__pct span { margin-left: 1px; font-size: 12.5px; }
  .hero__label { margin: 2px 0 4px; font-size: 9.5px; color: #71717a; text-align: left; }
  .hero__foot { margin: 5px 0 0; font-size: 9.5px; line-height: 1.5; color: #52525b; text-align: left; }
  .bar { height: 4px; border-radius: 999px; background: #eceef1; }
  .stats { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin-top: 8px; padding: 6px 10px; border: 1px solid #e4e4e7; border-radius: 8px; background: #fafafa; }
  .stat { display: inline-flex; align-items: baseline; gap: 5px; font-size: 9.5px; color: #71717a; }
  .stat__dot { width: 6px; height: 6px; border-radius: 999px; align-self: center; }
  .stat__value { font-size: 13.5px; font-weight: 700; color: #18181b; font-variant-numeric: tabular-nums; }
  .section { margin-top: 8px; }
  .section__title { display: flex; align-items: baseline; gap: 6px; margin: 0 0 5px; font-size: 12px; font-weight: 700; }
  .section__title::before { content: ""; width: 3px; height: 11px; border-radius: 2px; background: #18181b; align-self: center; }
  .section__note { margin-left: auto; font-size: 9.5px; font-weight: 400; color: #a1a1aa; }
  .stages { --stage-columns: 5; display: grid; grid-template-columns: repeat(var(--stage-columns), 1fr); gap: 5px 7px; }
  .stage { padding: 4px 7px 5px; border: 1px solid #e4e4e7; border-radius: 6px; background: #ffffff; break-inside: avoid; }
  .stage__head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; margin-bottom: 4px; }
  .stage__name { font-size: 10.5px; font-weight: 600; }
  .stage__count { font-size: 9.5px; color: #71717a; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.tasks { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.tasks thead { display: table-header-group; }
  table.tasks th { padding: 5px 5px 6px; background: #18181b; color: #ffffff; font-size: 9.5px; font-weight: 600; line-height: 1.45; text-align: left; vertical-align: top; overflow: visible; }
  table.tasks td { padding: 4px 5px 6px; border-bottom: 1px solid #e9e9ec; font-size: 9.5px; line-height: 1.5; vertical-align: top; }
  table.tasks tr { break-inside: avoid; }
  tbody.grp tr.grp__head td { padding: 3px 7px; background: #f4f4f5; border-bottom: 1px solid #e4e4e7; break-after: avoid; }
  .grp__name { font-size: 10.5px; font-weight: 700; }
  .grp__count { margin-left: 6px; font-size: 9.5px; color: #71717a; }
  .grp__heading { display: flex; align-items: baseline; }
  .grp__meta { margin: 1px 0 0; font-size: 8.5px; color: #52525b; }
  .grp__heading .grp__name, .grp__heading .grp__count { flex-shrink: 0; }
  .grp__note { min-width: 0; margin-left: 10px; color: #3f3f46; font-size: 9.5px; font-weight: 400; overflow-wrap: anywhere; }
  tbody.grp tr.grp__head--collapsed .grp__note { display: block; margin: 2px 0 0; }
  tbody.grp tr.grp__head--collapsed td { padding: 6px 5px; background: #fafafa; border: 0; border-bottom: 1px solid #e4e4e7; vertical-align: middle; }
  tbody.grp tr.grp__head--collapsed td:first-child { padding-left: 7px; border-left: 1px solid #e4e4e7; }
  tbody.grp tr.grp__head--collapsed td:last-child { padding-right: 7px; border-right: 1px solid #e4e4e7; }
  tbody.grp tr.grp__head--collapsed .grp__status { padding-left: 5px; padding-right: 5px; }
  tbody.grp tr.grp__head--collapsed .grp__status .chip { font-size: 9px; }
  tbody.grp tr.grp__head--collapsed .grp__count { margin-left: 0; padding-left: 5px; }
  tbody.grp tr.grp__head--collapsed .grp__progress { display: flex; justify-content: flex-start; width: 100%; min-width: 0; margin-left: 0; gap: 4px; }
  tbody.grp tr.grp__head--collapsed .grp__progress .bar { width: 28px; }
  .grp__meta { display: inline-flex; align-items: baseline; gap: 3px; margin-left: 7px; color: #71717a; font-size: 9px; }
  .grp__meta-label { font-size: 9px; }
  .grp__meta-value { max-width: 120px; color: #3f3f46; font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .grp__progress { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; min-width: 104px; color: #52525b; font-size: 9px; font-variant-numeric: tabular-nums; }
  .grp__progress .bar { width: 72px; height: 4px; }
  .task__title { font-weight: 600; color: #18181b; }
  .task__sub { display: block; margin-top: 2px; font-size: 9px; line-height: 1.45; color: #a1a1aa; overflow-wrap: anywhere; }
  .pnote { font-size: 9px; line-height: 1.5; color: #52525b; overflow-wrap: anywhere; }
  .pnote .secondary { display: block; margin-top: 1px; font-size: 8px; }
  .one-line { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .managers { font-size: 9px; color: #3f3f46; }
  .chip { position: relative; display: block; box-sizing: border-box; width: 100%; padding: 0 0 0 8px; font-size: 9px; font-weight: 600; line-height: 1.3; white-space: nowrap; text-align: left; }
  .chip::before { content: ""; position: absolute; left: 0; top: 4px; width: 4px; height: 4px; border-radius: 999px; background: currentColor; }
  .num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .date { font-family: "Noto Sans SC Variable", "Source Han Sans SC", "Noto Sans SC", sans-serif; font-variant-numeric: normal; }
  .center { text-align: center; }
  .dim { color: #a1a1aa; }
  .progress { white-space: nowrap; }
  .progress .bar { display: inline-block; width: 28px; height: 4px; vertical-align: middle; }
  .progress__label { display: inline-block; margin-left: 4px; width: 34px; font-size: 9px; color: #52525b; vertical-align: middle; }
  .empty { margin: 0; padding: 10px; border: 1px dashed #d4d4d8; border-radius: 6px; color: #a1a1aa; font-size: 10.5px; text-align: center; }
  /* 中英双语层级：次要语言统一为小一号浅灰小字（.secondary）——中文主体时是英文，英文主体时是中文；
     表头、状态签、进度档位与阶段名的次要语言独立一行，其余标签同行跟随。 */
  .secondary { font-size: 8.5px; color: #a1a1aa; }
  table.tasks th .th-main { display: block; line-height: 1.45; white-space: normal; overflow: visible; overflow-wrap: anywhere; }
  table.tasks th .secondary { display: block; margin-top: 2px; font-size: 8px; font-weight: 500; line-height: 1.4; color: rgba(255, 255, 255, 0.78); white-space: normal; overflow: visible; overflow-wrap: anywhere; }
  .chip .secondary { display: block; margin-top: 1px; font-size: 8px; font-weight: 500; line-height: 1.3; color: #71717a; opacity: 1; }
  .stage__head { align-items: flex-start; }
  .stage__name .secondary { display: block; margin-top: 1px; font-size: 8px; font-weight: 400; }
  .grp__name .secondary { font-weight: 400; }
  .progress__label { width: auto; }
  .progress__label .secondary { display: block; font-size: 7.5px; line-height: 1.2; }
  .section__title .secondary { font-size: 9px; font-weight: 600; }
  .tag .secondary, .stat .secondary, .section__note .secondary, .grp__count .secondary, .hero__code .secondary, .hero__foot .secondary, .stage__count .secondary { font-size: 8px; }
  .hero__progress { flex: 0 0 240px; }
`;

/** 报告头部的品牌 logo（业务 2026-10-10 提供的导出专用 SVG，`public/libiao-logo.svg`）：
 *  about:srcdoc 文档里必须用绝对地址，故拼站点 origin（与站内 index.html 的 logo 不同一枚，互不影响）。 */
function brandLogoUrl(): string {
  return window.location.origin + "/libiao-logo.svg";
}

/** 拼一份自包含的报告 HTML（无脚本、无第三方外链；只引用站内 logo 与自托管思源黑体字体分片）。 */
export function buildOverviewReportHtml(
  input: OverviewExportInput,
  translationMap: ReadonlyMap<string, string> = EMPTY_TRANSLATIONS,
  primary: OverviewExportLanguage = "zh",
  collapsedStages: readonly string[] = [],
  columns: OverviewTaskColumns = DEFAULT_OVERVIEW_TASK_COLUMNS,
  hiddenStages: readonly string[] = [],
): string {
  const { project, tasks, summary } = input;
  const groups = groupedByStage(tasks, projectTaskStageNames(summary?.additionalStages, tasks));
  const counts = countsOf(tasks, summary);
  const stageTextOf = (key: string | null): string => (key === null ? "—" : stageNameOf(key) || "—");
  const latest = summary === null ? "—" : stageTextOf(summary.latestStage);
  const translatedName = translationMap.get(project.description) ?? "";
  const heroLabelZh = counts.total === 0 ? "整体进度" : "整体进度（已完成 " + String(counts.done) + " / " + String(counts.total) + "）";
  const heroLabelEn = counts.total === 0
    ? "Overall Progress"
    : "Overall Progress (" + String(counts.done) + " / " + String(counts.total) + " completed)";
  const heroLabelJa = counts.total === 0
    ? "全体進捗"
    : "全体進捗（完了 " + String(counts.done) + " / " + String(counts.total) + "）";
  const heroLabelKo = counts.total === 0
    ? "전체 진행률"
    : "전체 진행률(완료 " + String(counts.done) + " / " + String(counts.total) + ")";
  const heroLabelMain = primary === "zh" ? heroLabelZh : primary === "en" ? heroLabelEn : primary === "ja" ? heroLabelJa : heroLabelKo;
  const heroLabelSecondary = primary === "zh" ? "Overall Progress" : heroLabelZh;
  const heroLabelHtml = escapeHtml(heroLabelMain) + "<br />" + secondaryText(heroLabelSecondary, primary === "zh" ? "en" : "zh");
  const shareOf = (part: number): string => (counts.total === 0 ? "" : percentText(part, counts.total));
  const stats = [
    statHtml("任务总数", String(counts.total), "", "#18181b", primary),
    statHtml("已完成", String(counts.done), shareOf(counts.done), "#10b981", primary),
    statHtml("进行中", String(counts.active), shareOf(counts.active), "#f59e0b", primary),
    statHtml("待开始", String(counts.pending), shareOf(counts.pending), "#0ea5e9", primary),
    statHtml("已延期", String(counts.overdue), shareOf(counts.overdue), "#f43f5e", primary),
  ].join("");

  const hidden = new Set(hiddenStages);
  const shownGroups = groups.filter((group) => !hidden.has(group.name));
  const reportGroups = shownGroups.filter((group) => group.tasks.length > 0 || group.name !== TEMP_TASK_STAGE);
  const stageCells = reportGroups.map((group) => stageCellHtml(group, primary)).join("");
  const notesByRef = new Map(summary?.stageNotes?.map(({ stageRef, note }) => [stageRef, note]));
  const additionalIds = new Map(summary?.additionalStages?.map((stage) => [additionalStageName(stage), stage.id]));
  const counter = { value: 0 };
  const managerText = projectManagerText(project);
  const collapsed = new Set(collapsedStages);
  const detailRows = shownGroups.map((group) => {
    const stageRef = additionalIds.get(group.name) ?? stageKeyOfName(group.name);
    const note = stageRef === null ? undefined : notesByRef.get(stageRef);
    if (group.total === 0 && note === undefined) return "";
    return groupSectionHtml(counter, group, note, managerText, translationMap, primary, collapsed.has(group.name), columns);
  }).join("");
  const fetchedCount = String(tasks.length);
  let clippedNote = "";
  if (counts.total > tasks.length) {
    const clippedZh = "列表一次取满 " + fetchedCount + " 条，明细只含已取到的任务";
    if (primary === "zh") {
      clippedNote = "（列表一次取满 " + fetchedCount + " 条，明细只含已取到的任务 · " + secondaryText("list capped, fetched tasks only", "en") + "）";
    } else if (primary === "en") {
      clippedNote = " (list capped to " + fetchedCount + " · " + secondaryText(clippedZh, "zh") + ")";
    } else if (primary === "ja") {
      clippedNote = "（一覧は " + fetchedCount + " 件まで取得済みのため、明細は取得済みタスクのみ · " + secondaryText(clippedZh, "zh") + "）";
    } else {
      clippedNote = " (" + fetchedCount + "개까지만 조회되어 상세에는 조회된 작업만 표시됩니다 · " + secondaryText(clippedZh, "zh") + ")";
    }
  }
  let emptyText = "本项目暂无任务 · " + secondaryText("No tasks in this project.", "en");
  if (primary === "en") {
    emptyText = "No tasks in this project. " + secondaryText("本项目暂无任务。", "zh");
  } else if (primary === "ja") {
    emptyText = "このプロジェクトにはタスクがありません。 " + secondaryText("本项目暂无任务。", "zh");
  } else if (primary === "ko") {
    emptyText = "이 프로젝트에는 작업이 없습니다. " + secondaryText("本项目暂无任务。", "zh");
  }
  const visibleColumns = visibleOverviewTaskColumns(columns);
  const visibleWidth = visibleColumns.reduce((sum, column) => sum + column.width, 0);
  const dataWidthScale = visibleWidth === 0 ? 0 : 97 / visibleWidth;
  const tableHtml =
    detailRows === ""
      ? `<p class="empty">${emptyText}</p>`
      : `<table class="tasks">
    <colgroup>
      <col style="width: 3%" />
      ${visibleColumns.map((column) => `<col style="width: ${String(column.width * dataWidthScale)}%" />`).join("")}
    </colgroup>
    <thead>
      <tr>
        <th></th>
        ${visibleColumns.map((column) => `<th>${tableHeadText(column.label, primary)}</th>`).join("")}
      </tr>
    </thead>
    ${detailRows}
  </table>`;

  const latestLabel = fixedText("最新阶段", primary);
  const projectNameTarget = translatedName === "" ? project.description : translatedName;
  const heroNameZh = project.description + " · 进度报告";
  const heroNameEn = projectNameTarget + " · Progress Report";
  const heroNameTarget = projectNameTarget + " · " + localizedValue("进度报告", primary);
  let heroNameHtml = escapeHtml(heroNameZh) + " " + secondaryText(heroNameEn, "en");
  if (primary === "en") {
    heroNameHtml = escapeHtml(heroNameEn) + " " + secondaryText(heroNameZh, "zh");
  } else if (primary === "ja" || primary === "ko") {
    heroNameHtml = escapeHtml(heroNameTarget) + " " + secondaryText(heroNameZh, "zh");
  }
  const reportName = localizedValue("项目进度报告", primary);
  let docTitle = project.description + " · 项目进度报告 Project Progress Report";
  if (primary === "en") {
    docTitle = projectNameTarget + " · Project Progress Report / " + project.description + " · 项目进度报告";
  } else if (primary === "ja" || primary === "ko") {
    docTitle = projectNameTarget + " · " + reportName + " / " + project.description + " · 项目进度报告";
  }
  const taskCount = String(counts.total);
  const taskTotalMain = primary === "zh"
    ? "共 " + taskCount + " 条"
    : primary === "en"
      ? "tasks in total: " + taskCount
      : primary === "ja" ? "タスク合計: " + taskCount + " 件" : "총 작업 " + taskCount + "개";
  const taskTotalSecondary = "共 " + taskCount + " 条";
  const tasksTotalHtml = escapeHtml(taskTotalMain) + " · " + secondaryText(primary === "zh" ? "tasks in total" : taskTotalSecondary, primary === "zh" ? "en" : "zh") + clippedNote;
  return `<!doctype html>
<html lang="${languageAttr(primary)}" data-primary-language="${primary}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${OVERVIEW_PREVIEW_FRAME_WIDTH}, initial-scale=1" />
<title>${escapeHtml(docTitle)}</title>
<style>${REPORT_STYLE}</style>
</head>
<body class="primary-${primary}">
  <header class="head">
    <img class="head__logo" src="${brandLogoUrl()}" alt="LibiaoLink" />
  </header>

  <section class="hero">
    <div class="hero__progress">
      <p class="hero__pct">${String(counts.pct)}<span>%</span></p>
      <p class="hero__label">${heroLabelHtml}</p>
      ${barHtml(counts.pct, "#18181b", "bar--hero")}
      <p class="hero__foot">${latestLabel}${labelColon(primary)}${fixedText(latest, primary)}</p>
    </div>
    <div class="hero__left">
      <h1 class="hero__name">${heroNameHtml}</h1>
      <p class="hero__code">${fixedText("项目编号", primary)}${labelColon(primary)}${escapeHtml(project.code)}</p>
      <div class="hero__tags">
        <span class="tag">${fixedText("项目经理", primary)}${labelColon(primary)}${escapeHtml(projectManagerText(project))}</span>
      </div>
    </div>
  </section>

  <section class="stats">${stats}</section>

  <section class="section">
    <h2 class="section__title">${fixedText("阶段进度", primary)}<span class="section__note">${fixedText("施工阶段统计完成情况", primary)}</span></h2>
    <div class="stages">${stageCells}</div>
  </section>

  <section class="section">
    <h2 class="section__title">${fixedText("任务明细", primary)}<span class="section__note">${tasksTotalHtml}</span></h2>
    ${tableHtml}
  </section>

</body>
</html>`;
}

/**
 * 预览专用报告：内容与正式导出完全同源，仅额外注入屏幕分页样式与运行时。
 * 运行时按 A4 横版打印内容区拆页、重复任务表头，并回传当前页码 / 总页数。
 */
export function buildOverviewPreviewHtml(
  input: OverviewExportInput,
  translationMap: ReadonlyMap<string, string>,
  primary: OverviewExportLanguage,
  collapsedStages: readonly string[] = [],
  columns: OverviewTaskColumns = DEFAULT_OVERVIEW_TASK_COLUMNS,
  hiddenStages: readonly string[] = [],
): string {
  return buildOverviewReportHtml(input, translationMap, primary, collapsedStages, columns, hiddenStages)
    .replace("</head>", `<style>${overviewPreviewPagedCss}</style></head>`)
    .replace("</body>", `<script data-overview-preview-runtime="" src="${escapeHtml(new URL(overviewPreviewPagedScriptUrl, window.location.origin).href)}"></script></body>`);
}

/**
 * 预览与正式导出共用同一份译文请求（主体语言 / 阶段显示 / 折叠状态变了也保持一致）：
 * 中文、英文主体取英文；日文、韩文主体取对应语言。隐藏或折叠阶段的任务不进请求。
 */
export function overviewExportTranslationRequest(
  input: OverviewExportInput,
  options: Pick<OverviewExportOptions, "primary" | "collapsedStages" | "hiddenStages" | "columns">,
): { target: TranslationTarget; texts: string[] } {
  const { primary, collapsedStages, hiddenStages } = options;
  const target: TranslationTarget = primary === "ja" ? "ja" : primary === "ko" ? "ko" : "en";
  const collapsed = new Set(collapsedStages);
  const hidden = new Set(hiddenStages);
  const visibleTasks = input.tasks.filter((task) => {
    const stage = task.stage === "" ? "临时任务" : task.stage;
    return !collapsed.has(stage) && !hidden.has(stage);
  });
  // 阶段备注同样按导出主体语言翻译（2026-11-26 追订）；空备注不进翻译通道。
  const stageNoteTexts = (input.summary?.stageNotes ?? [])
    .map((item) => item.note)
    .filter((note) => note !== "");
  const texts = target === "en"
    ? [input.project.description, ...visibleTasks.map((task) => task.note), ...stageNoteTexts]
    : [input.project.description, ...visibleTasks.flatMap((task) => [task.title, task.note]), ...stageNoteTexts];
  return { target, texts };
}

/**
 * 导出项目总览为 PDF：中文 / 英文主体沿用英文译文口径；日文 / 韩文主体额外翻译项目名、任务名与进展描述。
 * 逐阶段折叠：只为未折叠阶段的任务名 / 进展描述发起翻译；默认全部展开时沿用原全量翻译口径。
 * 译文命中会话缓存 / 服务端译文库即取，未预热条目才现场翻；通道不通静默回退中文，不阻断导出。
 * 报告 HTML 走与左侧预览同源的分页器拆成 A4 横版页，再逐页截图并封装 PDF；生成完成后直接下载，不弹系统打印窗口。
 * onTranslateProgress(done, total)：译文进度回调（导出等待浮层显示「报告内容翻译中 + 预计秒数」）。
 */
export async function exportProjectOverviewPdf(
  input: OverviewExportInput,
  options: OverviewExportOptions = DEFAULT_OVERVIEW_EXPORT_OPTIONS,
  onTranslateProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { primary, collapsedStages, columns, hiddenStages, exportName } = options;
  const { target, texts } = overviewExportTranslationRequest(input, options);
  const translationMap = await translateZhTo(texts, target, onTranslateProgress);
  const html = buildOverviewPreviewHtml(input, translationMap, primary, collapsedStages, columns, hiddenStages);
  await exportProjectOverviewPdfHtml(html, input, exportName);
}

/**
 * 直接导出预览面板已经生成的最终 HTML：不再重建报告 / 重新请求译文，
 * 让下载 PDF 与用户当下看到的页数、表头换行、折叠阶段和译文完全同源。
 */
export async function exportProjectOverviewPdfHtml(
  html: string,
  input: OverviewExportInput,
  exportName: string,
): Promise<void> {
  await downloadPagedOverviewPdf(html, input, exportName);
}

type PagedPreview = {
  document: Document;
  pages: HTMLElement[];
};

/**
 * 在离屏 iframe 内完成分页、截图与 PDF 封装：
 * ① 等预览分页运行时把报告拆成固定尺寸的 A4 横版页；② 等字体 / logo 就绪；
 * ③ 去掉预览阴影与页码、把 iframe 拉高到整份报告；④ 逐页渲染为 2 倍 PNG 并写入 A4 横版 PDF；
 * ⑤ 通过 Blob URL 触发浏览器下载。iframe 始终在视口外，不污染站内 DOM / 样式，也不打开打印窗口。
 */
async function downloadPagedOverviewPdf(
  html: string,
  input: OverviewExportInput,
  exportName: string,
): Promise<void> {
  const previous = document.getElementById(PDF_FRAME_ID);
  if (previous !== null) {
    previous.remove();
  }

  const frame = document.createElement("iframe");
  frame.id = PDF_FRAME_ID;
  frame.title = "项目进度报告 PDF";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  // 必须保持真实渲染（display:none / visibility:hidden 会让截图空白）：只挪到视口外。
  frame.style.cssText = "position: fixed; left: -20000px; top: 0; width: " + OVERVIEW_PREVIEW_FRAME_WIDTH + "px; height: " + OVERVIEW_PREVIEW_FRAME_HEIGHT + "px; border: 0; pointer-events: none;";
  frame.srcdoc = html;
  document.body.appendChild(frame);

  try {
    const paged = await waitForPagedPreview(frame);
    await waitForDocumentAssets(paged.document);
    const imagesInlined = await inlineDocumentImages(paged.document);
    await prepareCaptureLayout(frame, paged);

    const [{ default: html2canvas }, { PDFDocument }] = await Promise.all([
      import("html2canvas-pro"),
      import("pdf-lib"),
    ]);
    const pdf = await PDFDocument.create();
    pdf.setTitle(resolvedOverviewExportName(input.project, exportName));
    pdf.setSubject("LibiaoLink project progress report");
    pdf.setCreator("LibiaoLink");
    pdf.setProducer("LibiaoLink");

    for (const pageElement of paged.pages) {
      const captureOptions = {
        backgroundColor: "#ffffff",
        scale: PDF_RENDER_SCALE,
        useCORS: true,
        logging: false,
        width: Math.ceil(OVERVIEW_REPORT_PAGE_WIDTH),
        height: Math.ceil(OVERVIEW_REPORT_PAGE_HEIGHT),
        windowWidth: OVERVIEW_REPORT_PAGE_WIDTH,
        windowHeight: Math.max(Math.ceil(OVERVIEW_REPORT_PAGE_HEIGHT), Math.ceil(paged.document.documentElement.scrollHeight)),
        scrollX: 0,
        scrollY: 0,
      };
      let canvas: HTMLCanvasElement;
      if (imagesInlined) {
        try {
          canvas = await html2canvas(pageElement, { ...captureOptions, foreignObjectRendering: true });
        } catch (error) {
          console.warn("Overview PDF foreignObject capture failed; falling back to canvas rendering.", error);
          canvas = await html2canvas(pageElement, captureOptions);
        }
      } else {
        canvas = await html2canvas(pageElement, captureOptions);
      }
      let png: Uint8Array;
      try {
        png = await canvasPngBytes(canvas);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
      const image = await pdf.embedPng(png);
      const page = pdf.addPage([PDF_PAGE_WIDTH_PT, PDF_PAGE_HEIGHT_PT]);
      page.drawImage(image, { x: 0, y: 0, width: PDF_PAGE_WIDTH_PT, height: PDF_PAGE_HEIGHT_PT });
    }

    const bytes = await pdf.save({ useObjectStreams: true });
    downloadPdfBlob(new Blob([toArrayBuffer(bytes)], { type: "application/pdf" }), overviewPdfFileName(input, exportName));
  } finally {
    frame.remove();
  }
}

/** 轮询等待预览运行时完成首次分页；超时抛错，让导出浮层结束而不是无限等待。 */
async function waitForPagedPreview(frame: HTMLIFrameElement): Promise<PagedPreview> {
  const deadline = performance.now() + PDF_READY_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const doc = frame.contentDocument;
    if (doc?.body?.classList.contains("preview-ready")) {
      const pages = Array.from(doc.querySelectorAll<HTMLElement>(".preview-page"));
      if (pages.length > 0) {
        return { document: doc, pages };
      }
    }
    await delay(50);
  }
  throw new Error("Timed out while paginating the project overview PDF");
}

/** 等报告字体和 logo 就绪；各自最多等 5s，加载失败也继续，避免导出被单个资源永久卡住。 */
async function waitForDocumentAssets(doc: Document): Promise<void> {
  const fontReady = doc.fonts.ready;
  await Promise.race([
    fontReady.catch(() => undefined),
    delay(5000),
  ]);
  const pendingImages = Array.from(doc.images)
    .filter((image) => !image.complete)
    .map((image) => new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    }));
  if (pendingImages.length > 0) {
    await Promise.race([
      Promise.all(pendingImages).then(() => undefined),
      delay(5000),
    ]);
  }
}

/**
 * foreignObject 捕获时，外部图片在 SVG 文档里会失去同源上下文而裂图；先抓成本地 data URI。
 * 只有全部图片都成功内嵌时才走 foreignObject，否则退回兼容的 Canvas 渲染，避免下载件丢 logo。
 */
async function inlineDocumentImages(doc: Document): Promise<boolean> {
  let allInlined = true;
  await Promise.all(Array.from(doc.images).map(async (image) => {
    const source = image.currentSrc || image.src;
    if (source === "" || source.startsWith("data:")) {
      return;
    }
    let url: URL;
    try {
      url = new URL(source, doc.baseURI);
    } catch {
      allInlined = false;
      return;
    }
    if (url.origin !== window.location.origin) {
      allInlined = false;
      return;
    }
    try {
      const response = await fetch(url.href, { cache: "force-cache", credentials: "same-origin" });
      if (!response.ok) {
        allInlined = false;
        return;
      }
      image.src = await blobToDataUrl(await response.blob());
      await image.decode().catch(() => undefined);
      if (!image.complete) {
        allInlined = false;
      }
    } catch {
      allInlined = false;
    }
  }));
  return allInlined;
}

/** 截图前清掉预览外层装饰，并把 iframe 拉高到全部页面，确保 html2canvas-pro 能稳定取到每一页。 */
async function prepareCaptureLayout(frame: HTMLIFrameElement, paged: PagedPreview): Promise<void> {
  const style = paged.document.createElement("style");
  style.setAttribute("data-overview-pdf-capture", "");
  style.textContent = PDF_CAPTURE_STYLE;
  paged.document.head.appendChild(style);
  frame.style.height = Math.max(900, Math.ceil(paged.document.documentElement.scrollHeight)) + "px";
  await delay(80);
}

/** Blob → data URI（foreignObject 内嵌图片用；体积只覆盖报告里的少量图片）。 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read overview report image"));
    reader.readAsDataURL(blob);
  });
}

/** canvas → PNG 字节（不用 data URL，避免长报告的大图产生额外 base64 内存开销）。 */
function canvasPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new Error("Could not encode the overview report page as PNG"));
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      }, "image/png");
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** 复制到独立 ArrayBuffer：Blob 构造与实际字节区间严格对应。 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** 触发浏览器直接保存 PDF（Blob URL 不会被弹窗拦截；60s 后回收）。 */
function downloadPdfBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** 文件名 = 导出面板填写的名称（默认项目编号 + 项目名称 + 计划表）；去掉 Windows / macOS 非法字符。 */
function overviewPdfFileName(input: OverviewExportInput, exportName: string): string {
  const base = resolvedOverviewExportName(input.project, exportName);
  const safe = base
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 160);
  return (safe === "" ? "计划表" : safe) + ".pdf";
}

/** 轻量等待；分页运行时和字体加载都在浏览器主线程发起，这里只做短轮询 / 兜底。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
