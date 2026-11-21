import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type FixedHorizontalScrollbarProps = {
  scrollRef: { current: HTMLDivElement | null };
  active?: boolean;
  ariaLabel?: string;
};

type Metrics = {
  left: number;
  width: number;
  scrollWidth: number;
};

const BAR_HEIGHT = 18;
const OVERFLOW_EPSILON = 1;

/**
 * 将横向原生滚动条固定到视口底部，并同步到实际滚动容器。
 * 实际容器需隐藏自身横向滚动条，避免同时出现两条可见滑动栏。
 */
export function FixedHorizontalScrollbar({
  scrollRef,
  active = true,
  ariaLabel,
}: FixedHorizontalScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const measure = useCallback(() => {
    const node = scrollRef.current;
    if (!active || node === null || !node.isConnected) {
      setMetrics(null);
      return;
    }
    const rect = node.getBoundingClientRect();
    const width = Math.round(node.clientWidth);
    const scrollWidth = Math.ceil(node.scrollWidth);
    if (rect.width <= 0 || width <= 0 || scrollWidth <= width + OVERFLOW_EPSILON) {
      setMetrics(null);
      return;
    }
    const next = { left: Math.round(rect.left), width, scrollWidth };
    setMetrics((current) =>
      current !== null &&
      current.left === next.left &&
      current.width === next.width &&
      current.scrollWidth === next.scrollWidth
        ? current
        : next,
    );
  }, [active, scrollRef]);

  useLayoutEffect(() => {
    if (!active) {
      setMetrics(null);
      return;
    }
    const node = scrollRef.current;
    if (node === null) {
      setMetrics(null);
      return;
    }

    measure();
    const syncFromViewport = (): void => {
      const track = trackRef.current;
      if (track !== null && Math.abs(track.scrollLeft - node.scrollLeft) > 1) {
        track.scrollLeft = node.scrollLeft;
      }
    };
    syncFromViewport();
    node.addEventListener("scroll", syncFromViewport, { passive: true });

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of Array.from(node.children)) {
      observer.observe(child);
    }
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);

    return () => {
      node.removeEventListener("scroll", syncFromViewport);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active, measure, scrollRef]);

  if (!active || metrics === null) {
    return null;
  }

  return createPortal(
    <div
      ref={(node) => {
        trackRef.current = node;
        const scroller = scrollRef.current;
        if (node !== null && scroller !== null && Math.abs(node.scrollWidth - scroller.scrollWidth) <= 1) {
          node.scrollLeft = scroller.scrollLeft;
        }
      }}
      data-fixed-horizontal-scrollbar=""
      role="group"
      aria-label={ariaLabel}
      tabIndex={0}
      style={{ left: metrics.left, width: metrics.width, height: BAR_HEIGHT }}
      className="fixed bottom-0 z-[60] overflow-x-scroll overflow-y-hidden border-t border-zinc-200 bg-white/95 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
      onScroll={(event) => {
        const node = scrollRef.current;
        const track = event.currentTarget;
        if (node === null) {
          return;
        }
        if (Math.abs(track.scrollWidth - node.scrollWidth) > 1) {
          measure();
          return;
        }
        if (Math.abs(node.scrollLeft - track.scrollLeft) > 1) {
          node.scrollLeft = track.scrollLeft;
        }
      }}
    >
      <div aria-hidden="true" style={{ width: metrics.scrollWidth, height: 1 }} />
    </div>,
    document.body,
  );
}
