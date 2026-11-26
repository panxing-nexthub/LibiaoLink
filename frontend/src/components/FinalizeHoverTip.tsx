import type { TextKey } from "../i18n";
import type { TaskFinalizeReadiness } from "../data/tasks";

/** 定档门禁悬停说明（2026-11-26 抽公共组件）：任务抽屉头部「定档」开关与任务文件列「＋ 添加定档文件」
 *  共用同一视觉与文案口径 —— 白卡浮层 + 状态点 + 标题 / 原因两行，200ms 淡入上移。
 *  父级需要带 group/finalize（悬停 / 键盘聚焦触发）。 */
export function FinalizeHoverTip({ ready, title, body }: { ready: boolean; title: string; body: string }) {
  return (
    <span
      role="tooltip"
      data-task-finalize-tip={ready ? "ready" : "blocked"}
      className="pointer-events-none invisible absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-3rem)] translate-y-1 rounded-[10px] border border-zinc-200/80 bg-white px-3 py-2 text-left opacity-0 shadow-[0_1px_2px_rgba(15,23,42,0.08),0_12px_28px_-14px_rgba(15,23,42,0.35)] transition-[opacity,transform,visibility] duration-200 ease-out group-hover/finalize:visible group-hover/finalize:translate-y-0 group-hover/finalize:opacity-100 group-focus-within/finalize:visible group-focus-within/finalize:translate-y-0 group-focus-within/finalize:opacity-100"
    >
      <span className="flex items-start gap-2">
        <span className={"mt-1 h-1.5 w-1.5 shrink-0 rounded-full " + (ready ? "bg-emerald-500" : "bg-amber-400")} aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold text-zinc-800">{title}</span>
          <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">{body}</span>
        </span>
      </span>
    </span>
  );
}

export type FinalizeTipTranslator = (key: TextKey, params?: Record<string, string | number>) => string;

/** 与任务定档开关同一套阻塞原因文案：任务未完成 / 文件核对中 / 缺成果文件。 */
export function finalizeBlockedTextOf(t: FinalizeTipTranslator, readiness: TaskFinalizeReadiness): string {
  if (readiness.blocker === "not-complete") return t("drawer.finalize.blockedNotComplete");
  if (readiness.blocker === "files-loading") return t("drawer.finalize.blockedFilesLoading");
  if (readiness.blocker === "missing-files") {
    return t("drawer.finalize.blockedMissingFiles", { types: readiness.missingDocTypes.join("、") });
  }
  return t("drawer.finalize.blockedAria");
}
