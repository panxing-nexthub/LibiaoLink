import { fieldText, useLocale, useT } from "../i18n";
import {
  DEFAULT_OVERVIEW_TASK_COLUMNS,
  OVERVIEW_TASK_COLUMNS,
  type OverviewTaskColumnKey,
  type OverviewTaskColumns,
} from "../overviewExportShared";

type OverviewColumnSelectorProps = {
  columns: OverviewTaskColumns;
  onChange: (next: OverviewTaskColumns) => void;
};

/** 任务明细的简单列显示开关：只控制预览与 PDF 是否展示列，不筛选行数据。 */
export function OverviewColumnSelector({ columns, onChange }: OverviewColumnSelectorProps) {
  const t = useT();
  const locale = useLocale();
  const selectedCount = OVERVIEW_TASK_COLUMNS.filter((column) => columns[column.key]).length;

  const toggle = (key: OverviewTaskColumnKey) => {
    if (columns[key] && selectedCount <= 1) {
      return;
    }
    onChange({ ...columns, [key]: !columns[key] });
  };

  return (
    <section data-overview-columns="" className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-zinc-700">{t("export.columns.title")}</div>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_OVERVIEW_TASK_COLUMNS })}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:bg-white hover:text-zinc-900"
        >
          {t("export.columns.reset")}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {OVERVIEW_TASK_COLUMNS.map((column) => {
          const checked = columns[column.key];
          const locked = checked && selectedCount <= 1;
          return (
            <label
              key={column.key}
              data-overview-column={column.key}
              className={
                "flex min-h-8 cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px] transition " +
                (checked
                  ? "border-zinc-300 bg-white font-medium text-zinc-800 shadow-sm"
                  : "border-zinc-200 bg-white/50 text-zinc-500 hover:border-zinc-300 hover:bg-white") +
                (locked ? " cursor-not-allowed opacity-70" : "")
              }
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={() => toggle(column.key)}
                className="h-3.5 w-3.5 shrink-0 accent-zinc-900"
              />
              <span className="min-w-0 truncate">{fieldText(locale, column.label)}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
