import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Member } from "../data/members";
import type { TintedTier } from "../backgroundTier";
import { PROJECT_STAGES } from "../data/projects";
import { PROGRESS_STEPS, TEMP_TASK_STAGE, daysBetweenInclusive, isTaskDone, ownersLabel, taskCapabilitiesOf, type ProjectTask, type TaskStatus } from "../data/tasks";
import { fieldText, isLocalizedLocale, mdText, monthShortText, monthYearText, stageText, statusText, textOf, useLocale, useLocalizedTranslator, useT, yearText } from "../i18n";
import type { Locale } from "../i18n";
import { InlineDateCell, InlineNumberCell } from "./InlineEdit";
import { TrackerDots } from "./Tracker";
import { STATUS_DOT_CLASS, TaskRow, resolveColumns, tableGridTemplate, tableMinWidth, type TaskPatch } from "./TaskBoard";

/**
 * 项目详情「甘特图」视图（Push 142，业务口径「我想做甘特图 —— 在标签导航栏加一个甘特图页面」；
 * 第二轮业务口径「维持手绘尽量还原官方的功能」）。
 *
 * 形态与交互参考 VTable 甘特图基本用法（https://visactor.io/vtable/demo/gantt/gantt-basic?version=1.26.6）：
 * 左侧固定任务列表（行号 / 任务 / 开始 / 预计完成 / 施工人数 / 进展）+ 右侧时间轴（月份 + 日期两级表头、逐日网格、周末底纹、
 * 任务条、里程碑菱形、今天虚线）。用 Tailwind + 绝对定位手绘，不引入第三方图表库 ——
 * 本仓库前端目前零图表依赖，而 VTable 的甘特图要真实 Date 记录与自有表格实例，和现有任务数据模型对不上。
 *
 * 已对齐的官方开关（尽量还原官方功能）：
 * - `taskListTable` 左表 + `frame.verticalSplitLineMoveable`：左表横向不滚、右边线可拖（列宽固定，拖的是「右侧时间轴盖住左表多少」的边界，双击复位）；
 * - `grid` / `headerRowHeight`：两级表头（月 + 日）、逐日竖线、周末底纹、每周一与每月一号分隔线；
 * - 滚动条（业务口径「滚动条右边的做出隐式的 下方滚动条要固定」）：原生滚动条隐藏，改自绘 —— 右侧**竖向隐式**
 *   （滚动 / 悬停才浮现，停手 900ms 隐去；与 `ScrollArea` 同一套材质）、下方**横向固定常驻**（有溢出一律可见、可直接拖）；
 * - 拖画面平移（业务口径「向左向右拖动画面要移动」）：在图表空白处按住左键拖动 = 时间轴跟手滑动（横向 / 纵向），
 *   只滚容器、不改任何任务字段；位移没过阈值仍算点击（左表行定位 / 阶段折叠 / 点空白清选中照常）；
 * - `timelineHeader.scales`：时间轴粒度可切日 / 周 / 月（表头分段与网格密度跟着换，条仍按天精确落点）；
 * - 甘特内筛选：按负责人（含「待分配」）、只看已延期、只看未排期（时间轴范围 / 阶段汇总跟着筛完的任务走）；
 * - 任务列表与甘特图同屏（Push 294）：工具条（含筛选栏）常驻；筛选生效（负责人 / 行筛选任一非「全部」）且
 *   **还有没排期的任务**时，甘特图**上方**出「项目页任务表」同款列表（15 列全列 + TaskRow 复用，口径同工作台「我的任务」表；可编辑列照常能改）；
 *   图表本身能画时仍在下方照常渲染 —— 一条排期齐的都没有时只出列表 + 提示条（业务口径「图二筛选后出现图三的情况
 *   直接把图一这样的列表展现」→「有多个行的话有一个已延期设置日期了 其他的还是要显示」+「甘特图也在下方同时显示」+「筛选栏都没有了 是bug」；
 *   Push 313 起「全部」不筛选 = 纯甘特、不出列表 —— 业务口径 2026-10-14「甘特图点击全部的时候不要显示这些列表」）；
 * - 任务列表按阶段分组 + 可折叠（Push 295，业务口径「也要分类可以折叠 在甘特图里」+「要有阶段标题分类的」）：分组口径同左表 / 项目总览
 *   （九阶段顺序 + 「临时任务」垫底 · 只出有任务的分组），分组头 = 阶段标题行（折叠箭头 + 阶段胶囊），只有折叠箭头可点；
 *   折叠状态与左表共用一份（工具栏「全部折叠 / 全部展开」一并收放）。
 * - 拖动时边缘自动滚动（业务口径「拖动进度条要移动 也要可以移画面」）：拖条 / 两端 / 进度圆点时指针进到
 *   时间轴左右边缘 72px 内，画面按深度逐帧滚，条跟着新滚到的日期走；
 * - `taskBar.moveable`：拖条整体平移改期（工期不变）；
 * - `taskBar.resizable`：拖条两端改工期（只动被拖的那一端）；
 * - 进度圆点：拖条上的圆点改进度（按四档吸附，与四格进度条同口径）；
 * - 任务条编辑锁（2026-11-09）：操作提示行右侧的锁按钮默认锁上，锁定时禁止拖条 / 两端 / 圆点写回，
 *   浏览、筛选、滚动与布局操作不受影响；解锁后才恢复编辑。
 * - `taskBar.selectable` / `hoverBarStyle`：点条选中（蓝描边）、指针停在条上盖一层半透明遮罩；
 * - `taskBar.labelText: "{title} {progress}%"`：条内写「任务名 + 进度」；
 * - `gantt-locate-taskbar`：点左表任务行 = 选中它并把条定位到时间轴可视区；
 * - `taskBar.{startDateField,endDateField,progressField}`：拖动只写 `startDate` / `dueDate` / `days` / `progress`
 *   这批既有字段（与表格行内编辑同一套换算），松手写回服务端（进度走 /progress、日期走 PATCH）。
 *
 * 其余口径（详见 `前端功能需求.md` §6.14）：
 * - 分组 = 施工阶段（九个阶段按项目总览顺序，空阶段照样出骨架行；非九阶段的任务落「临时任务」垫底 · Push 196）；
 * - 任务条 = 开始日期 → 预计完成日期；条内青色 = 已完成进度（`task.progress`）、橙色 = 剩余工期；
 * - 单日任务（开始 = 预计完成）：不再画菱形，而是按对应日格子宽度铺满，垂直高度与多日任务条统一对齐（22px 居中），保持阶段配色体系；
 * - 实际完成日期标注（B3-01）：条内不再画竖线，提前/按时在条内左侧或底部轻点/条外轻标，推迟则在条尾向右拉出细虚线与终点圆点直指实际完成日；
 * - 已延期（B3-05）：去掉条头红杠，保留阶段配色，条框带轻细玫瑰红描边，超过预计完成日期向「今天」拉出半透明红色斜纹延伸段并标「+N天」（未过今天则右侧挂轻红签）；今天 = 蓝色虚线（今天落在时间轴范围内时才画）；
 * - 依赖箭头（B3-03）、关键路径（B3-04）、导出（B3-07）不在本期；B3-06 的粒度切换与筛选已在本轮补齐。
 *
 * 布局：左表与时间轴是同一个横向滚动容器里的两块并列面板 —— 左表 `sticky left-0`（横向不滚；列宽固定，
 * 可见宽度 = 分隔线位置，超出的列由右侧时间轴盖住 —— 业务口径「右侧看板是遮挡 不是压缩左侧」）、
 * 表头 `sticky top-0`（纵向吸顶）；两边逐行用同一组行高常量渲染，因此不需要 JS 同步滚动。
 */

/** 九个施工阶段（顺序 = 项目总览的分组顺序；「项目总览」是汇总视图，不作为阶段）。 */
const STAGE_ORDER: readonly string[] = PROJECT_STAGES.filter((stage) => stage !== "项目总览");

/** 阶段不在九阶段里的任务（看板「添加 → 临时任务」建的空任务）→「临时任务」垫底（Push 196 起，原「未分组」；与项目总览最后一组同口径）。 */
const UNGROUPED = TEMP_TASK_STAGE;

/** 甘特图上方任务列表的列（Push 294）= 项目页任务表全列（口径同工作台「我的任务」表：resolveColumns({}) 一个不少）。 */
const FALLBACK_TASK_COLUMNS = resolveColumns({});
const FALLBACK_TASK_GRID = tableGridTemplate(FALLBACK_TASK_COLUMNS);
const FALLBACK_TASK_MIN_W = tableMinWidth(FALLBACK_TASK_COLUMNS);
/** 任务列表不带「项目经理」行内编辑（只读文本）：managerIds 占位同一份空数组（免得每行新建一个）。 */

/**
 * 左表列宽 / 行高：左表与时间轴靠这一组常量逐行对齐。**列宽固定、不随可见宽度变** ——
 * 分隔线是「右侧时间轴盖住左表多少」的边界（业务口径「右侧看板是遮挡 不是压缩左侧」，对齐官方样例：
 * 拖窄了列是被裁掉，不是被挤窄）。紧凑布局以尽可能给右侧时间轴留出视野：
 * 行号 36 + 任务 180 + 开始 60 + 预计完成 80 + 施工人数 56 + 进展 48 = 460px（较原先 572px 腾出 112px，保证表头单行不换行、数值居中对齐）。
 */
const COL_INDEX_W = 36;
const COL_TITLE_W = 180;
const COL_START_W = 60;
const COL_END_W = 80;
const COL_HEADCOUNT_W = 56;
const COL_PROGRESS_W = 48;
/** 「任务」列至少要露出来的宽度：分隔线最窄只遮到这儿。 */
const COL_TITLE_MIN_W = 112;
/** 左表自然宽 = 各列固定宽之和：分隔线拖到最宽 = 各列全露出来（再宽也没东西可露）。 */
const LEFT_W_NATURAL = COL_INDEX_W + COL_TITLE_W + COL_START_W + COL_END_W + COL_HEADCOUNT_W + COL_PROGRESS_W;
/** 分隔线可拖范围：最窄 = 行号 + 一截任务列，最宽 = 左表自然宽。 */
const LEFT_W_MIN = COL_INDEX_W + COL_TITLE_MIN_W;
const LEFT_W_MAX = LEFT_W_NATURAL;
const LEFT_W_DEFAULT = LEFT_W_NATURAL;
const HEADER_H = 30;
const HEADER_TOTAL_H = HEADER_H * 2;
const ROW_H = 36;

/** 任务条 / 阶段汇总条高度；条两端的热区宽与进度圆点直径（拖拽交互用）。 */
const BAR_H = 22;

/** 拖空白平移画面：位移超过这个像素才算「拖动」（不到 = 还是点击，左表行定位 / 阶段折叠照常）。 */
const PAN_THRESHOLD_PX = 4;

/** 拖任务条时靠近时间轴左右边缘的自动滚动区宽度与逐帧最大速度（px）——条能拖到屏幕外的日期。 */
const DRAG_EDGE_PX = 72;
const DRAG_EDGE_MAX_SPEED = 16;

const DAY_MS = 86400000;

/** 时间轴两端各留的余量（天）。 */
const PAD_DAYS = 2;

/**
 * 分阶段色彩体系（参考现代甘特图按阶段分色 + 括弧汇总样式）：
 * 每个施工阶段拥有一套协调色（主色 accent 用于阶段括弧与已完成进度、浅底 tint 用于剩余工期底色、
 * 淡雾 shade 用于阶段展开时的背景包络、深字 text 用于条内清晰可读性）。
 * 未完成部分采用同色系浅底（而非高对比亮橙），已完成部分用饱和主色填充，整体干净通透。
 */
type StagePalette = {
  /** 阶段主色（括弧、已完成进度条、阶段色点）。 */
  accent: string;
  /** 剩余工期底色（同色系浅底，与主色构成柔和对比）。 */
  track: string;
  /** 阶段展开时包住子任务区域的极淡背景底色（图二样式）。 */
  envelope: string;
  /** 阶段括弧及汇总条上的深色字 / 边框辅助。 */
  text: string;
};

const STAGE_PALETTE: Record<string, StagePalette> = {
  售前规划: { accent: "#d97706", track: "#fde68a", envelope: "rgba(217, 119, 6, 0.05)", text: "#78350f" },
  设计开发: { accent: "#7c3aed", track: "#ddd6fe", envelope: "rgba(124, 58, 237, 0.045)", text: "#4c1d95" },
  加工采购: { accent: "#0d9488", track: "#99f6e4", envelope: "rgba(13, 148, 136, 0.045)", text: "#134e4a" },
  组装发货: { accent: "#65a30d", track: "#d9f99d", envelope: "rgba(101, 163, 13, 0.05)", text: "#365314" },
  硬件实施: { accent: "#2563eb", track: "#bfdbfe", envelope: "rgba(37, 99, 235, 0.045)", text: "#1e3a8a" },
  软件部署: { accent: "#0891b2", track: "#a5f3fc", envelope: "rgba(8, 145, 178, 0.045)", text: "#164e63" },
  试运行:   { accent: "#db2777", track: "#fbcfe8", envelope: "rgba(219, 39, 119, 0.045)", text: "#831843" },
  投产阶段: { accent: "#c026d3", track: "#f5d0fe", envelope: "rgba(192, 38, 211, 0.045)", text: "#701a75" },
  验收:     { accent: "#059669", track: "#a7f3d0", envelope: "rgba(5, 150, 105, 0.045)", text: "#064e3b" },
};

const DEFAULT_STAGE_PALETTE: StagePalette = {
  accent: "#64748b",
  track: "#cbd5e1",
  envelope: "rgba(100, 116, 139, 0.045)",
  text: "#334155",
};

function stagePaletteOf(stage: string): StagePalette {
  return STAGE_PALETTE[stage] ?? DEFAULT_STAGE_PALETTE;
}

/** 图例示例色（使用中性石板灰示范：实心 = 已完成进度，浅底 = 剩余工期，画布上按所属阶段分色）。 */
const BAR_DONE_CLASS = "bg-slate-600";
const BAR_TODO_CLASS = "bg-slate-200";

/** 已延期超期延伸段斜纹（半透明玫瑰红斜线纹理）。 */
const OVERDUE_TAIL_BG =
  "repeating-linear-gradient(-45deg, rgba(244, 63, 94, 0.16) 0 4px, rgba(244, 63, 94, 0.04) 4px 8px)";

/** 选中条的描边（官方 taskBar.selectable 的选中态）。 */
const BAR_SELECTED_CLASS = "ring-2 ring-blue-600 shadow-[0_0_0_2px_rgba(37,99,235,0.25)]";

/** 逐日网格线（1px 线 + 空白，周期 = 每天宽度）；周末底纹块套同一套，免得盖住底下的日线。 */
function dayLineStyle(dayWidth: number): { backgroundImage: string } {
  return { backgroundImage: "repeating-linear-gradient(to right, #f1f5f9 0 1px, transparent 1px " + String(dayWidth) + "px)" };
}

/** 左表「开始 / 结束」单元格：拖动中（预览值）加一档强调，平时与「进展」同色。 */
function dateCellClass(live: boolean): string {
  return "px-1 text-center whitespace-nowrap text-[11px] tabular-nums " + (live ? "font-medium text-zinc-900" : "text-zinc-500");
}

/**
 * 「液态玻璃」材质（业务口径「改成同款液体玻璃」）：与首页分类筛选侧栏 / 任务表行内编辑单元格同一套 ——
 * 白底（半透明）+ 发丝描边 + 顶部内高光 + 极轻投影 + 背景虚化；工具条里的胶囊按钮（含负责人搜索下拉的触发器）用它。
 * 只换材质：圆角 / 内边距 / 字号与配色口径（青橙条色、状态色）一律不动。
 */
const GLASS_SURFACE =
  "border-zinc-200/90 bg-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-[3px] hover:border-zinc-300 hover:bg-white hover:shadow-[0_2px_6px_rgba(15,23,42,0.08)]";

/** 分段控件（粒度 / 缩放 / 行筛选）的轨道：与胶囊同一材质，但不带 hover 反馈 —— 悬停反馈留给里面的分段按钮。 */
const GLASS_TRACK = "border-zinc-200/90 bg-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-[3px]";

const ZOOM_LEVELS: ReadonlyArray<{ key: "compact" | "standard" | "wide"; label: string }> = [
  { key: "compact", label: "紧凑" },
  { key: "standard", label: "标准" },
  { key: "wide", label: "宽松" },
];

type ZoomKey = (typeof ZOOM_LEVELS)[number]["key"];

/**
 * 连续缩放基准（参考图一 / 图二，支持「日 / 周 / 月」自动切换 + 无级缩放）：
 * - 以「每天多少 px（dayWidth）」为唯一几何基准（范围 2.2px/天 ~ 52px/天）；
 * - 当「日 / 周 / 月」手动点击时跳到对应推荐档位；当点击「-/+」、滚轮 Ctrl+Wheel / Alt+Wheel 或双指缩放时，
 *   按倍率平滑缩放 dayWidth，并根据像素密度自动切换表头粒度（避免月视图太宽或日视图日期数字挤叠）：
 *   dayWidth >= 16 -> 日；7.5 <= dayWidth < 16 -> 周；dayWidth < 7.5 -> 月；
 * - 「自适应全览」一键将整个项目周期完整放进当前可视宽度（与参考图一/二一致）。
 */
type ScaleKey = "day" | "week" | "month";

const DAY_WIDTH_MIN = 2.2;
const DAY_WIDTH_MAX = 52;
const DAY_WIDTH_DEFAULT = 26;

const SCALES: Record<ScaleKey, { label: string; unitDays: number; dayWidth: Record<ZoomKey, number> }> = {
  day: { label: "日", unitDays: 1, dayWidth: { compact: 18, standard: 26, wide: 38 } },
  week: { label: "周", unitDays: 7, dayWidth: { compact: 9, standard: 13, wide: 15.5 } },
  month: { label: "月", unitDays: 30, dayWidth: { compact: 3.0, standard: 4.6, wide: 6.8 } },
};

const SCALE_KEYS: readonly ScaleKey[] = ["day", "week", "month"];

function scaleForDayWidth(pxPerDay: number): ScaleKey {
  if (pxPerDay >= 16) {
    return "day";
  }
  if (pxPerDay >= 7.5) {
    return "week";
  }
  return "month";
}

/** 甘特内筛选（B3-06 余下）：负责人 + 行筛选（全部 / 只看已延期）。 */
type RowFilterKey = "all" | "overdue";

const ROW_FILTERS: ReadonlyArray<{ key: RowFilterKey; label: string; hint: string }> = [
  { key: "all", label: "全部", hint: "不按行筛（只看负责人）" },
  { key: "overdue", label: "只看已延期", hint: "只出状态为「已延期」的任务（同 B3-05 的口径）" },
];

/**
 * 任务日期域（M3-07 刀 1 后半）：任务日期一律 ISO（YYYY-MM-DD，契约 DateOnly），年份带着走 ——
 * 原「演示模型固定按 2026 解释、拖动不许跨年」的夹取口径随「M月D日」演示模型一起下线，拖动不再有年份边界。
 */

/** 自绘滚动条：轨道两端留白、滑块最短长度（与 `ScrollArea` 同一套手感）。 */
const BAR_TRACK_INSET = 4;
const BAR_MIN_THUMB = 28;
/** 隐式滚动条停手后隐去的延时（与 `ScrollArea` 一致）。 */
const BAR_HIDE_DELAY = 900;

/**
 * 自绘滑块的几何：`track` = 轨道长度（竖向 = 容器高；横向那条固定在窗口底部，轨道 = 整个窗口宽）、
 * `viewport` = 可视长度、`content` = 内容长度、`scrolled` = 已滚距离；没有溢出 = null。
 */
function thumbMetrics(track: number, viewport: number, content: number, scrolled: number): { size: number; offset: number; progress: number } | null {
  const usable = track - BAR_TRACK_INSET * 2;
  if (usable <= 0 || content <= viewport + 1) {
    return null;
  }
  const size = Math.max(BAR_MIN_THUMB, Math.round((viewport / content) * usable));
  const maxScroll = content - viewport;
  const ratio = maxScroll <= 0 ? 0 : clampNumber(scrolled / maxScroll, 0, 1);
  return { size, offset: Math.round(ratio * (usable - size)), progress: Math.round(ratio * 100) };
}

/**
 * 横向那条固定在整个窗口底部（业务口径「要固定在全局 不然不方便」）：轨道 = 窗口可视宽。
 * 用 `documentElement.clientWidth` 而不是 `window.innerWidth` —— 后者含页面竖向滚动条的宽度，
 * 会让滑块右端钻到滚动条底下 / 位置算偏。
 */
function bottomBarTrack(): number {
  return document.documentElement.clientWidth;
}

/** 拖到边缘时的逐帧滚动速度：越深入边缘区越快（最低 1px，最高 DRAG_EDGE_MAX_SPEED）。 */
function edgeScrollSpeed(depth: number): number {
  return clampNumber((depth / DRAG_EDGE_PX) * DRAG_EDGE_MAX_SPEED, 1, DRAG_EDGE_MAX_SPEED);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function utcFromIso(iso: string): number {
  return Date.parse(iso + "T00:00:00Z");
}

function shiftDays(utc: number, days: number): number {
  return utc + days * DAY_MS;
}

/** UTC 零点毫秒 →「YYYY-MM-DD」。 */
function isoOf(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}

/** 拖动的落点（写回任务字段）：日期写回 ISO（契约 DateOnly）、天数 = 含首尾（与表格行内编辑同一口径）。 */
function rangePatch(start: number, end: number): TaskPatch {
  const startIso = isoOf(start);
  const endIso = isoOf(end);
  return {
    startDate: startIso,
    dueDate: endIso,
    days: daysBetweenInclusive(startIso, endIso),
  };
}

/** 两个 UTC 零点日期相差的天数。 */
function dayDiff(from: number, to: number): number {
  return Math.round((to - from) / DAY_MS);
}

/** 今天（本地日历日的 UTC 零点）—— 任务日期统一按 UTC 零点换算，两边同一尺度。 */
function localToday(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

function weekdayOf(utc: number): number {
  return new Date(utc).getUTCDay();
}

function dayOfMonth(utc: number): number {
  return new Date(utc).getUTCDate();
}

function monthTextOf(locale: Locale, utc: number): string {
  const date = new Date(utc);
  return monthYearText(locale, date.getUTCFullYear(), date.getUTCMonth() + 1);
}

/** 月粒度下排的月份文案（如「5月」—— 年份已经在上一行）。 */
function monthShortTextOf(locale: Locale, utc: number): string {
  return monthShortText(locale, new Date(utc).getUTCMonth() + 1);
}

/** 月粒度上排的年份文案（如「2026年」）。 */
function yearTextOf(locale: Locale, utc: number): string {
  return yearText(locale, new Date(utc).getUTCFullYear());
}

/** 周粒度下周列的文案（该周首日，如「5/18」）。 */
function shortDateTextOf(utc: number): string {
  const date = new Date(utc);
  return String(date.getUTCMonth() + 1) + "/" + String(date.getUTCDate());
}

type GanttBar = {
  task: ProjectTask;
  /** 所属规范阶段名（用于按阶段取色）。 */
  stage: string;
  status: TaskStatus;
  /** 0~100（task.progress 是 0~1 的四档小数）。 */
  percent: number;
  /** 开始 / 预计完成 / 实际完成（UTC 零点毫秒）；日期空串 = null。 */
  start: number | null;
  end: number | null;
  done: number | null;
  /** 单日任务（开始 = 预计完成）= 里程碑。 */
  milestone: boolean;
  /** 悬停提示（多行）。 */
  label: string;
};

type GanttGroup = {
  stage: string;
  bars: GanttBar[];
  /** 组内任务的工期并集（画阶段括弧汇总）；组内没有「开始 + 预计完成」都齐的任务 = null。 */
  start: number | null;
  end: number | null;
  doneCount: number;
  /** 完成度（已完成 / 组内任务数）—— 与项目总览阶段头的「已完成 N/M」同口径。 */
  percent: number;
  /** 该阶段是否处于折叠态。 */
  collapsed: boolean;
  /** 阶段内展开显示的子任务数（折叠态为 0，用于计算阶段包络底框高度）。 */
  expandedCount: number;
  /** 阶段内各任务预计所需施工人数合计（全部未填时为 0）。 */
  headcountTotal: number;
};

type GanttRow =
  | { kind: "group"; key: string; no: number; group: GanttGroup }
  | { kind: "task"; key: string; no: number; bar: GanttBar };

/** 表头分段（一段 = 表头里的一列）：days = 跨几天（列宽 = days × 每天宽度）、start = 首日在时间轴里的下标。 */
type GanttHeaderUnit = { key: string; label: string; days: number; start: number };

/** 月份段：多一个短文案（月粒度下排写「5月」，日 / 周粒度的上排写「2026年5月」）。 */
type GanttMonthUnit = GanttHeaderUnit & { short: string };

type GanttModel = {
  rows: GanttRow[];
  /** 时间轴首日（UTC 零点毫秒）与总天数（含右侧「无限延伸」余量）。 */
  rangeStart: number;
  days: number;
  /** 不含右侧无限延伸余量的天数（「全览」按它计算）。 */
  coreDays: number;
  /** 今天在时间轴里的下标（今天不在范围内 = null，不画今天虚线）。 */
  todayIndex: number | null;
  /** 表头分段：月份 / 年份 / 周 —— 粒度决定用哪一套渲染（官方 timelineHeader.scales）。 */
  months: ReadonlyArray<GanttMonthUnit>;
  years: ReadonlyArray<GanttHeaderUnit>;
  weeks: ReadonlyArray<GanttHeaderUnit>;
  /** 周末日下标（列底纹）与每周一 / 每月一号 / 每年一号下标（分隔线）。 */
  weekends: readonly number[];
  weekStarts: readonly number[];
  monthStarts: readonly number[];
  yearStarts: readonly number[];
  /** 所有阶段都折叠（工具条按钮文案用）—— 只算真的出了行的阶段（筛掉的空阶段不算）。 */
  allCollapsed: boolean;
};

/** 拖动会话的四种模式：整体平移 / 只动起点（改工期）/ 只动终点（改工期）/ 只改进度。 */
type GanttDragMode = "move" | "start" | "end" | "progress";

/**
 * 拖动会话（对齐官方 taskBar.moveable / resizable 与进度圆点）：
 * base* = 按下时的原值、start / end / percent = 拖动中的预览值 —— 每次 move 都从 base 重新算（避免逐帧累加误差），
 * 松手才写回任务字段；Esc 或 pointercancel 取消 = 不写回。
 */
type GanttDrag = {
  taskId: string;
  mode: GanttDragMode;
  /** 按下时的指针 clientX 与「每天多少 px」（拖动期间不会变）。 */
  originX: number;
  pxPerDay: number;
  baseStart: number;
  baseEnd: number;
  basePercent: number;
  start: number;
  end: number;
  percent: number;
};

/** 任务 → 甘特条：日期直接吃 ISO（契约 DateOnly，空串 = 未填）。 */
function buildBar(locale: Locale, task: ProjectTask): GanttBar {
  const rawStart = task.startDate === "" ? null : utcFromIso(task.startDate);
  const rawEnd = task.dueDate === "" ? null : utcFromIso(task.dueDate);
  const done = task.doneDate === "" ? null : utcFromIso(task.doneDate);
  // 两个日期都齐才画条（只填一个 = 未排期）；数据反了（开始晚于预计完成）按小 → 大画。
  const start = rawStart === null || rawEnd === null ? null : Math.min(rawStart, rawEnd);
  const end = rawStart === null || rawEnd === null ? null : Math.max(rawStart, rawEnd);
  const status = task.status;
  const percent = Math.max(0, Math.min(100, Math.round(task.progress * 100)));
  const owners = ownersLabel(task.owners);
  /** 悬停提示里的日期按「M月D日」展示（模型里存的是 ISO）。 */
  const dayText = (iso: string): string => (iso === "" ? "—" : mdText(locale, iso));
  const gap = isLocalizedLocale(locale) ? " · " : "　";
  const label = [
    task.title + (task.titleEn === "" ? "" : "（" + task.titleEn + "）"),
    textOf(locale, "gantt.tip.start", { date: dayText(task.startDate) }) + gap + textOf(locale, "gantt.tip.due", { date: dayText(task.dueDate) }),
    task.doneDate === "" ? "" : textOf(locale, "gantt.tip.done", { date: dayText(task.doneDate) }),
    textOf(locale, "gantt.tip.progress", { n: percent }) + gap + textOf(locale, "gantt.tip.status", { status: statusText(locale, status) }),
    textOf(locale, "gantt.tip.owners", { names: owners === "" ? textOf(locale, "gantt.owner.none") : owners }),
    textOf(locale, "gantt.tip.dragBar"),
  ]
    .filter((line) => line !== "")
    .join("\n");
  const stage = STAGE_ORDER.includes(task.stage) ? task.stage : UNGROUPED;
  return { task, stage, status, percent, start, end, done, milestone: start !== null && end !== null && start === end, label };
}

/**
 * 建时间轴模型：没有任何「开始 + 预计完成」都齐的任务 = 返回 null（画不出时间轴）。
 * hideEmptyGroups = 正在筛选：阶段行只出真的有命中任务的阶段（筛完不再挂一排空阶段骨架）。
 * includeToday = 「回到今天」把今天并进范围（今天本来就在范围里 = 无影响，见下面的注释）。
 */
function buildModel(
  locale: Locale,
  tasks: readonly ProjectTask[],
  stageOrder: readonly string[],
  today: number,
  collapsed: Record<string, boolean>,
  hideEmptyGroups: boolean,
  includeToday: boolean,
  /** 右侧无限延伸的额外天数（滚动到右缘时累加）。 */
  extraEndDays: number,
  viewport?: { start: number; end: number },
): GanttModel | null {
  const bars = tasks.map((task) => buildBar(locale, task));

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const bar of bars) {
    if (bar.start === null || bar.end === null) {
      continue;
    }
    min = Math.min(min, bar.start, bar.end);
    max = Math.max(max, bar.start, bar.end);
  }
  if (bars.length === 0) {
    return null;
  }
  if (min === Number.POSITIVE_INFINITY) {
    // 全部未排期：仍画出甘特图（默认以今天为中心的窗口），未排期行在时间轴上只显示小图标。
    min = shiftDays(today, -14);
    max = shiftDays(today, 45);
  }
  /*
   * 时间轴范围默认 = 筛选后任务的范围（业务口径「时间轴范围跟着筛完剩下的任务走」）—— 所以筛到一个任务全在过去（或全在将来）
   * 的负责人时，今天会落在范围外。业务口径「为什么筛选后不能选择回到今天」：这时「回到今天」不再置灰，而是把今天并进范围
   * （includeToday）再居中，今天线也跟着画出来；不点就仍是紧致范围（范围一直不变时 includeToday 没有副作用）。
   */
  if (includeToday) {
    min = Math.min(min, today);
    max = Math.max(max, today);
  }

  const rangeStart = Math.min(shiftDays(min, -PAD_DAYS), viewport?.start ?? Number.POSITIVE_INFINITY);
  /** 任务真实跨度末端（含 2 天余量 / 当前可视区右缘）—— 右侧无限延伸从它继续往右加。 */
  const rangeEndCore = Math.max(shiftDays(max, PAD_DAYS), viewport?.end ?? Number.NEGATIVE_INFINITY);
  const rangeEnd = shiftDays(rangeEndCore, Math.max(0, extraEndDays));
  const days = dayDiff(rangeStart, rangeEnd) + 1;
  const coreDays = dayDiff(rangeStart, rangeEndCore) + 1;
  const todayIndex = today >= rangeStart && today <= rangeEnd ? dayDiff(rangeStart, today) : null;

  // 表头三套分段（日 / 周 / 月粒度各取所需）：月份、年份、周 —— 每段记下首日下标与跨的天数，列宽 = 天数 × 每天宽度。
  const months: Array<GanttMonthUnit> = [];
  const years: Array<GanttHeaderUnit> = [];
  const weeks: Array<GanttHeaderUnit> = [];
  const weekends: number[] = [];
  const weekStarts: number[] = [];
  const monthStarts: number[] = [];
  const yearStarts: number[] = [];
  for (let index = 0; index < days; index += 1) {
    const utc = shiftDays(rangeStart, index);
    const weekday = weekdayOf(utc);
    const label = monthTextOf(locale, utc);
    const last = months[months.length - 1];
    if (last !== undefined && last.label === label) {
      last.days += 1;
    } else {
      months.push({ key: "month-" + String(index), label, short: monthShortTextOf(locale, utc), days: 1, start: index });
    }
    const yearLabel = yearTextOf(locale, utc);
    const lastYear = years[years.length - 1];
    if (lastYear !== undefined && lastYear.label === yearLabel) {
      lastYear.days += 1;
    } else {
      years.push({ key: "year-" + String(index), label: yearLabel, days: 1, start: index });
    }
    // 周列：每周一开新列（时间轴两端有 PAD_DAYS 余量，首列 / 末列可能不满一周，不硬凑整周）。
    const lastWeek = weeks[weeks.length - 1];
    if (lastWeek === undefined || weekday === 1) {
      weeks.push({ key: "week-" + String(index), label: shortDateTextOf(utc), days: 1, start: index });
    } else {
      lastWeek.days += 1;
      if (lastWeek.days === 7) {
        lastWeek.label = shortDateTextOf(shiftDays(rangeStart, lastWeek.start)) + " - " + shortDateTextOf(utc);
      }
    }
    if (weekday === 0 || weekday === 6) {
      weekends.push(index);
    }
    if (weekday === 1) {
      weekStarts.push(index);
    }
    if (dayOfMonth(utc) === 1) {
      monthStarts.push(index);
      if (new Date(utc).getUTCMonth() === 0) {
        yearStarts.push(index);
      }
    }
  }

  // 分组 = 阶段（九个阶段按项目总览顺序 + 有内容才出现的「临时任务」，与项目总览最后一组同口径）。
  const byStage = new Map<string, GanttBar[]>();
  for (const bar of bars) {
    const stage = stageOrder.includes(bar.task.stage) ? bar.task.stage : UNGROUPED;
    const list = byStage.get(stage);
    if (list === undefined) {
      byStage.set(stage, [bar]);
    } else {
      list.push(bar);
    }
  }
  const stageNames: string[] = [...stageOrder];
  if (byStage.has(UNGROUPED)) {
    stageNames.push(UNGROUPED);
  }

  const rows: GanttRow[] = [];
  let no = 0;
  let visibleStages = 0;
  let collapsedCount = 0;
  for (const stage of stageNames) {
    const items = byStage.get(stage) ?? [];
    if (hideEmptyGroups && items.length === 0) {
      continue;
    }
    visibleStages += 1;
    let start: number | null = null;
    let end: number | null = null;
    for (const bar of items) {
      if (bar.start === null || bar.end === null) {
        continue;
      }
      start = start === null ? bar.start : Math.min(start, bar.start);
      end = end === null ? bar.end : Math.max(end, bar.end);
    }
    const doneCount = items.filter((bar) => isTaskDone(bar.task)).length;
    const headcountTotal = items.reduce((sum, bar) => sum + (bar.task.headcount > 0 ? bar.task.headcount : 0), 0);
    const percent = items.length === 0 ? 0 : Math.round((doneCount / items.length) * 100);
    const isCollapsed = collapsed[stage] === true;
    // 行号：阶段行也占一个号（与参考样例的行号列一致）。
    no += 1;
    if (isCollapsed) {
      collapsedCount += 1;
    }
    rows.push({ kind: "group", key: "stage:" + stage, no, group: { stage, bars: items, start, end, doneCount, percent, collapsed: isCollapsed, expandedCount: isCollapsed ? 0 : items.length, headcountTotal } });
    if (isCollapsed) {
      continue;
    }
    for (const bar of items) {
      no += 1;
      rows.push({ kind: "task", key: "task:" + bar.task.id, no, bar });
    }
  }

  return {
    rows,
    rangeStart,
    days,
    coreDays,
    todayIndex,
    months,
    years,
    weeks,
    weekends,
    weekStarts,
    monthStarts,
    yearStarts,
    allCollapsed: visibleStages > 0 && collapsedCount === visibleStages,
  };
}

/** 工具条「回到今天」：把横向滚动位置挪到今天附近（今天落在时间轴**可视区**左 1/3 处；今天不在时间轴内 = 不动 ——
 * 那种情况下调用方（goToToday）会先把今天并进时间轴范围，再调这里）。
 * 打开视图时不自动滚动 —— 时间轴默认停在项目最早的任务那头（同参考样例），今天的虚线用这个按钮一键回位。
 * 左表 sticky 压着滚动容器左沿，可视的时间轴宽度与位置都要扣掉左表宽度。 */
function centerOnToday(element: HTMLDivElement | null, todayLeft: number | null, leftWidth: number): void {
  if (element === null || todayLeft === null) {
    return;
  }
  // 左表 sticky 压在容器左沿：可视的时间轴宽度要扣掉左表；时间轴面板自己的坐标系从 0 开始，所以只扣宽度、不再减偏移。
  const visible = Math.max(element.clientWidth - leftWidth, 0);
  element.scrollLeft = Math.max(0, todayLeft - visible / 3);
}

/**
 * 任务条编辑锁图标：两个独立图形 —— 锁住 = 红色闭合锁（#d81e06）、解开 = 蓝色打开锁（#1296db）。
 */
function GanttLockIcon({ locked }: { locked: boolean }) {
  if (locked) {
    return (
      <svg viewBox="0 0 1024 1024" className="h-4 w-4" aria-hidden="true">
        <path
          d="M385.150849 385.662338l-128.895105 0 0-150.377622q0-49.102897 19.436563-91.556444t53.706294-74.677323 80.815185-50.637363 101.786214-18.413586q49.102897 0 94.625375 18.413586t80.815185 50.637363 56.263736 74.677323 20.971029 91.556444l0 150.377622-123.78022 0 0-121.734266q0-64.447552-35.804196-99.74026t-97.182817-35.292707q-55.240759 0-88.999001 35.292707t-33.758242 99.74026l0 121.734266zM826.053946 447.040959q27.62038 0 47.568432 19.948052t19.948052 47.568432l0 317.122877q0 27.62038-9.718282 51.66034t-26.597403 41.942058-39.896104 28.131868-50.637363 10.22977l-516.603397 0q-27.62038 0-50.125874-10.22977t-38.361638-27.108891-24.551449-39.384615-8.695305-48.07992l0-324.283716q0-27.62038 19.436563-47.568432t47.056943-19.948052l61.378621 0 128.895105 0 255.744256 0 123.78022 0 61.378621 0z"
          fill="#d81e06"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 1024 1024" className="h-4 w-4" aria-hidden="true">
      <path
        d="M768.25422 0q48.810328 0 94.061569 18.303873t80.333664 50.33565 56.436941 74.740814 21.354518 91.519364l0 150.49851-123.042701 0 0-122.025819q0-64.063555-36.099305-99.654419t-97.112214-35.590864q-54.911619 0-88.468719 35.590864t-33.5571 99.654419l0 124.059583-128.12711 0 0-152.532274q0-48.810328 19.320755-91.519364t53.386296-74.740814 80.333664-50.33565 101.179742-18.303873zM766.220457 693.513406l0 87.451837 0 47.793446q0 27.455809-9.660377 51.860973t-26.438928 41.692155-39.658391 27.455809-50.33565 10.168818l-514.542205 0q-27.455809 0-49.82721-9.660377t-38.641509-26.438928-24.913605-39.14995-8.643496-47.793446l0-323.368421q0-28.472691 19.829196-47.793446t46.268123-19.320755l629.449851 0q28.472691 0 47.793446 19.320755t19.320755 47.793446l0 179.988083z"
        fill="#1296db"
      />
    </svg>
  );
}

/**
 * 甘特图全屏图标（业务口径 2026-11-27「甘特图左侧新加图片 全屏按钮」）：
 * 图形取自业务提供的四角框 SVG（品牌蓝 #1296db），进入 / 退出全屏共用同一枚按钮。
 */
function GanttFullscreenIcon() {
  return (
    <svg viewBox="0 0 1024 1024" className="h-4 w-4" aria-hidden="true">
      <path d="M0 0h256v51.2H0z" fill="#1296db" />
      <path d="M51.2 0v256H0V0zM1024 0v256h-51.2V0z" fill="#1296db" />
      <path d="M1024 51.2h-256V0h256zM1024 1024h-256v-51.2h256z" fill="#1296db" />
      <path d="M972.8 1024v-256h51.2v256zM0 1024v-256h51.2v256z" fill="#1296db" />
      <path d="M0 972.8h256v51.2H0z" fill="#1296db" />
    </svg>
  );
}

/** 甘特编辑锁记忆键：按登录账号隔离（同机换账号不串用；与仪表盘筛选记忆同一套键口径）。 */
function ganttLockKey(viewerId: string): string {
  return "libiaolink.gantt.barsLocked.v1." + (viewerId === "" ? "anon" : viewerId);
}

/**
 * 甘特图视图（项目详情第二个标签页）。数据 = 项目任务列表同一份（服务端任务接口）；
 * 传了 onPatchTask / onSetProgress 就能拖动改期 / 改进度（不传 = 拖动照常预览、松手不写回）。
 * members = 人员目录（负责人筛选项的成员行渲染）。
 */
export function GanttChart({ tasks, members, viewerId = "", stageOrder = STAGE_ORDER, tierTint = false, onPatchTask, onSetProgress }: { tasks: readonly ProjectTask[]; members: readonly Member[]; /** 当前登录账号（锁状态按账号记住用；空 = 未登录兜底）。 */ viewerId?: string; stageOrder?: readonly string[]; /** 背景档位（适中 / 炫彩；空态兜底列表的行色与项目页任务行的铺色同口径，Push 294）。 */ tierTint?: TintedTier | false; onPatchTask?: (taskId: string, patch: TaskPatch) => void; onSetProgress?: (taskId: string, progress: number) => void }) {
  const locale = useLocale();
  const localize = useLocalizedTranslator();
  /** 手打内容（任务名）机翻显示：英文界面 titleEn 优先 → 机翻 → 原文；中文界面照旧。 */
  const ganttTitle = (task: ProjectTask): string => (isLocalizedLocale(locale) ? (locale === "en" && task.titleEn !== "" ? task.titleEn : localize(task.title)) : task.title);
  const t = useT();
  const today = useMemo(localToday, []);
  /** 连续每天宽度（px/day）：唯一几何缩放基准，支持无级滚轮缩放、步进缩放、自适应全览与日/周/月快捷切换。 */
  const [dayWidthRaw, setDayWidthRaw] = useState<number>(DAY_WIDTH_DEFAULT);
  /** 允许用户点击「日 / 周 / 月」时锁定/切换粒度，或由连续缩放自动派生粒度。 */
  const [scale, setScale] = useState<ScaleKey>("day");
  /** 甘特内行筛选（全部 / 只看已延期）。 */
  const [rowFilter, setRowFilter] = useState<RowFilterKey>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** 悬停行（左表与时间轴同一行一起高亮）。 */
  const [hovered, setHovered] = useState<string | null>(null);
  /** 悬停的任务条（官方 hoverBarStyle：指针真的落在条上才给条盖一层遮罩）。 */
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);
  /** 选中的任务条（官方 taskBar.selectable）：点条选中、点空白 / Esc 取消。 */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 拖动会话：预览值挂在 state 上，松手才写回任务字段。 */
  const [drag, setDrag] = useState<GanttDrag | null>(null);
  /** 任务条编辑锁：默认锁上，防止误拖改期 / 工期 / 进度；滚动、筛选、定位等浏览操作不受影响。 */
  const [barsLocked, setBarsLocked] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return window.localStorage.getItem(ganttLockKey(viewerId)) === "true";
    } catch {
      return false;
    }
  });
  /** 「回到今天」把今天并进时间轴范围（今天本来就在范围里 = 无影响）；清空筛选时收回。 */
  const [includeToday, setIncludeToday] = useState(false);
  /** 刚点「回到今天」但当时今天不在范围里：等范围延出来（todayLeft 有值）再居中一次。 */
  const [pendingToday, setPendingToday] = useState(false);
  /** 时间轴右侧无限延伸的天数：滚动接近右缘时按 120 天加长（仅前端渲染，不写库）。 */
  const [extraEndDays, setExtraEndDays] = useState(0);
  /** 左表「进展」四格胶囊的悬停档位（0 = 无）。 */
  const [trackerHover, setTrackerHover] = useState(0);
  /** 左表宽度（官方 frame.verticalSplitLineMoveable：拖左表右边线改宽窄），双击复位默认宽。 */
  const [leftWidth, setLeftWidth] = useState(LEFT_W_DEFAULT);
  const [splitHover, setSplitHover] = useState(false);
  const [splitActive, setSplitActive] = useState(false);
  /** 拖空白平移画面：拖动期间换抓手光标并禁掉文字选区。 */
  const [panActive, setPanActive] = useState(false);
  /** 自绘滚动条的两根滑块（null = 该方向没有溢出）；竖向隐式、横向固定常驻。 */
  const [vBar, setVBar] = useState<{ size: number; offset: number; progress: number } | null>(null);
  const [hBar, setHBar] = useState<{ size: number; offset: number; progress: number } | null>(null);
  const [barActive, setBarActive] = useState(false);
  const barHideTimerRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const splitRef = useRef<{ originX: number; base: number } | null>(null);
  const panRef = useRef<{ pointerId: number; originX: number; originY: number; baseLeft: number; baseTop: number; moved: boolean } | null>(null);
  /** 平移收尾那一下补出来的 click：挡在容器捕获层（见 swallowClickAfterPan）。 */
  const panJustEndedRef = useRef(false);
  /** 拖条期间的指针位置与「按下时画面滚到哪儿了」：边缘自动滚动要靠它把滚动换算成日期位移。 */
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragScrollBaseRef = useRef(0);
  /** 连续缩放时锚定指针/视口中心所在日期：dayWidth 生效后立即还原 scrollLeft，确保缩放不漂移。 */
  const pendingScrollLeftRef = useRef<number | null>(null);
  /** 刚拖完那一下（拖动收尾浏览器会补一个 click）：用来挡掉「拖完顺手把选中清掉」。 */
  const justDraggedRef = useRef(false);
  /** 甘特图全屏（2026-11-27）：shell 包住工具条 + 图表；优先浏览器 Fullscreen API，失败退页内覆盖层。 */
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const fullscreen = nativeFullscreen || cssFullscreen;

  const dayWidth = clampNumber(dayWidthRaw, DAY_WIDTH_MIN, DAY_WIDTH_MAX);
  const zoomPercent = Math.round((dayWidth / DAY_WIDTH_DEFAULT) * 100);
  const nearestZoomKey: ZoomKey =
    Math.abs(dayWidth - SCALES[scale].dayWidth.compact) <= Math.abs(dayWidth - SCALES[scale].dayWidth.standard)
      ? "compact"
      : Math.abs(dayWidth - SCALES[scale].dayWidth.wide) < Math.abs(dayWidth - SCALES[scale].dayWidth.standard)
        ? "wide"
        : "standard";
  const applyDayWidth = useCallback(
    (nextWidth: number, anchorClientX?: number, forceScale?: ScaleKey) => {
      const clamped = clampNumber(Math.round(nextWidth * 100) / 100, DAY_WIDTH_MIN, DAY_WIDTH_MAX);
      const nextScale = forceScale ?? scaleForDayWidth(clamped);
      const node = scrollRef.current;
      if (node !== null && clamped !== dayWidth) {
        const rect = node.getBoundingClientRect();
        const timelineVisibleWidth = Math.max(node.clientWidth - leftWidth, 1);
        const pointerOffsetInTimeline =
          anchorClientX !== undefined
            ? clampNumber(anchorClientX - rect.left - leftWidth, 0, timelineVisibleWidth)
            : timelineVisibleWidth / 2;
        const anchorDay = (node.scrollLeft + pointerOffsetInTimeline) / dayWidth;
        pendingScrollLeftRef.current = Math.max(0, anchorDay * clamped - pointerOffsetInTimeline);
      }
      setDayWidthRaw(clamped);
      setScale(nextScale);
    },
    [dayWidth, leftWidth],
  );
  /** 粒度 / 缩放 / 行筛选的显示名（Push 301 词典；模块常量只留 key）。 */
  const scaleText = (key: ScaleKey): string => t(key === "day" ? "gantt.scale.day" : key === "week" ? "gantt.scale.week" : "gantt.scale.month");
  const rowFilterText = (key: RowFilterKey): string => t(key === "all" ? "gantt.rowFilter.all" : "gantt.rowFilter.overdue");
  const rowFilterHint = (key: RowFilterKey): string => t(key === "all" ? "gantt.rowFilter.all.hint" : "gantt.rowFilter.overdue.hint");

  /** 筛选后的任务：时间轴范围、阶段汇总、左表行数全部跟着它走（业务口径「甘特内筛选」）。 */
  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (rowFilter === "overdue" && task.status !== "已延期") {
        return false;
      }
      return true;
    });
  }, [tasks, rowFilter]);

  const filtering = rowFilter !== "all";
  const viewportKey = [rowFilter, scale, Math.round(dayWidth * 100), leftWidth, includeToday].join("|");
  /** 筛选 / 缩放 / 左表宽度 / 回到今天 变化时收回右侧延伸，回到紧致时间轴。 */
  useEffect(() => {
    setExtraEndDays(0);
  }, [viewportKey]);
  const viewportKeyRef = useRef(viewportKey);
  const model = useMemo(() => {
    const node = scrollRef.current;
    const keepViewport = viewportKeyRef.current === viewportKey;
    viewportKeyRef.current = viewportKey;
    const origin = Number(node?.dataset.liveDateOrigin);
    const previousDayWidth = Number(node?.dataset.liveDateWidth);
    // A short chart may have no scrollbar yet. Retain its visible dates as well,
    // so an earlier remote task cannot clamp the restored horizontal position.
    const viewport = keepViewport && node !== null && Number.isFinite(origin) && previousDayWidth > 0
      ? {
        start: origin + Math.floor(node.scrollLeft / previousDayWidth) * DAY_MS,
        end: origin + Math.ceil((node.scrollLeft + Math.max(0, node.clientWidth - leftWidth)) / previousDayWidth) * DAY_MS,
      }
      : undefined;
    return buildModel(locale, visibleTasks, stageOrder, today, collapsed, filtering, includeToday, extraEndDays, viewport);
  }, [visibleTasks, stageOrder, today, collapsed, filtering, includeToday, extraEndDays, viewportKey, leftWidth, locale]);
  const weekendSet = useMemo(() => new Set(model === null ? [] : model.weekends), [model]);

  /**
   * 任务列表（Push 294）的分组（Push 295，业务口径「也要分类可以折叠 在甘特图里」+「要有阶段标题分类的」）：
   * 口径同左表 / 项目总览 —— 九个阶段按顺序 + 「临时任务」垫底、只出有任务的分组；
   * 折叠状态与左表共用同一份 `collapsed`（列表箭头 / 左表箭头 / 工具栏「全部折叠 / 全部展开」三处联动）。
   */
  const listGroups = [...stageOrder, UNGROUPED]
    .map((stage) => ({
      stage,
      items: visibleTasks.filter((task) => (stageOrder.includes(task.stage) ? task.stage : UNGROUPED) === stage),
    }))
    .filter((group) => group.items.length > 0);
  const listStages = listGroups.map((group) => group.stage);
  const listAllCollapsed = listStages.length > 0 && listStages.every((stage) => collapsed[stage] === true);
  /** 工具栏「全部折叠 / 全部展开」的当前态：能画时间轴看左表阶段集；画不出（model === null）看列表分组。 */
  const allCollapsedNow = model === null ? listAllCollapsed : model.allCollapsed;

  const todayIndex = model === null ? null : model.todayIndex;
  const todayLeft = todayIndex === null ? null : todayIndex * dayWidth + dayWidth / 2;

  /** 周 / 月粒度下排的表头分段（日粒度没有分段 —— 逐日渲染，见下面的表头）。 */
  const headerUnits: ReadonlyArray<GanttHeaderUnit> | null =
    model === null || scale === "day"
      ? null
      : scale === "week"
        ? model.weeks
        : model.months.map((month) => ({ key: month.key, label: month.short, days: month.days, start: month.start }));
  /** 今天落在下排哪一列（周 / 月粒度给整列加一档蓝底；日粒度按当天那格，见下）。 */
  const todayUnitIndex =
    todayIndex === null || headerUnits === null
      ? null
      : headerUnits.findIndex((unit) => todayIndex >= unit.start && todayIndex < unit.start + unit.days);

  /** 「回到今天」点了之后范围才延到今天：等 todayLeft 有值再居中一次（范围没变 / 没这个挂起标记时什么都不做）。 */
  useEffect(() => {
    if (!pendingToday || todayLeft === null) {
      return;
    }
    centerOnToday(scrollRef.current, todayLeft, leftWidth);
    setPendingToday(false);
  }, [pendingToday, todayLeft, leftWidth]);

  /** 连续缩放后把锚点日期精确对齐回原视口坐标（避免缩放后时间轴跳走）。 */
  useEffect(() => {
    if (pendingScrollLeftRef.current === null) {
      return;
    }
    const targetLeft = pendingScrollLeftRef.current;
    pendingScrollLeftRef.current = null;
    const node = scrollRef.current;
    if (node !== null) {
      node.scrollLeft = targetLeft;
      syncScrollbars();
    }
  }, [dayWidth, scale]);

  /** 按 Ctrl/Meta/Alt + 滚轮（或触控板双指捏合，浏览器默认以 ctrlKey wheel 事件派发）连续缩放时间轴。 */
  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) {
      return undefined;
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        return;
      }
      event.preventDefault();
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      if (delta === 0) {
        return;
      }
      // 指数倍率缩放（触控板细腻、鼠标滚轮每格约 12%）
      const factor = Math.exp(-clampNumber(delta, -120, 120) * 0.0022);
      applyDayWidth(dayWidth * factor, event.clientX);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
    };
  }, [applyDayWidth, dayWidth]);

  /** Esc = 取消拖动（不写回、回到原日期）并清掉选中。 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setDrag(null);
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  /** 进全屏：优先浏览器 Fullscreen API（Esc 由浏览器原生退出）；不支持 / 被拒绝 / 假成功时退化为页内覆盖层。 */
  const enterFullscreen = useCallback(() => {
    const node = shellRef.current;
    if (node === null) {
      return;
    }
    if (typeof node.requestFullscreen !== "function" || document.fullscreenEnabled === false) {
      setCssFullscreen(true);
      return;
    }
    try {
      const request = node.requestFullscreen();
      if (request === undefined) {
        // 旧内核的同步式 requestFullscreen：没有 Promise 可等，交给 fullscreenchange 反映真实状态。
        return;
      }
      void request
        .then(() => {
          // 部分环境（自动化 / 权限策略 / 浏览器外壳）会 resolve 却立刻被系统收回：
          // 250ms 后真实全屏元素不是 shell 就切页内覆盖层，避免「点了没反应」。
          window.setTimeout(() => {
            if (document.fullscreenElement !== node) {
              setCssFullscreen(true);
            }
          }, 250);
        })
        .catch(() => {
          setCssFullscreen(true);
        });
    } catch {
      setCssFullscreen(true);
    }
  }, []);

  /** 退全屏：页内覆盖层与浏览器原生全屏一起收。 */
  const exitFullscreen = useCallback(() => {
    setCssFullscreen(false);
    if (document.fullscreenElement !== null && typeof document.exitFullscreen === "function") {
      void document.exitFullscreen().catch(() => {
        // 退出失败时浏览器仍会派发 fullscreenchange，状态跟着实际全屏元素走。
      });
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (nativeFullscreen || cssFullscreen) {
      exitFullscreen();
      return;
    }
    enterFullscreen();
  }, [cssFullscreen, enterFullscreen, exitFullscreen, nativeFullscreen]);

  /** 浏览器原生全屏状态以 fullscreenchange 为准（含用户按 Esc / 浏览器 UI 退出）。 */
  useEffect(() => {
    const onChange = () => {
      setNativeFullscreen(document.fullscreenElement === shellRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, []);

  /** Esc = 退出页内覆盖层兜底（原生全屏由浏览器自己退出）；全屏只走按钮开关，不再占用 Ctrl + 空格。 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCssFullscreen(false);
      }
    };
    // 捕获阶段先拿 Esc，避免页面内其他键盘处理 stopPropagation 把退出吞掉。
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  const toggleStage = (stage: string) => {
    setCollapsed((previous) => ({ ...previous, [stage]: previous[stage] !== true }));
  };

  /** 清空甘特内行筛选（回到「全部」），并把「回到今天」延出来的范围收回去。 */
  const clearFilters = () => {
    setRowFilter("all");
    setIncludeToday(false);
  };

  /**
   * 「回到今天」（业务口径「为什么筛选后不能选择回到今天」）：今天已在时间轴范围内 = 直接居中；
   * 今天在范围外（筛掉今天附近的任务后范围跟着剩下的任务走）= 先把今天并进范围，范围延出来后再居中一次。
   * 所以这个按钮只在「画不出时间轴」（没有排期齐的任务）时才置灰。
   */
  const goToToday = () => {
    if (todayIndex === null) {
      setIncludeToday(true);
      setPendingToday(true);
      return;
    }
    centerOnToday(scrollRef.current, todayLeft, leftWidth);
  };

  /** 自适应全览：把当前项目排期全跨度正好放进右侧时间轴可视区，并自动匹配合适的日/周/月表头。 */
  const fitToView = () => {
    if (model === null) {
      return;
    }
    const node = scrollRef.current;
    const visibleTimelineWidth = node === null ? 680 : Math.max(node.clientWidth - leftWidth - 24, 180);
    // 估算实际任务跨度（略去两端余量后留出右侧标签空间）
    const fittedDayWidth = visibleTimelineWidth / Math.max(model.coreDays, 1);
    const clamped = clampNumber(Math.round(fittedDayWidth * 100) / 100, DAY_WIDTH_MIN, DAY_WIDTH_MAX);
    pendingScrollLeftRef.current = 0;
    setDayWidthRaw(clamped);
    setScale(scaleForDayWidth(clamped));
  };

  const toggleAll = () => {
    if (allCollapsedNow) {
      setCollapsed({});
      return;
    }
    /*
     * 画不出时间轴（model === null）：这枚按钮管的是任务列表的分组（Push 295，原先在空态下是空操作）；
     * 能画时照旧收左表全部阶段行 —— 列表分组是左表阶段集的子集，两边一起收。
     */
    const next: Record<string, boolean> = {};
    if (model === null) {
      for (const stage of listStages) {
        next[stage] = true;
      }
    } else {
      for (const row of model.rows) {
        if (row.kind === "group") {
          next[row.group.stage] = true;
        }
      }
    }
    setCollapsed(next);
  };

  /** 锁图标一键切换：锁上时立即结束正在进行的拖动，避免松手后继续写回。 */
  const toggleBarsLocked = () => {
    const next = !barsLocked;
    if (!barsLocked) {
      setDrag(null);
      dragPointerRef.current = null;
    }
    setBarsLocked(next);
    try {
      window.localStorage.setItem(ganttLockKey(viewerId), next ? "true" : "false");
    } catch {
      // localStorage 不可用（隐私模式）时静默降级，仅本次会话生效。
    }
  };

  /** 任务条提示：锁定时去掉拖动说明，换成解锁提示；解锁时沿用完整操作说明。 */
  const barTitleOf = (bar: GanttBar): string => {
    const capabilities = taskCapabilitiesOf(bar.task);
    const permitted = bar.task.finalizedAt === null && capabilities.canEditFields;
    return barsLocked || !permitted
      ? bar.label.split("\n").filter((line) => line !== t("gantt.tip.dragBar")).concat(t("gantt.lock.lockedTip")).join("\n")
      : bar.label;
  };

  /**
   * 按下任务条（官方 taskBar.moveable / resizable / 进度圆点）：按按下的是哪一块决定这一拖改什么 ——
   * 条上圆点 = 改进度，条两端 6px = 改那一端的日期（改工期），其余 = 整条平移（工期不变）。
   * 三种都只先改预览值，松手才写回；指针捕获失败也不影响（move / up 挂在条自己身上）。
   */
  const beginDrag = (event: ReactPointerEvent<HTMLElement>, bar: GanttBar, mode: GanttDragMode) => {
    const capabilities = taskCapabilitiesOf(bar.task);
    const permitted = bar.task.finalizedAt === null &&
      (mode === "progress" ? capabilities.canUpdateProgress : capabilities.canEditFields);
    if (barsLocked || !permitted) {
      event.stopPropagation();
      return;
    }
    if (bar.start === null || bar.end === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // 清掉页面里残留的选区：命中浮标文字时浏览器会把我们画的深色浮标高亮成蓝底白字。
    window.getSelection()?.removeAllRanges();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 捕获失败 = 指针移出条之后收不到 move；条内拖动照常。
    }
    setSelectedId(bar.task.id);
    justDraggedRef.current = false;
    dragPointerRef.current = { x: event.clientX, y: event.clientY };
    dragScrollBaseRef.current = scrollRef.current === null ? 0 : scrollRef.current.scrollLeft;
    setDrag({
      taskId: bar.task.id,
      mode,
      originX: event.clientX,
      pxPerDay: dayWidth,
      baseStart: bar.start,
      baseEnd: bar.end,
      basePercent: bar.percent,
      start: bar.start,
      end: bar.end,
      percent: bar.percent,
    });
  };

  /**
   * 拖动预览的唯一算法：每次都从 base 出发重算（不累加），只按「起点不晚于终点」夹住（日期是 ISO，不再有年份边界）。
   * 入参是**等效 clientX** —— 画面滚了多少 = 指针在日期轴上等效多走多少（边缘自动滚动、拖动途中滚画面都走这条），
   * 条因此始终跟着指针，也才可能一次拖到当前屏幕外的日期。
   */
  const applyDrag = (clientX: number) => {
    const element = scrollRef.current;
    const scrolled = element === null ? 0 : element.scrollLeft - dragScrollBaseRef.current;
    setDrag((previous) => {
      if (previous === null) {
        return null;
      }
      const deltaDays = Math.round((clientX + scrolled - previous.originX) / previous.pxPerDay);
      if (previous.mode === "progress") {
        // 进度圆点：条宽（含首尾）= 100%，按四档吸附（0 / 25 / 50 / 75 / 100），与四格进度条同口径。
        const widthDays = dayDiff(previous.baseStart, previous.baseEnd) + 1;
        const step = Math.round(clampNumber(previous.basePercent + (deltaDays * 100) / widthDays, 0, 100) / (100 / PROGRESS_STEPS));
        return { ...previous, percent: clampNumber((step * 100) / PROGRESS_STEPS, 0, 100) };
      }
      if (previous.mode === "start") {
        // 只动起点：不许越过终点（单日任务拖左端仍是单日）。
        return { ...previous, start: Math.min(shiftDays(previous.baseStart, deltaDays), previous.baseEnd), end: previous.baseEnd };
      }
      if (previous.mode === "end") {
        // 只动终点：不许越过起点。
        return { ...previous, start: previous.baseStart, end: Math.max(shiftDays(previous.baseEnd, deltaDays), previous.baseStart) };
      }
      // 整条平移：工期不变，两端一起挪。
      const span = dayDiff(previous.baseStart, previous.baseEnd);
      const start = shiftDays(previous.baseStart, deltaDays);
      return { ...previous, start, end: shiftDays(start, span) };
    });
  };

  /** 条上的 pointermove：先记住指针位置（边缘自动滚动要用），再交给同一套算法。 */
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (barsLocked) {
      return;
    }
    dragPointerRef.current = { x: event.clientX, y: event.clientY };
    applyDrag(event.clientX);
  };

  /**
   * 拖条时的边缘自动滚动（业务口径「拖动进度条要移动 也要可以移画面」）：指针停在时间轴左右边缘区内时，
   * 按进入深度逐帧滚容器，并让条跟着新滚到的位置重算日期 —— 一次拖动能把条放到当前屏幕外的日期上；
   * 指针停着不动也照样滚。循环只在拖动期间存在（松手 / Esc / pointercancel 即停）。
   */
  const barDragging = drag !== null;
  useEffect(() => {
    if (!barDragging) {
      return undefined;
    }
    let raf = window.requestAnimationFrame(function tick() {
      raf = window.requestAnimationFrame(tick);
      const element = scrollRef.current;
      const pointer = dragPointerRef.current;
      if (element === null || pointer === null) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const before = element.scrollLeft;
      if (pointer.x < rect.left + DRAG_EDGE_PX) {
        element.scrollLeft = before - edgeScrollSpeed(rect.left + DRAG_EDGE_PX - pointer.x);
      } else if (pointer.x > rect.right - DRAG_EDGE_PX) {
        element.scrollLeft = before + edgeScrollSpeed(pointer.x - (rect.right - DRAG_EDGE_PX));
      }
      if (element.scrollLeft !== before) {
        applyDrag(pointer.x);
      }
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [barDragging]);

  /** 松手写回：进度走 onSetProgress（与四格进度条同一套状态联动）、日期走 onPatchTask；没动过 = 不写。 */
  const endDrag = () => {
    if (barsLocked) {
      setDrag(null);
      dragPointerRef.current = null;
      return;
    }
    const session = drag;
    if (session === null) {
      return;
    }
    setDrag(null);
    dragPointerRef.current = null;
    if (session.mode === "progress") {
      if (session.percent === session.basePercent) {
        return;
      }
      justDraggedRef.current = true;
      onSetProgress?.(session.taskId, session.percent / 100);
      return;
    }
    if (session.start === session.baseStart && session.end === session.baseEnd) {
      return;
    }
    justDraggedRef.current = true;
    onPatchTask?.(session.taskId, rangePatch(session.start, session.end));
  };

  /** 拖左表右边线改左表宽度（官方 frame.verticalSplitLineMoveable）；双击复位默认宽。 */
  const beginSplit = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 捕获失败也不影响：拖动期间 window 上还有一层兜底监听（见下面的 useEffect）。
    }
    splitRef.current = { originX: event.clientX, base: leftWidth };
    setSplitActive(true);
  };

  /** 分隔线拖动的唯一算法：从按下时的 base 出发按位移重算（不累加）。 */
  const applySplit = (clientX: number) => {
    const session = splitRef.current;
    if (session === null) {
      return;
    }
    setLeftWidth(clampNumber(session.base + (clientX - session.originX), LEFT_W_MIN, LEFT_W_MAX));
  };

  const moveSplit = (event: ReactPointerEvent<HTMLSpanElement>) => {
    applySplit(event.clientX);
  };

  const endSplit = () => {
    splitRef.current = null;
    setSplitActive(false);
  };

  /**
   * 拖画面平移（业务口径「向左向右拖动画面要移动」）：在图表空白处按住拖动 = 时间轴跟手滑（横向 / 纵向），
   * 只滚外层容器、不改任何任务字段。任务条与分隔线自己 stopPropagation，从条上 / 线上按下仍是原来那几种拖动；
   * 位移没过阈值就当成点击（左表行定位、阶段折叠、点空白清选中都不受影响）。只认鼠标左键 —— 触屏本来就能拖。
   */
  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    panJustEndedRef.current = false;
    const element = scrollRef.current;
    if (element === null || event.pointerType === "touch" || event.button !== 0) {
      return;
    }
    panRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      baseLeft: element.scrollLeft,
      baseTop: element.scrollTop,
      moved: false,
    };
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panRef.current;
    const element = scrollRef.current;
    if (session === null || element === null || session.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - session.originX;
    const dy = event.clientY - session.originY;
    if (!session.moved) {
      if (Math.abs(dx) < PAN_THRESHOLD_PX && Math.abs(dy) < PAN_THRESHOLD_PX) {
        return;
      }
      session.moved = true;
      // 拖动途中浏览器可能已经开始拉选区（与任务条拖动同一口径：先清掉再跟手）。
      window.getSelection()?.removeAllRanges();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 捕获失败只影响「指针移出容器后是否继续跟手」，容器内拖动照常。
      }
      setPanActive(true);
    }
    element.scrollLeft = session.baseLeft - dx;
    element.scrollTop = session.baseTop - dy;
  };

  const endPan = () => {
    const session = panRef.current;
    panRef.current = null;
    if (session === null || !session.moved) {
      return;
    }
    panJustEndedRef.current = true;
    setPanActive(false);
  };

  /** 平移收尾补的那一下 click 在捕获层吃掉：不落到左表行定位 / 阶段折叠 / 点空白清选中上。 */
  const swallowClickAfterPan = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!panJustEndedRef.current) {
      return;
    }
    panJustEndedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  /** 重新量两根滑块（尺寸 / 位置 / 进度）——与 `ScrollArea` 同一套算法，只是两个方向一起维护。 */
  const syncScrollbars = useCallback(() => {
    const node = scrollRef.current;
    if (node === null) {
      return;
    }
    setVBar(thumbMetrics(node.clientHeight, node.clientHeight, node.scrollHeight, node.scrollTop));
    setHBar(thumbMetrics(bottomBarTrack(), node.clientWidth, node.scrollWidth, node.scrollLeft));
  }, []);

  /** 竖向滑块是隐式的：滚动 / 拖它的时候浮现，停手 900ms 隐去（横向固定常驻，不走这条）。 */
  const revealScrollbars = useCallback(() => {
    setBarActive(true);
    window.clearTimeout(barHideTimerRef.current);
    barHideTimerRef.current = window.setTimeout(() => {
      setBarActive(false);
    }, BAR_HIDE_DELAY);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) {
      return undefined;
    }
    syncScrollbars();
    /** 上次因「接近右缘」而延伸的时间戳：节流到 500ms，避免同一段滚动反复加长。 */
    let lastExtendAt = 0;
    const onScroll = () => {
      syncScrollbars();
      revealScrollbars();
      // 右侧无限延伸：滚到接近右缘（320px 内）就再追加 120 天，继续往右渲染。
      const now = Date.now();
      if (now - lastExtendAt > 500 && node.scrollLeft + node.clientWidth >= node.scrollWidth - 320) {
        lastExtendAt = now;
        setExtraEndDays((days) => days + 120);
      }
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", syncScrollbars);
    const observer = new ResizeObserver(syncScrollbars);
    observer.observe(node);
    for (const child of Array.from(node.children)) {
      observer.observe(child);
    }
    return () => {
      node.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", syncScrollbars);
      observer.disconnect();
      window.clearTimeout(barHideTimerRef.current);
    };
  }, [revealScrollbars, syncScrollbars]);

  /** 拖滑块 = 滚容器（两根共用；`size` = 该方向滑块长度，用来把拖动距离换算成滚动距离）。 */
  const beginScrollbarDrag = (event: ReactPointerEvent<HTMLDivElement>, orientation: "horizontal" | "vertical", size: number, track: number) => {
    const node = scrollRef.current;
    if (node === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const thumbNode = event.currentTarget;
    try {
      thumbNode.setPointerCapture(event.pointerId);
    } catch {
      // 捕获失败只影响「指针移出滑块后是否继续跟手」，滑块内拖动照常。
    }
    const horizontal = orientation === "horizontal";
    const startPointer = horizontal ? event.clientX : event.clientY;
    const startScroll = horizontal ? node.scrollLeft : node.scrollTop;
    const usable = track - BAR_TRACK_INSET * 2;
    const maxScroll = horizontal ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
    const distance = maxScroll / Math.max(1, usable - size);
    window.clearTimeout(barHideTimerRef.current);
    setBarActive(true);
    const onMove = (moveEvent: PointerEvent) => {
      const delta = (horizontal ? moveEvent.clientX : moveEvent.clientY) - startPointer;
      if (horizontal) {
        node.scrollLeft = startScroll + delta * distance;
      } else {
        node.scrollTop = startScroll + delta * distance;
      }
    };
    const onUp = () => {
      thumbNode.removeEventListener("pointermove", onMove);
      thumbNode.removeEventListener("pointerup", onUp);
      thumbNode.removeEventListener("pointercancel", onUp);
      revealScrollbars();
    };
    thumbNode.addEventListener("pointermove", onMove);
    thumbNode.addEventListener("pointerup", onUp);
    thumbNode.addEventListener("pointercancel", onUp);
  };

  /**
   * 指针捕获可能失效（无头调试、指针被拖出窗口、浏览器丢弃捕获）：拖动期间再在 window 上挂一层兜底，
   * 与把手自身的 pointermove 用同一套算法（同一个坐标重复触发是幂等的），保证拖到哪儿都跟手。
   */
  useEffect(() => {
    if (!splitActive) {
      return undefined;
    }
    const onMove = (event: PointerEvent) => {
      applySplit(event.clientX);
    };
    const onUp = () => {
      endSplit();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [splitActive]);

  // 空态 ①：项目一个任务都没有（同看板口径 —— 到「项目总览」加任务）。
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center text-sm text-zinc-500">
        {t("gantt.empty.project")}
      </div>
    );
  }

  /**
   * 任务列表（业务口径 2026-10-13「图二筛选后出现图三的情况直接把图一这样的列表展现」→ 同日追订
   * 「有多个行的话有一个已延期设置日期了 其他的还是要显示」+「甘特图也在下方同时显示」+「只看未排期上分的甘特图筛选栏都没有了 是bug」）：
   * 筛选后**还有没排期的任务**就出这张表（15 列全列 + TaskRow 复用，口径同工作台「我的任务」表）；
   * 位置在甘特图**上方** —— 图表本身能画时仍在下方照常渲染，列表与甘特同屏，补日期不用离开这一屏。
   * 工具条（含筛选栏）常驻；只有「项目一个任务都没有」才整屏换空态（空态 ①，提前返回）。
   * Push 295：列表按阶段分组（口径同项目总览：九阶段顺序 +「临时任务」垫底、只出有任务的分组），
   * 分组头 = 折叠箭头 + 阶段胶囊（已完成 done/总数 + 完成率液面）；折叠状态与左表共用。
   * Push 313（业务口径 2026-10-14「甘特图点击全部的时候不要显示这些列表」）：**能画图时列表只在筛选生效
   * （负责人 / 行筛选任一非「全部」）后出现** —— 「全部」不筛选 = 纯甘特；画不出时间轴的早退分支
   * （model === null：整个筛选结果没有排期齐的任务）不受影响，仍出提示条 + 列表（此时列表是唯一工作内容）。
   */
  const hasUnscheduled = visibleTasks.some((task) => task.startDate === "" || task.dueDate === "");
  const taskListBlock = (
    <div data-gantt-task-list="true" className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="overflow-x-auto">
        <div style={{ minWidth: FALLBACK_TASK_MIN_W }}>
          <div
            className="grid items-center border-b border-zinc-200 bg-zinc-50 px-5 py-2.5 text-xs font-medium text-zinc-400"
            style={{ gridTemplateColumns: FALLBACK_TASK_GRID, minWidth: FALLBACK_TASK_MIN_W }}
          >
            {FALLBACK_TASK_COLUMNS.map((column) =>
              column.key === "title" ? (
                <span key={column.key} data-column={column.key} className="truncate">
                  {fieldText(locale, column.label)}
                </span>
              ) : (
                <span
                  key={column.key}
                  data-column={column.key}
                  title={column.label === "" ? undefined : fieldText(locale, column.label)}
                  className={"truncate text-center " + (column.headerClass ?? "")}
                >
                  {column.header ?? fieldText(locale, column.label)}
                </span>
              ),
            )}
          </div>
          {listGroups.map((group) => {
            const done = group.items.filter((task) => isTaskDone(task)).length;
            const pct = Math.round((done / group.items.length) * 100);
            const isCollapsed = collapsed[group.stage] === true;
            return (
              <section key={group.stage} className="border-b border-zinc-100 last:border-b-0">
                {/* 阶段标题分组头（Push 295）：外观口径同项目总览 —— 只有左边「折叠箭头」可点；这里没有节点 / 模板卡片，
                    阶段胶囊静态展示（阶段名 + 已完成 done/总数 + 完成率液面；完成数取 isTaskDone，与左表阶段行同一口径）。 */}
                <div data-gantt-list-stage={group.stage} className="flex w-full items-center gap-2.5 bg-zinc-100 px-5 py-3">
                  <button
                    type="button"
                    aria-label={isCollapsed ? t("board.stage.expand") : t("board.stage.collapse")}
                    aria-expanded={!isCollapsed}
                    title={isCollapsed ? t("board.stage.expand") : t("board.stage.collapse")}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleStage(group.stage);
                    }}
                    className="rounded-md p-1 transition hover:bg-zinc-200/70"
                  >
                    <svg
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                      className={"h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform " + (isCollapsed ? "" : "rotate-90")}
                    >
                      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <span className="relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-white px-3 py-1.5 ring-1 ring-zinc-200">
                    <span className="liquid-fill" style={{ height: pct + "%" }} aria-hidden="true" />
                    <span className="relative text-sm font-semibold text-zinc-800">{stageText(locale, group.stage)}</span>
                    <span className="relative text-xs text-zinc-500">
                      {t("board.stage.done", { done: done, total: group.items.length })}
                    </span>
                  </span>
                </div>
                {isCollapsed ? null : (
                  <div className="divide-y divide-zinc-100">
                    {group.items.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        columns={FALLBACK_TASK_COLUMNS}
                        selected={false}
                        tierTint={tierTint}
                        members={members}
                        onProgress={
                          onSetProgress === undefined
                            ? undefined
                            : (progress) => {
                                onSetProgress(task.id, progress);
                              }
                        }
                        onPatch={
                          onPatchTask === undefined
                            ? undefined
                            : (patch) => {
                                onPatchTask(task.id, patch);
                              }
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );

  /** 工具条（常驻）：一行 —— 左侧操作（粒度 / 缩放 / 折叠 / 回到今天 / 筛选 / 编辑锁），右侧图例提示。 */
  const toolbarBlock = (
    <div data-gantt-toolbar="" className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          data-gantt-fullscreen-toggle={fullscreen ? "on" : "off"}
          aria-pressed={fullscreen}
          aria-label={t(fullscreen ? "gantt.fullscreen.exitAria" : "gantt.fullscreen.enterAria")}
          title={t(fullscreen ? "gantt.fullscreen.exitTip" : "gantt.fullscreen.enterTip")}
          onClick={toggleFullscreen}
          className={
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition " +
            (fullscreen
              ? "border-sky-200 bg-sky-50 hover:bg-sky-100"
              : "border-zinc-200 bg-white hover:bg-zinc-50")
          }
        >
          <GanttFullscreenIcon />
        </button>
        <span className="h-4 w-px bg-zinc-200" aria-hidden="true" />
        <div className={"flex items-center gap-0.5 rounded-lg border p-0.5 " + GLASS_TRACK}>
          {SCALE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                applyDayWidth(SCALES[key].dayWidth[nearestZoomKey], undefined, key);
              }}
              title={t("gantt.scale.title", { name: scaleText(key) })}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition " +
                (key === scale ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800")
              }
            >
              {scaleText(key)}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-zinc-400">{t("gantt.label.zoom")}</span>
        <div className={"flex items-center gap-0.5 rounded-lg border p-0.5 " + GLASS_TRACK}>
          <button
            type="button"
            data-gantt-zoom="out"
            disabled={dayWidth <= DAY_WIDTH_MIN + 0.05}
            onClick={() => {
              applyDayWidth(dayWidth / 1.25);
            }}
            title={t("gantt.zoom.outTip")}
            className="rounded-md px-2 py-1 text-xs font-semibold text-zinc-600 transition hover:bg-white hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={t("gantt.zoom.out")}
          >
            −
          </button>
          <button
            type="button"
            data-gantt-zoom="reset"
            onClick={() => {
              applyDayWidth(DAY_WIDTH_DEFAULT, undefined, "day");
            }}
            title={t("gantt.zoom.resetTip")}
            className="min-w-[44px] rounded-md px-1.5 py-1 text-center text-[11px] font-medium tabular-nums text-zinc-700 transition hover:bg-white hover:text-zinc-900"
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            data-gantt-zoom="in"
            disabled={dayWidth >= DAY_WIDTH_MAX - 0.05}
            onClick={() => {
              applyDayWidth(dayWidth * 1.25);
            }}
            title={t("gantt.zoom.inTip")}
            className="rounded-md px-2 py-1 text-xs font-semibold text-zinc-600 transition hover:bg-white hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={t("gantt.zoom.in")}
          >
            +
          </button>
          <span className="mx-0.5 h-3.5 w-px bg-zinc-200" aria-hidden="true" />
          <button
            type="button"
            data-gantt-zoom="fit"
            disabled={model === null}
            onClick={fitToView}
            title={t("gantt.zoom.fitTip")}
            className="rounded-md px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-white hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {t("gantt.zoom.fit")}
          </button>
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className={"rounded-lg border px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:text-zinc-900 " + GLASS_SURFACE}
        >
          {allCollapsedNow ? t("gantt.toggle.allExpand") : t("gantt.toggle.allCollapse")}
        </button>
        <button
          type="button"
          onClick={goToToday}
          disabled={model === null}
          title={
            todayIndex === null
              ? t("gantt.today.outOfRange")
              : t("gantt.today.title")
          }
          className={
            "rounded-lg border px-2.5 py-1 text-xs font-medium transition " +
            (model === null
              ? "cursor-not-allowed border-zinc-200/60 bg-white/50 text-zinc-300"
              : GLASS_SURFACE + " text-zinc-600 hover:text-zinc-900")
          }
        >
          {t("gantt.today.button")}
        </button>
        <span className="mx-0.5 h-3.5 w-px bg-zinc-200" aria-hidden="true" />
        <div className={"flex items-center gap-0.5 rounded-lg border p-0.5 " + GLASS_TRACK}>
          {ROW_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setRowFilter(item.key);
              }}
              title={rowFilterHint(item.key)}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition " +
                (item.key === rowFilter ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800")
              }
            >
              {rowFilterText(item.key)}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-gantt-lock={barsLocked ? "locked" : "unlocked"}
          aria-pressed={barsLocked}
          aria-label={t("gantt.lock.toggleAria")}
          onClick={toggleBarsLocked}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white transition hover:bg-zinc-50"
        >
          <GanttLockIcon locked={barsLocked} />
        </button>
        <span className="shrink-0 text-xs font-bold text-zinc-900">
          {t(barsLocked ? "gantt.lock.lockedLabel" : "gantt.lock.unlockedLabel")}
        </span>
        <ul data-gantt-legend="" className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          <li className="flex items-center gap-1.5">
            <span className={"h-2.5 w-4 rounded-[3px] " + BAR_DONE_CLASS} aria-hidden="true" />
            {t("gantt.legend.done")}
          </li>
          <li className="flex items-center gap-1.5">
            <span className={"h-2.5 w-4 rounded-[3px] " + BAR_TODO_CLASS} aria-hidden="true" />
            {t("gantt.legend.remaining")}
          </li>
          <li className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-4 rounded-[3px] border border-rose-300"
              style={{ backgroundImage: OVERDUE_TAIL_BG }}
              aria-hidden="true"
            />
            {t("gantt.legend.overdue")}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-flex items-center" aria-hidden="true">
              <span className="h-0 w-2.5 border-t border-dashed border-slate-500" />
              <span className="h-2 w-2 rounded-full border-[1.5px] border-white bg-slate-700 shadow-sm" />
            </span>
            {t("gantt.legend.doneDate")}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 border-l border-dashed border-blue-500" aria-hidden="true" />
            {t("gantt.legend.today")}
          </li>
        </ul>
      </div>
    </div>
  );

  // 空态 ② / ③：工具条（含筛选栏）常驻 —— ② 筛选到一条不剩出提示卡；③ 画不出时间轴出提示条 + 任务列表
  // （列表与甘特图同屏的口径见 taskListBlock 注释）。此分支不进入下面的图表区 —— 那边的常量 / 闭包按 model 非空写。
  if (model === null) {
    // 任务列表为空（项目无任务，或筛选后一条不剩）：只出提示卡。
    return (
      <div
        ref={shellRef}
        data-gantt-fullscreen={fullscreen ? "on" : "off"}
        className={
          fullscreen
            ? "fixed inset-0 z-[300] flex h-screen flex-col gap-3 overflow-y-auto bg-slate-100 p-3"
            : "space-y-3"
        }
      >
        {toolbarBlock}
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center text-sm text-zinc-500">
          <p>{tasks.length === 0 ? t("gantt.empty.project") : t("gantt.empty.filtered", { n: tasks.length })}</p>
          {tasks.length === 0 ? null : (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
            >
              {t("gantt.filter.clear")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const totalWidth = model.days * dayWidth;

  /** 条几何：左偏移 = 距时间轴首日的天数 × 每天宽度；宽 = 含首尾天数 × 每天宽度（最窄 4px）。 */
  const barBox = (start: number, end: number) => {
    return {
      left: dayDiff(model.rangeStart, start) * dayWidth,
      width: Math.max((dayDiff(start, end) + 1) * dayWidth, 4),
    };
  };

  /** 这一条的当前几何：正在拖的那条用预览值，其余用任务本身的值。 */
  const liveOf = (bar: GanttBar): { start: number; end: number; percent: number; dragging: boolean } => {
    if (drag !== null && drag.taskId === bar.task.id && bar.start !== null && bar.end !== null) {
      return { start: drag.start, end: drag.end, percent: drag.percent, dragging: true };
    }
    return { start: bar.start ?? 0, end: bar.end ?? 0, percent: bar.percent, dragging: false };
  };

  /**
   * 左表「开始 / 结束」两列（对齐官方样例左表的 start / end）：任务行 = 这条任务的日期、
   * 阶段行 = 组内任务工期并集（与阶段汇总条同源）；没排期 =「—」。拖动中的那条取**预览值**
   * （与条、浮标同一套 liveOf），松手才写回 —— 也正因此在条上拖动时这两列会跟着日期一起走。
   */
  const rowDateRange = (row: GanttRow): { start: string; end: string; live: boolean } => {
    if (row.kind === "group") {
      return {
        start: row.group.start === null ? "—" : mdText(locale, isoOf(row.group.start)),
        end: row.group.end === null ? "—" : mdText(locale, isoOf(row.group.end)),
        live: false,
      };
    }
    if (row.bar.start === null || row.bar.end === null) {
      return { start: "—", end: "—", live: false };
    }
    const live = liveOf(row.bar);
    return { start: mdText(locale, isoOf(live.start)), end: mdText(locale, isoOf(live.end)), live: live.dragging };
  };

  /** 点时间轴空白 / 左表空白：清掉选中（拖动收尾补的那一下 click 挡掉，免得刚拖完就取消选中）。 */
  const clearSelection = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    setSelectedId(null);
  };

  /**
   * 点左表任务行 = 选中这条 + 把条定位到时间轴可视区中间（官方 gantt-locate-taskbar）：
   * 条已经完整可见就不动（否则点一下就跳一下很晕），被挡住 / 在屏幕外才平滑滚过去。
   */
  const locateBar = (bar: GanttBar) => {
    setSelectedId(bar.task.id);
    const element = scrollRef.current;
    if (element === null || bar.start === null || bar.end === null) {
      return;
    }
    const box = barBox(bar.start, bar.end);
    const viewStart = element.scrollLeft + leftWidth;
    const viewEnd = element.scrollLeft + element.clientWidth;
    if (box.left >= viewStart && box.left + box.width <= viewEnd) {
      return;
    }
    element.scrollTo({ left: Math.max(0, box.left + box.width / 2 - (element.clientWidth - leftWidth) / 2), behavior: "smooth" });
  };

  /**
   * 未排期任务：在时间轴空白格双击 = 以该日新建 1 天任务条（已有条的任务不响应）。
   * 新建后即可按普通任务条拖动改期 / 拖两端改工期（锁定态或无权编辑时不生效）。
   */
  const createBarOnDoubleClick = (event: ReactMouseEvent<HTMLDivElement>, bar: GanttBar) => {
    if (bar.start !== null || bar.end !== null) {
      return;
    }
    if (model === null || onPatchTask === undefined || barsLocked) {
      return;
    }
    const capabilities = taskCapabilitiesOf(bar.task);
    if (!capabilities.canEditFields || bar.task.finalizedAt !== null) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    if (offsetX < 0) {
      return;
    }
    const dayIndex = clampNumber(Math.floor(offsetX / dayWidth), 0, Math.max(model.days - 1, 0));
    const day = model.rangeStart + dayIndex * DAY_MS;
    setSelectedId(bar.task.id);
    onPatchTask(bar.task.id, rangePatch(day, day));
  };

  /** 拖动中的浮标（贴在条上方，行坐标系）：改期 / 改工期写新日期区间与天数，改进度写新百分比。 */
  const dragBubble = (left: number, dragging: boolean) => {
    if (!dragging || drag === null) {
      return null;
    }
    const text =
      drag.mode === "progress"
        ? t("gantt.tip.progress", { n: drag.percent })
        : t("gantt.tip.dragRange", { from: mdText(locale, isoOf(drag.start)), to: mdText(locale, isoOf(drag.end)), n: dayDiff(drag.start, drag.end) + 1 });
    return (
      <span className="pointer-events-none absolute z-40 select-none whitespace-nowrap rounded-md bg-zinc-900/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-lg" style={{ left, top: -12 }}>
        {text}
      </span>
    );
  };

  /**
   * 任务条：按所属阶段取协调色（主色进度 + 同色系浅底剩余工期 + 实际完成刻度）；
   * 单日任务（开始 = 预计完成）不再画菱形，直接把对应的日格子用阶段色铺满（仍支持拖动改期 / 改工期 / 改进度）；
   * 悬停 / 拖动时条两端浮出改工期的热区与进度圆点，拖动中的那条上方浮一枚日期（进度）浮标。
   */
  const renderTaskBar = (bar: GanttBar) => {
    if (bar.start === null || bar.end === null) {
      return (
        <span
          className="absolute left-2 top-1/2 inline-flex -translate-y-1/2 items-center text-slate-300"
          title={t("gantt.unscheduled.hint")}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
            <rect x="2.5" y="4" width="15" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M2.5 8h15M6.5 2.5v3M13.5 2.5v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M4.5 16.5l11-11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      );
    }
    const live = liveOf(bar);
    const box = barBox(live.start, live.end);
    const selected = selectedId === bar.task.id;
    const dragging = live.dragging;
    const barHovered = hoveredBar === bar.task.id;
    const barTitle = barTitleOf(bar);
    const capabilities = taskCapabilitiesOf(bar.task);
    const canEditDates = !barsLocked && capabilities.canEditFields && bar.task.finalizedAt === null;
    const barCursor = !canEditDates ? "cursor-default" : dragging ? "cursor-grabbing" : "cursor-grab";
    const showHandles = canEditDates && box.width >= 18 && (barHovered || dragging);
    const percent = Math.round(live.percent);
    // 条内标签对齐官方 labelText「{title} {progress}%」：条够宽写全，窄条只写百分比、再窄就不写。
    const barLabel = box.width >= 84 ? ganttTitle(bar.task) + " " + String(percent) + "%" : String(percent) + "%";

    const palette = stagePaletteOf(bar.stage);
    const overdue = bar.status === "已延期";
    const isSingleDay = live.start === live.end;
    // 单日任务宽度按日网格留 1px 缝，垂直高度与多日任务条统一居中（22px 高），保持水平视觉线齐整。
    const cellLeft = isSingleDay ? box.left + 1 : box.left;
    const cellWidth = isSingleDay ? Math.max(box.width - 1, 3) : box.width;
    const barTop = (ROW_H - BAR_H) / 2;
    const barHeight = BAR_H;
    const barRight = cellLeft + cellWidth;
    // 已完成进度 >= 55% 时深色主色铺过半条，文字切换白色提升对比度；未完成浅底段用同色系深字。
    const labelColor = live.percent >= 55 ? "#ffffff" : palette.text;

    // 实际完成日期（方案 A）：条内彻底不画竖线；
    // - 推迟完成（done > live.end）：从计划条右端向外拉出虚线 + 实心终点圆点直指实际完成日；
    // - 按时 / 提前完成（done <= live.end）：在条外右侧挂轻盈的「✓ M/D」小标（若同时超期延长，则放在延长尾端）。
    const done = bar.done;
    const doneLateDays = done !== null && done > live.end ? dayDiff(live.end, done) : 0;
    const doneCenterX = done !== null && done > live.end ? (dayDiff(model.rangeStart, done) + 0.5) * dayWidth : null;
    const doneEarlyOrOnTime = done !== null && done <= live.end;

    // 已延期（方案 1）：去掉条头 3px 红竖杠，保留阶段配色；
    // - 若预计完成日期早于今天（today > live.end）且任务未完成：向「今天」拉出半透明玫瑰红斜纹延伸段并标「+N天」；
    // - 若尚未到今天或已标延期但预计在今天及之后：条外右侧挂轻量红色「已延期」标记（不压条内文字）。
    const overdueTailDays = overdue && today > live.end ? dayDiff(live.end, today) : 0;
    const overdueTailLeft = barRight;
    const showDoneInlineDot = doneLateDays > 0 && doneCenterX !== null && doneCenterX > barRight + 2;
    const isTaskCompleted = isTaskDone(bar.task);
    // 已完成任务即使之前曾超期，若有实际完成日期则以实际完成连线为准，不再拉向「今天」的超期滞留条
    const effectiveOverdueTailDays = !isTaskCompleted ? overdueTailDays : 0;
    const effectiveOverdueTailWidth = effectiveOverdueTailDays > 0 ? Math.max(effectiveOverdueTailDays * dayWidth, 6) : 0;
    const effectiveOverdueBadgeOnly = overdue && !isTaskCompleted && effectiveOverdueTailDays <= 0;

    // 条右侧紧邻的轻量徽标起点（避开超期斜纹延伸段 / 实际完成延迟虚线点）
    const rightAddonLeft =
      showDoneInlineDot && doneCenterX !== null
        ? Math.max(doneCenterX + 8, barRight + effectiveOverdueTailWidth + 6)
        : effectiveOverdueTailWidth > 0
          ? barRight + effectiveOverdueTailWidth + 6
          : barRight + 6;

    return (
      <>
        {/* 1. 已延期超期滞留延伸段（方案 1：半透明淡红斜纹从计划条尾拉向「今天」） */}
        {overdue && effectiveOverdueTailWidth > 0 ? (
          <div
            data-gantt-overdue-tail=""
            className="pointer-events-none absolute flex items-center rounded-r-[4px] border border-l-0 border-rose-300/90"
            style={{
              left: overdueTailLeft,
              width: effectiveOverdueTailWidth,
              top: barTop + 2,
              height: barHeight - 4,
              backgroundImage: OVERDUE_TAIL_BG,
            }}
            title={t("gantt.overdue.days", { n: effectiveOverdueTailDays })}
            aria-hidden="true"
          />
        ) : null}

        {/* 2. 推迟完成的实际完成日期虚线 + 实心终点圆点（方案 A：条外直指实际完成日，不劈裂条内文字） */}
        {showDoneInlineDot && doneCenterX !== null && done !== null ? (
          <div
            data-gantt-done-marker="late"
            className="pointer-events-none absolute flex items-center"
            style={{
              left: barRight,
              width: Math.max(doneCenterX - barRight, 6),
              top: barTop,
              height: barHeight,
            }}
            title={t("gantt.tip.done", { date: mdText(locale, isoOf(done)) })}
          >
            <span className="h-0 flex-1 border-t border-dashed border-slate-500/80" aria-hidden="true" />
            <span
              className="-ml-1 h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-white bg-slate-700 shadow-sm"
              aria-hidden="true"
            />
          </div>
        ) : null}

        {/* 3. 主任务条（极简干净：阶段底色 + 进度填充 + 任务名%，已延期仅加轻细玫瑰红边框不压条内） */}
        <div
          data-gantt-single-day={isSingleDay ? "true" : undefined}
          className={
            "absolute flex touch-none select-none items-center overflow-hidden " +
            (isSingleDay ? "rounded-[4px] " : "rounded-[5px] ") +
            (selected
              ? BAR_SELECTED_CLASS
              : overdue
                ? "ring-1 ring-rose-400/90 shadow-[0_1px_2px_rgba(244,63,94,0.12)]"
                : "shadow-[0_1px_2px_rgba(15,23,42,0.06)]") +
            " " +
            (dragging ? "cursor-grabbing shadow-md" : barCursor)
          }
          style={{
            left: cellLeft,
            width: cellWidth,
            height: barHeight,
            top: barTop,
            backgroundColor: palette.track,
          }}
          title={barTitle}
          onPointerDown={(event) => {
            beginDrag(event, bar, "move");
          }}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onMouseEnter={() => {
            setHoveredBar(bar.task.id);
          }}
          onMouseLeave={() => {
            setHoveredBar(null);
          }}
          onClick={(event) => {
            event.stopPropagation();
            setSelectedId(bar.task.id);
          }}
        >
          <span
            className="absolute inset-y-0 left-0 transition-[width] duration-150"
            style={{ width: String(live.percent) + "%", backgroundColor: palette.accent }}
            aria-hidden="true"
          />
          {barHovered && !dragging ? <span className="pointer-events-none absolute inset-0 bg-slate-900/10" aria-hidden="true" /> : null}
          {box.width < 40 ? null : (
            <span
              className="relative truncate pl-2 pr-1.5 text-[11px] font-semibold"
              style={{ color: labelColor, textShadow: live.percent >= 55 ? "0 1px 1px rgba(15,23,42,0.22)" : "none" }}
            >
              {barLabel}
            </span>
          )}
          {showHandles ? (
            <>
              {/* 拖两端 = 改工期（官方 taskBar.resizable）：热区只在悬停 / 拖动时显形，平时不噪。 */}
              <span
                className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-ew-resize bg-white/45"
                onPointerDown={(event) => {
                  beginDrag(event, bar, "start");
                }}
              />
              <span
                className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-ew-resize bg-white/45"
                onPointerDown={(event) => {
                  beginDrag(event, bar, "end");
                }}
              />
            </>
          ) : null}
        </div>

        {/* 4. 条外轻量状态标注（按时/提前完成「✓ M/D」；延迟完成「+N天」；超期滞留「+N天」；已延期小签） */}
        {!dragging && (effectiveOverdueTailDays > 0 || effectiveOverdueBadgeOnly || doneEarlyOrOnTime || doneLateDays > 0) ? (
          <div
            className="pointer-events-none absolute flex items-center gap-1.5 whitespace-nowrap text-[10px] font-medium leading-none"
            style={{ left: rightAddonLeft, top: barTop, height: barHeight }}
          >
            {effectiveOverdueTailDays > 0 ? (
              <span className="rounded bg-rose-50 px-1 py-0.5 font-semibold text-rose-600 ring-1 ring-rose-200/80">
                +{effectiveOverdueTailDays}{t("gantt.dayShort")}
              </span>
            ) : effectiveOverdueBadgeOnly ? (
              <span className="rounded bg-rose-50 px-1 py-0.5 font-medium text-rose-600 ring-1 ring-rose-200/80">
                {t("gantt.legend.overdue")}
              </span>
            ) : null}
            {doneLateDays > 0 && done !== null ? (
              <span
                data-gantt-done-marker="late-label"
                className="text-slate-500"
                title={t("gantt.tip.done", { date: mdText(locale, isoOf(done)) })}
              >
                {mdText(locale, isoOf(done))} (+{doneLateDays}{t("gantt.dayShort")})
              </span>
            ) : doneEarlyOrOnTime && done !== null ? (
              <span
                data-gantt-done-marker="ontime"
                className="inline-flex items-center gap-0.5 text-slate-400"
                title={t("gantt.tip.done", { date: mdText(locale, isoOf(done)) })}
              >
                <span aria-hidden="true">✓</span>
                <span>{mdText(locale, isoOf(done))}</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {dragBubble(cellLeft, dragging)}
      </>
    );
  };

  /**
   * 阶段行（顶部括弧统计 + 展开包络）：
   * - 门型括弧（顶部进度横梁 + 左右向下折钩）包住本阶段工期跨度；
   * - 统计标签放到括弧紧右侧（而非骑在横梁上方），彻底避免与上一行或吸顶表头碰撞；
   * - 展开时在括弧下方铺一层淡色半透明包络底框罩住本阶段所有子任务行。
   */
  const renderGroupBar = (group: GanttGroup) => {
    let liveStart: number | null = null;
    let liveEnd: number | null = null;
    for (const bar of group.bars) {
      if (bar.start === null || bar.end === null) {
        continue;
      }
      const live = liveOf(bar);
      liveStart = liveStart === null ? live.start : Math.min(liveStart, live.start);
      liveEnd = liveEnd === null ? live.end : Math.max(liveEnd, live.end);
    }
    if (liveStart === null || liveEnd === null) {
      return null;
    }
    const palette = stagePaletteOf(group.stage);
    const box = barBox(liveStart, liveEnd);
    const spanDays = dayDiff(liveStart, liveEnd) + 1;
    const expandedHeight = group.expandedCount > 0 ? group.expandedCount * ROW_H : 0;
    const summaryText = t("board.stage.done", { done: group.doneCount, total: group.bars.length }) + " · " + String(group.percent) + "% · " + t("pm.gantt.days", { n: spanDays });
    const bracketTop = Math.round((ROW_H - 12) / 2);
    const barThickness = 5;
    const legH = 7;

    return (
      <div
        className="pointer-events-none absolute inset-y-0 left-0 right-0"
        style={{ zIndex: 2 }}
      >
        {/* 阶段展开时包住子任务区域的淡色包络底框 */}
        {expandedHeight > 0 ? (
          <div
            data-gantt-stage-envelope={group.stage}
            className="pointer-events-none absolute rounded-b-[6px] border-x border-b"
            style={{
              left: box.left,
              width: box.width,
              top: bracketTop + barThickness,
              height: ROW_H - (bracketTop + barThickness) + expandedHeight - 2,
              backgroundColor: palette.envelope,
              borderColor: palette.track,
            }}
            aria-hidden="true"
          />
        ) : null}

        {/* 括弧横梁（顶横杠 + 左下折钩 + 右下折钩；未完成段用同色系浅底、已完成段用阶段主色） */}
        <div
          data-gantt-stage-bracket={group.stage}
          className="pointer-events-auto absolute"
          style={{ left: box.left, width: box.width, top: bracketTop, height: barThickness + legH }}
          title={t("gantt.groupSpan.tip", { text: String(group.doneCount) + "/" + String(group.bars.length) + " · " + String(group.percent) + "%" })}
        >
          <div
            className="relative w-full overflow-hidden rounded-t-[3px]"
            style={{ height: barThickness, backgroundColor: palette.track }}
          >
            <span
              className="absolute inset-y-0 left-0 transition-[width] duration-150"
              style={{ width: String(group.percent) + "%", backgroundColor: palette.accent }}
              aria-hidden="true"
            />
          </div>
          <span
            className="absolute left-0 block w-[3px] rounded-b-[2px]"
            style={{ top: barThickness - 1, height: legH, backgroundColor: group.percent > 0 ? palette.accent : palette.track }}
            aria-hidden="true"
          />
          <span
            className="absolute right-0 block w-[3px] rounded-b-[2px]"
            style={{ top: barThickness - 1, height: legH, backgroundColor: group.percent >= 100 ? palette.accent : palette.track }}
            aria-hidden="true"
          />
        </div>

        {/* 统计标签放在括弧紧右侧，不占上方高度，彻底杜绝与表头/上一行碰撞 */}
        <div
          className="pointer-events-none absolute flex items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold leading-none tabular-nums"
          style={{ left: box.left + box.width + 8, top: 0, height: ROW_H, color: palette.text }}
        >
          <span>{stageText(locale, group.stage)}</span>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: palette.track, color: palette.text }}>
            {summaryText}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={shellRef}
      data-gantt-fullscreen={fullscreen ? "on" : "off"}
      className={
        fullscreen
          ? "fixed inset-0 z-[300] flex h-screen flex-col gap-3 overflow-hidden bg-slate-100 p-3"
          : "space-y-3"
      }
    >
      {toolbarBlock}

      {/* 任务列表与甘特图同屏（Push 294；Push 295 起列表按阶段标题分组可折叠；Push 313 起「全部」（未筛选）不出列表）：筛选生效且还有没排期的任务才把列表出在甘特上方；图表本身照常在下方渲染（提示条 / 空态 ② 在 model === null 的早退分支里出）。 */}
      {filtering && hasUnscheduled ? (
        <div className={fullscreen ? "max-h-[30vh] shrink-0 overflow-y-auto" : undefined}>{taskListBlock}</div>
      ) : null}
              {/* 图表：左表（sticky left，横向不滚）+ 时间轴（表头 sticky top，纵向吸顶），两边逐行同一组行高 */}
              {/* 外面这层 relative 给自绘的竖向滑块（隐式浮在右缘）定位；下方横向那条是 fixed 在整个窗口底部的，不随页面滚 */}
              <div className={fullscreen ? "relative min-h-0 flex-1" : "relative"}>
        <div
          ref={scrollRef}
          data-gantt-scroll=""
          data-live-date-origin={model === null ? undefined : model.rangeStart}
          data-live-date-width={dayWidth}
          className={
            "scrollbar-hidden overflow-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] " +
            (fullscreen ? "h-full min-h-0 " : "h-[calc(100vh-15rem)] min-h-[22rem] max-h-[52rem] ") +
            (panActive ? "cursor-grabbing select-none" : "cursor-grab")
          }
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onClickCapture={swallowClickAfterPan}
        >
          <div className="flex w-max">
            {/*
              左表：列宽固定、每行按自然宽渲染，可见宽度 = 分隔线位置；超出的列由右侧时间轴盖住。
              只给「裁切层」上 clipPath（只裁不重排 —— 列宽一直不变，也不新建滚动容器，sticky 照常）。
              分隔线把手放在裁切层之外，否则悬停高亮线与外侧 8px 的抓手会被一起裁掉。
            */}
            {/* 层级（Push 244 业务口径「甘特图页面会挡住 日报子页面」）：左侧 sticky 表列 z-20 → **z-[19]** ——
                低于主标签栏的 z-20（同 TaskBoard 表头口径），两列齐平时不再按 DOM 靠后盖住「日报及问题」下拉面板；
                对时间轴各列仍是最高层（列本身 z-auto），左表「横向不滚」的吸层行为不变。 */}
            <div className="sticky left-0 z-[19] shrink-0" style={{ width: leftWidth }}>
              <div
                className="h-full border-r border-zinc-200 bg-white"
                style={{ width: leftWidth, clipPath: "inset(0)" }}
              >
                <div
                  className="sticky top-0 z-10 flex items-center border-b border-slate-200 bg-slate-50/95 text-[11px] font-medium text-slate-500"
                  style={{ height: HEADER_TOTAL_H, width: LEFT_W_NATURAL }}
                >
                  <div className="flex h-full items-center justify-center whitespace-nowrap" style={{ width: COL_INDEX_W }}>
                    {fieldText(locale, "行号")}
                  </div>
                  <div className="flex h-full items-center whitespace-nowrap px-2" style={{ width: COL_TITLE_W }}>
                    {fieldText(locale, "任务")}
                  </div>
                  <div className="flex h-full items-center justify-center whitespace-nowrap px-1" style={{ width: COL_START_W }}>
                    {fieldText(locale, "开始日期")}
                  </div>
                  <div className="flex h-full items-center justify-center whitespace-nowrap px-1" style={{ width: COL_END_W }}>
                    {fieldText(locale, "预计完成日期")}
                  </div>
                  <div className="flex h-full items-center justify-center whitespace-nowrap px-1" style={{ width: COL_HEADCOUNT_W }}>
                    {fieldText(locale, "施工人数")}
                  </div>
                  <div className="flex h-full items-center justify-center whitespace-nowrap px-1" style={{ width: COL_PROGRESS_W }}>
                    {fieldText(locale, "进展")}
                  </div>
                </div>
                {model.rows.map((row) => {
                  const isHovered = hovered === row.key;
                  const range = rowDateRange(row);
                  const rowTask = row.kind === "task" ? row.bar.task : null;
                  const rowCaps = rowTask === null ? null : taskCapabilitiesOf(rowTask);
                  const datesEditable = rowTask !== null && !barsLocked && onPatchTask !== undefined && rowCaps !== null && rowCaps.canEditFields && rowTask.finalizedAt === null;
                  const progressEditable = rowTask !== null && !barsLocked && onSetProgress !== undefined && rowCaps !== null && rowCaps.canUpdateProgress && rowTask.finalizedAt === null;
                  const editHint = barsLocked ? t("gantt.lock.lockedTip") : t("board.finalizedHint");
                  const patchRowRange = (nextStartIso: string, nextDueIso: string) => {
                    if (rowTask === null) {
                      return;
                    }
                    onPatchTask?.(rowTask.id, {
                      startDate: nextStartIso,
                      dueDate: nextDueIso,
                      days: nextStartIso !== "" && nextDueIso !== "" ? daysBetweenInclusive(nextStartIso, nextDueIso) : 0,
                    });
                  };
                  return (
                    <div
                      key={row.key}
                      onMouseEnter={() => {
                        setHovered(row.key);
                      }}
                      onMouseLeave={() => {
                        setHovered(null);
                      }}
                      onClick={clearSelection}
                      className={
                        "flex items-center border-b border-slate-100 " +
                        (row.kind === "group"
                          ? isHovered
                            ? "bg-slate-100/80"
                            : "bg-slate-50/70"
                          : isHovered
                            ? "bg-slate-50/80"
                            : "bg-white")
                      }
                      style={{ height: ROW_H, width: LEFT_W_NATURAL }}
                    >
                      <div className="flex items-center justify-center text-[11px] tabular-nums text-slate-400" style={{ width: COL_INDEX_W }}>
                        {row.no}
                      </div>
                      {row.kind === "group" ? (
                        <button
                          type="button"
                          onClick={() => {
                            toggleStage(row.group.stage);
                          }}
                          title={collapsed[row.group.stage] === true ? t("board.stage.expand") : t("board.stage.collapse")}
                          className="flex h-full min-w-0 items-center gap-1 px-1.5 text-left"
                          style={{ width: COL_TITLE_W }}
                        >
                          <svg
                            viewBox="0 0 12 12"
                            className={
                              "h-2.5 w-2.5 shrink-0 text-slate-400 transition-transform " +
                              (collapsed[row.group.stage] === true ? "" : "rotate-90")
                            }
                            aria-hidden="true"
                          >
                            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span
                            className="h-2 w-2 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: stagePaletteOf(row.group.stage).accent }}
                            aria-hidden="true"
                          />
                          <span className="truncate text-[12px] font-semibold text-slate-800">{stageText(locale, row.group.stage)}</span>
                          <span className="ml-auto shrink-0 pr-0.5 text-[10px] tabular-nums text-slate-400">
                            {row.group.bars.length === 0
                              ? t("board.stage.empty")
                              : String(row.group.doneCount) + "/" + String(row.group.bars.length)}
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            locateBar(row.bar);
                          }}
                          title={barTitleOf(row.bar) + "\n" + t("gantt.tip.selectTip")}
                          className="flex h-full min-w-0 items-center gap-1.5 pl-4 pr-1.5 text-left"
                          style={{ width: COL_TITLE_W }}
                        >
                          <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + STATUS_DOT_CLASS[row.bar.status]} aria-hidden="true" />
                          <span className={"truncate text-[12px] " + (selectedId === row.bar.task.id ? "font-semibold text-zinc-900" : "text-zinc-700")}>
                            {ganttTitle(row.bar.task)}
                          </span>
                        </button>
                      )}
                      {row.kind === "group" ? (
                        <>
                          <div className={dateCellClass(range.live)} style={{ width: COL_START_W }}>
                            {range.start === "—" ? <span className="text-slate-300">—</span> : range.start}
                          </div>
                          <div className={dateCellClass(range.live)} style={{ width: COL_END_W }}>
                            {range.end === "—" ? <span className="text-slate-300">—</span> : range.end}
                          </div>
                          <div className="px-1 text-center whitespace-nowrap text-[11px] tabular-nums text-zinc-500" style={{ width: COL_HEADCOUNT_W }}>
                            {row.group.headcountTotal > 0 ? t("drawer.headcount.value", { n: row.group.headcountTotal }) : <span className="text-slate-300">—</span>}
                          </div>
                          <div className="px-1 text-center whitespace-nowrap text-[11px] tabular-nums text-zinc-500" style={{ width: COL_PROGRESS_W }}>
                            {String(row.group.percent) + "%"}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-center" style={{ width: COL_START_W }}>
                            <InlineDateCell
                              valueIso={rowTask === null ? "" : rowTask.startDate}
                              ariaLabel={t("board.edit.aria", { field: fieldText(locale, "开始日期") })}
                              disabled={!datesEditable}
                              disabledHint={editHint}
                              placement="below"
                              triggerClassName="tabular-nums text-[11px] text-slate-600"
                              display={rowTask === null || rowTask.startDate === "" ? <span className="text-slate-300">—</span> : mdText(locale, rowTask.startDate)}
                              onChange={(iso) => {
                                const due = rowTask === null ? "" : rowTask.dueDate;
                                patchRowRange(iso, iso !== "" && due !== "" && iso > due ? "" : due);
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-center" style={{ width: COL_END_W }}>
                            <InlineDateCell
                              valueIso={rowTask === null ? "" : rowTask.dueDate}
                              minDate={rowTask === null ? "" : rowTask.startDate}
                              ariaLabel={t("board.edit.aria", { field: fieldText(locale, "预计完成日期") })}
                              disabled={!datesEditable}
                              disabledHint={editHint}
                              placement="below"
                              triggerClassName="tabular-nums text-[11px] text-slate-600"
                              display={rowTask === null || rowTask.dueDate === "" ? <span className="text-slate-300">—</span> : mdText(locale, rowTask.dueDate)}
                              onChange={(iso) => {
                                patchRowRange(rowTask === null ? "" : rowTask.startDate, iso);
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-center" style={{ width: COL_HEADCOUNT_W }}>
                            <InlineNumberCell
                              value={rowTask === null ? 0 : rowTask.headcount}
                              ariaLabel={t("board.edit.aria", { field: fieldText(locale, "预计所需施工人数") })}
                              disabled={!datesEditable}
                              disabledHint={editHint}
                              display={rowTask !== null && rowTask.headcount > 0 ? t("drawer.headcount.value", { n: rowTask.headcount }) : <span className="text-slate-300">—</span>}
                              onSave={(value) => {
                                if (rowTask !== null) {
                                  onPatchTask?.(rowTask.id, { headcount: value });
                                }
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-center" style={{ width: COL_PROGRESS_W }}>
                            {rowTask !== null && (rowTask.startDate === "" || rowTask.dueDate === "") ? (
                              <span className="text-[11px] text-slate-400">{t("gantt.unscheduled")}</span>
                            ) : (
                              <TrackerDots
                                progress={rowTask === null ? 0 : rowTask.progress}
                                hovered={trackerHover}
                                onHoverChange={setTrackerHover}
                                disabled={!progressEditable}
                                disabledHint={editHint}
                                onChange={(next) => {
                                  if (rowTask !== null) {
                                    onSetProgress?.(rowTask.id, next);
                                  }
                                }}
                              />
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* 拖这条线 = 移动右侧时间轴的左边界（左表被盖住多少），双击复位到全露（官方 frame.verticalSplitLineMoveable + verticalSplitLineHighlight）：高亮线压在分隔线本身上 */}
              <span
                className="absolute -right-2 top-0 z-30 h-full w-4 cursor-col-resize touch-none"
                title={t("gantt.splitter.title")}
                onPointerDown={beginSplit}
                onPointerMove={moveSplit}
                onPointerUp={endSplit}
                onPointerCancel={endSplit}
                onDoubleClick={() => {
                  setLeftWidth(LEFT_W_DEFAULT);
                }}
                onMouseEnter={() => {
                  setSplitHover(true);
                }}
                onMouseLeave={() => {
                  setSplitHover(false);
                }}
              >
                <span
                  className={"absolute inset-y-0 left-2 w-[2px] " + (splitHover || splitActive ? "bg-blue-500" : "bg-transparent")}
                  aria-hidden="true"
                />
              </span>
            </div>

            <div className="relative" style={{ width: totalWidth }}>
              {/* 表头两排（官方 timelineHeader.scales）：上排 = 月粒度下写年份、日 / 周粒度下写月份；
                  下排 = 日粒度逐日、周粒度逐周（「M/D」）、月粒度逐月（「5月」）。今天那一列整列加蓝底。 */}
              <div className="sticky top-0 z-10 bg-white">
                <div className="flex border-b border-slate-200 bg-slate-50/90" style={{ height: HEADER_H }}>
                  {(scale === "month" ? model.years : model.months).map((unit) => {
                    const unitWidth = unit.days * dayWidth;
                    return (
                      <div
                        key={unit.key}
                        className="flex items-center justify-center overflow-hidden whitespace-nowrap border-r border-zinc-200 px-1 text-xs font-semibold text-zinc-700"
                        style={{ width: unitWidth }}
                        title={unit.label}
                      >
                        {unitWidth >= 32 ? unit.label : null}
                      </div>
                    );
                  })}
                </div>
                <div className="flex border-b border-zinc-200 bg-white" style={{ height: HEADER_H }}>
                  {headerUnits === null
                    ? Array.from({ length: model.days }, (_item, index) => {
                        const isWeekend = weekendSet.has(index);
                        const isToday = todayIndex === index;
                        return (
                          <div
                            key={"day-" + String(index)}
                            className={
                              "flex items-center justify-center text-[10px] tabular-nums " +
                              (isToday ? "bg-blue-50 font-semibold text-blue-600" : isWeekend ? "bg-slate-50/80 text-slate-400" : "text-slate-600")
                            }
                            style={{ width: dayWidth }}
                          >
                            {String(dayOfMonth(shiftDays(model.rangeStart, index)))}
                          </div>
                        );
                      })
                    : headerUnits.map((unit, index) => {
                        const isToday = index === todayUnitIndex;
                        const unitWidth = unit.days * dayWidth;
                        return (
                          <div
                            key={unit.key}
                            className={
                              "flex items-center justify-center overflow-hidden whitespace-nowrap border-r border-zinc-200 px-1 text-[10px] tabular-nums " +
                              (isToday ? "bg-blue-50 font-semibold text-blue-600" : "text-zinc-600")
                            }
                            style={{ width: unitWidth }}
                            title={unit.label}
                          >
                            {unitWidth >= 22 ? unit.label : null}
                          </div>
                        );
                      })}
                </div>
              </div>

              {/* 网格随粒度：竖线 = 日粒度逐日 / 周粒度逐周（月粒度交给月线），周末底纹只在日粒度（周 / 月粒度太密），
                  月线一直有、年线只在月粒度 —— 条 / 今天线不受影响，仍按天精确落点。 */}
              <div className="relative" style={scale === "day" ? dayLineStyle(dayWidth) : undefined}>
                {scale !== "day"
                  ? null
                  : model.weekends.map((index) => (
                      <span
                        key={"weekend-" + String(index)}
                        className="absolute inset-y-0 bg-slate-50/70"
                        style={{ left: index * dayWidth, width: dayWidth, ...dayLineStyle(dayWidth) }}
                        aria-hidden="true"
                      />
                    ))}
                {scale === "month"
                  ? null
                  : model.weekStarts.map((index) => (
                      <span
                        key={"week-" + String(index)}
                        className={"absolute inset-y-0 border-l " + (scale === "week" ? "border-slate-300/80" : "border-slate-200/80")}
                        style={{ left: index * dayWidth }}
                        aria-hidden="true"
                      />
                    ))}
                {model.monthStarts.map((index) => (
                  <span
                    key={"month-line-" + String(index)}
                    className="absolute inset-y-0 border-l border-slate-300/80"
                    style={{ left: index * dayWidth }}
                    aria-hidden="true"
                  />
                ))}
                {scale !== "month"
                  ? null
                  : model.yearStarts.map((index) => (
                      <span
                        key={"year-line-" + String(index)}
                        className="absolute inset-y-0 border-l border-slate-400/80"
                        style={{ left: index * dayWidth }}
                        aria-hidden="true"
                      />
                    ))}
                {model.rows.map((row) => {
                  const isHovered = hovered === row.key;
                  const isGroup = row.kind === "group";
                  return (
                    <div
                      key={row.key}
                      onMouseEnter={() => {
                        setHovered(row.key);
                      }}
                      onMouseLeave={() => {
                        setHovered(null);
                      }}
                      onClick={clearSelection}
                      onDoubleClick={isGroup ? undefined : (event) => createBarOnDoubleClick(event, row.bar)}
                      className={
                        "relative border-b border-slate-100 " +
                        (isGroup
                          ? isHovered
                            ? "z-[1] bg-slate-100/55"
                            : "z-[1] bg-slate-50/45"
                          : isHovered
                            ? "z-[3] bg-slate-50/60"
                            : "z-[3]")
                      }
                      style={{ height: ROW_H }}
                    >
                      {isGroup ? renderGroupBar(row.group) : renderTaskBar(row.bar)}
                    </div>
                  );
                })}
                {todayLeft === null ? null : (
                  <span
                    className="pointer-events-none absolute inset-y-0 z-[4] border-l border-dashed border-blue-500/80"
                    style={{ left: todayLeft }}
                    aria-hidden="true"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      {vBar === null ? null : (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-40 w-3">
          <div
            role="scrollbar"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={vBar.progress}
            onPointerDown={(event) => {
              beginScrollbarDrag(event, "vertical", vBar.size, scrollRef.current === null ? 0 : scrollRef.current.clientHeight);
            }}
            style={{ height: vBar.size, top: BAR_TRACK_INSET + vBar.offset }}
            className={
              "pointer-events-auto absolute left-1/2 w-1.5 -translate-x-1/2 cursor-grab rounded-full bg-zinc-400/70 transition-opacity duration-200 hover:bg-zinc-500 active:cursor-grabbing active:bg-zinc-500 " +
              (barActive ? "opacity-100" : "opacity-0 hover:opacity-100")
            }
          />
        </div>
      )}
      {/* 横向滑块：fixed 在整个窗口底部（业务口径「要固定在全局 不然不方便」）——页面 / 卡片怎么滚都够得着；轨道宽按窗口可视宽算 */}
      {hBar === null ? null : (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-3">
          <div
            role="scrollbar"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={hBar.progress}
            onPointerDown={(event) => {
              beginScrollbarDrag(event, "horizontal", hBar.size, bottomBarTrack());
            }}
            style={{ width: hBar.size, left: BAR_TRACK_INSET + hBar.offset }}
            className="pointer-events-auto absolute top-1/2 h-1.5 -translate-y-1/2 cursor-grab rounded-full bg-zinc-400/70 opacity-60 transition-opacity duration-200 hover:bg-zinc-500 hover:opacity-100 active:cursor-grabbing active:bg-zinc-500"
          />
        </div>
      )}
      </div>
    </div>
  );
}
