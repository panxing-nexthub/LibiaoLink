import type { ReactNode } from "react";

/**
 * 仪表盘页内纵向滑轨（2026-11-21 业务口径「现在全做成滑动的好吗 就像地图和仪表盘这样切换一样」）：
 * 每页占满当前仪表盘内容区，切换时轨道整体上移 / 下移一格（600ms ease），
 * 与顶层地图 ⇄ 仪表盘刚体滑轨同形。页面常驻，不卸载已加载图表。
 */
export function HubDashSlideDeck({ activeIndex, children, allProjects = false }: {
  readonly activeIndex: number;
  readonly children: ReactNode;
  readonly allProjects?: boolean;
}) {
  return (
    <div className="hub-dash-slide-deck" data-hub-dash-slider="" data-all-projects={allProjects ? "true" : undefined}>
      <div className="hub-dash-slide-track" data-slide-index={activeIndex} style={{ transform: "translateY(" + activeIndex * -100 + "%)" }}>
        {children}
      </div>
    </div>
  );
}
