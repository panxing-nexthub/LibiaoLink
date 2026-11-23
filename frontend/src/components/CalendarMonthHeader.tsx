import { useMemo } from "react";
import { monthShortText, useLocale, useT } from "../i18n";

const YEAR_FROM = 1900;
const YEAR_TO = 2100;

type CalendarMonthHeaderProps = {
  view: Date;
  onViewChange: (next: Date) => void;
  prevLabel: string;
  nextLabel: string;
};

function Arrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 日期弹层共用月历头部：年份 / 月份可直接下拉选择，左右箭头仍按月翻动。 */
export function CalendarMonthHeader({ view, onViewChange, prevLabel, nextLabel }: CalendarMonthHeaderProps) {
  const locale = useLocale();
  const t = useT();
  const year = view.getFullYear();
  const month = view.getMonth();
  const years = useMemo(() => {
    const first = Math.min(YEAR_FROM, year);
    const last = Math.max(YEAR_TO, year);
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }, [year]);

  const selectClass =
    "h-7 cursor-pointer appearance-none rounded-lg bg-transparent pl-1.5 pr-5 text-center text-sm font-semibold text-zinc-800 outline-none transition hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-300";

  return (
    <div className="flex items-center justify-between gap-1">
      <button
        type="button"
        aria-label={prevLabel}
        onClick={() => {
          onViewChange(new Date(year, month - 1, 1));
        }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100"
      >
        <Arrow direction="left" />
      </button>

      <div className="flex min-w-0 items-center justify-center gap-0.5">
        <div className="relative inline-flex items-center">
          <select
            data-calendar-year-select="true"
            aria-label={t("picker.year")}
            value={year}
            onChange={(event) => {
              onViewChange(new Date(Number(event.target.value), month, 1));
            }}
            className={selectClass + " w-[4.65rem]"}
          >
            {years.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="pointer-events-none absolute right-1.5 h-3 w-3 text-zinc-400">
            <path d="M6 9.5l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="relative inline-flex items-center">
          <select
            data-calendar-month-select="true"
            aria-label={t("picker.month")}
            value={month + 1}
            onChange={(event) => {
              onViewChange(new Date(year, Number(event.target.value) - 1, 1));
            }}
            className={selectClass + " w-[3.75rem]"}
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((option) => (
              <option key={option} value={option}>
                {monthShortText(locale, option)}
              </option>
            ))}
          </select>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="pointer-events-none absolute right-1.5 h-3 w-3 text-zinc-400">
            <path d="M6 9.5l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      <button
        type="button"
        aria-label={nextLabel}
        onClick={() => {
          onViewChange(new Date(year, month + 1, 1));
        }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100"
      >
        <Arrow direction="right" />
      </button>
    </div>
  );
}
