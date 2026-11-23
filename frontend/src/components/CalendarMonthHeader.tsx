import { useEffect, useMemo, useRef, useState } from "react";
import { monthShortText, useLocale, useT } from "../i18n";
import { ScrollArea } from "./ScrollArea";

const YEAR_FROM = 1900;
const YEAR_TO = 2100;

type CalendarMonthHeaderProps = {
  view: Date;
  onViewChange: (next: Date) => void;
  prevLabel: string;
  nextLabel: string;
};

type CalendarSelectOption = {
  value: number;
  label: string;
};

type CalendarSelectProps = {
  kind: "year" | "month";
  ariaLabel: string;
  value: number;
  options: CalendarSelectOption[];
  onChange: (value: number) => void;
  triggerClassName: string;
  menuClassName: string;
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

/** 年月下拉：沿用站内下拉的白色浮层、圆角、灰底悬停与绿勾选中，不再使用浏览器原生 select 菜单。 */
function CalendarSelect({ kind, ariaLabel, value, options, onChange, triggerClassName, menuClassName }: CalendarSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const triggerLabel = selected === undefined ? String(value) : selected.label;

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const viewport = rootRef.current?.querySelector<HTMLElement>('[data-scroll-area="vertical"]');
      const selectedOption = rootRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
      if (viewport === null || viewport === undefined || selectedOption === null || selectedOption === undefined) {
        return;
      }
      const viewportRect = viewport.getBoundingClientRect();
      const optionRect = selectedOption.getBoundingClientRect();
      viewport.scrollTop += optionRect.top - viewportRect.top - (viewport.clientHeight - optionRect.height) / 2;
    });
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={"relative shrink-0 " + triggerClassName}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        data-calendar-year-select={kind === "year" ? "true" : undefined}
        data-calendar-month-select={kind === "month" ? "true" : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          setOpen((previous) => !previous);
        }}
        className={
          "flex h-7 w-full items-center justify-center gap-1 rounded-lg px-1.5 text-sm font-semibold text-zinc-800 outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-300 " +
          (open ? "bg-zinc-100" : "hover:bg-zinc-100")
        }
      >
        <span className="truncate">{triggerLabel}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={"h-3 w-3 shrink-0 text-zinc-400 transition-transform " + (open ? "rotate-180" : "")}
        >
          <path d="M6 9.5l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-1/2 top-full z-30 mt-1 -translate-x-1/2">
          <div className={"overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-[0_16px_40px_rgba(15,23,42,0.18)] " + menuClassName}>
            <ScrollArea ariaLabel={ariaLabel} viewportClassName="max-h-56" className="max-h-56 overscroll-contain p-0.5">
              <div role="listbox" aria-label={ariaLabel}>
                {options.map((option) => {
                  const active = option.value === value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      className={
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition " +
                        (active
                          ? "bg-zinc-100 font-semibold text-zinc-900 "
                          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800")
                      }
                    >
                      <span className="whitespace-nowrap">{option.label}</span>
                      {active ? (
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-600">
                          <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
      ) : null}
    </div>
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
  const yearOptions = useMemo(() => years.map((option) => ({ value: option, label: String(option) })), [years]);
  const monthOptions = useMemo(
    () => Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: monthShortText(locale, index + 1) })),
    [locale],
  );

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
        <CalendarSelect
          kind="year"
          ariaLabel={t("picker.year")}
          value={year}
          options={yearOptions}
          onChange={(next) => {
            onViewChange(new Date(next, month, 1));
          }}
          triggerClassName="w-[4.35rem]"
          menuClassName="w-[5rem]"
        />
        <CalendarSelect
          kind="month"
          ariaLabel={t("picker.month")}
          value={month + 1}
          options={monthOptions}
          onChange={(next) => {
            onViewChange(new Date(year, next - 1, 1));
          }}
          triggerClassName="w-[4rem]"
          menuClassName="w-[5.25rem]"
        />
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
