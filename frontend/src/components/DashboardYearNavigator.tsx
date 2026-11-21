import { useT } from "../i18n";

/** 年份键：null 表示启动年份未记录。 */
export type DashboardYearKey = number | null;

/** 年份筛选每页固定显示 5 个；未记录作为独立可筛选项。 */
export const DASHBOARD_YEAR_WINDOW = 5;

function keyOf(year: DashboardYearKey): string {
  return year === null ? "unknown" : String(year);
}

function includesYear(years: readonly DashboardYearKey[], year: DashboardYearKey): boolean {
  return years.some((item) => item === year);
}

function YearArrowIcon({ direction }: { readonly direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 1662 1024" aria-hidden="true" focusable="false" className="hub-dash-project-types__arrowIcon">
      <g transform={direction === "left" ? "translate(1662 0) scale(-1 1)" : undefined}>
        <path d="M1110.10503692 502.370245c0 15.073971-5.024657 25.123286-15.068947 35.167575l-452.128698 452.128698c-20.098629 20.098629-50.236522 20.098629-70.33515 0-20.088579-20.093604-20.088579-50.23652199 0-70.330126l416.966147-416.966147-416.966147-416.971172c-20.088579-20.088579-20.088579-50.23652199 0-70.325102 20.098629-20.098629 50.236522-20.098629 70.33515 0L1095.03608992 467.202669c10.04429 10.04429 15.06894699 20.088579 15.068947 35.167576z" fill="currentColor" />
        <path d="M1063.16653992 516.16359421c0 6.51192663-2.1713659 10.85465844-6.51192663 15.19521916l-195.38385183 195.38385183c-8.68546405 8.68546405-21.70931687 8.68546405-30.39478049 0-8.68112102-8.68329253-8.68112102-21.70931687 0-30.3926094L1011.06461365 516.16359421l-180.18863268-180.1929757c-8.68112102-8.68112102-8.68112102-21.70931687 1e-8-30.39043789 8.68546405-8.68546405 21.70931687-8.68546405 30.39478048 0L1056.65461329 500.96403245c4.34056072 4.34273181 6.51192663 8.68329253 6.51192663 15.19956176z" fill="currentColor" />
      </g>
    </svg>
  );
}

/**
 * 年份多选筛选条：蓝色方块 = 已选，灰色方块 = 未选。
 * 样式复用项目数量图的年份控件，保证全部项目各屏手感一致。
 */
export function DashboardYearNavigator({
  numericYears,
  hasUnknownYear,
  selectedYears,
  onToggleYear,
  windowStart,
  onWindowStartChange,
}: {
  readonly numericYears: readonly number[];
  readonly hasUnknownYear: boolean;
  readonly selectedYears: readonly DashboardYearKey[];
  readonly onToggleYear: (year: DashboardYearKey) => void;
  readonly windowStart: number;
  readonly onWindowStartChange: (start: number) => void;
}) {
  const t = useT();
  const yearText = (year: DashboardYearKey): string => year === null ? t("hub.dash.projects.unknownYear") : String(year);
  const visibleYears = numericYears.slice(windowStart, windowStart + DASHBOARD_YEAR_WINDOW);
  return (
    <div className="hub-dash-project-types__yearNavigator" role="group" aria-label={t("hub.dash.projects.startYear.pickYear")}>
      <button
        type="button"
        className="hub-dash-project-types__arrow"
        disabled={windowStart <= 0}
        aria-label={t("hub.dash.projects.yearPrev")}
        onClick={() => onWindowStartChange(Math.max(0, windowStart - DASHBOARD_YEAR_WINDOW))}
      >
        <YearArrowIcon direction="left" />
      </button>
      <div className="hub-dash-project-types__yearChips">
        {visibleYears.map((year) => {
          const active = includesYear(selectedYears, year);
          return (
            <button
              key={keyOf(year)}
              type="button"
              className="hub-dash-project-types__yearChip"
              data-active={active ? "true" : "false"}
              aria-pressed={active}
              onClick={() => onToggleYear(year)}
            >
              <i /><span>{yearText(year)}</span>
            </button>
          );
        })}
        {hasUnknownYear ? (() => {
          const active = includesYear(selectedYears, null);
          return (
            <button
              type="button"
              className="hub-dash-project-types__yearChip"
              data-active={active ? "true" : "false"}
              aria-pressed={active}
              onClick={() => onToggleYear(null)}
            >
              <i /><span>{yearText(null)}</span>
            </button>
          );
        })() : null}
      </div>
      <button
        type="button"
        className="hub-dash-project-types__arrow"
        disabled={windowStart + DASHBOARD_YEAR_WINDOW >= numericYears.length}
        aria-label={t("hub.dash.projects.yearNext")}
        onClick={() => onWindowStartChange(Math.min(Math.max(0, numericYears.length - DASHBOARD_YEAR_WINDOW), windowStart + DASHBOARD_YEAR_WINDOW))}
      >
        <YearArrowIcon direction="right" />
      </button>
    </div>
  );
}
