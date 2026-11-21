import { createPortal } from "react-dom";

/** 新仪表盘图表的统一白卡浮层（与既有仪表盘悬停卡同形态，但固定到视口，避免被滑轨裁切）。 */
export type DashboardHoverRow = {
  readonly label: string;
  readonly value: number | string;
  readonly color?: string;
};

export type DashboardHoverTip = {
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly subtitle?: string;
  readonly rows: readonly DashboardHoverRow[];
};

export function hoverTipAt(event: { readonly clientX: number; readonly clientY: number }, title: string, rows: readonly DashboardHoverRow[], subtitle?: string): DashboardHoverTip {
  return { x: event.clientX, y: event.clientY, title, subtitle, rows };
}

export function HubDashHoverTip({ tip }: { readonly tip: DashboardHoverTip | null }) {
  if (tip === null || typeof document === "undefined") return null;
  const width = 232;
  const estimatedHeight = 48 + tip.rows.length * 24 + (tip.subtitle === undefined ? 0 : 20);
  const left = Math.max(8, Math.min(tip.x + 14, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(tip.y + 14, window.innerHeight - estimatedHeight - 8));
  return createPortal(
    <div className="hub-dash-hoverCard" style={{ left, top, width }}>
      <div className="hub-dash-hoverCard__title">{tip.title}</div>
      {tip.subtitle !== undefined ? <div className="hub-dash-hoverCard__subtitle">{tip.subtitle}</div> : null}
      {tip.rows.map((row, index) => (
        <div className="hub-dash-hoverCard__row" key={row.label + ":" + index}>
          {row.color !== undefined ? <i style={{ background: row.color }} /> : <span className="hub-dash-hoverCard__spacer" />}
          <span className="hub-dash-hoverCard__label">{row.label}</span>
          <span className="hub-dash-hoverCard__value">{row.value}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
