import { useEffect, useRef, useState } from "react";

export type ResponsiveChartSize = {
  readonly width: number;
  readonly height: number;
};

/**
 * 仪表盘 SVG 图表测量：用容器实际像素作为 viewBox，避免整张图随屏幕等比缩放导致字号忽大忽小。
 * 初始值只用于首帧占位；挂载后由 ResizeObserver 持续同步宽高，窗口缩放 / 侧栏开合 / 滑轨展开都会重算。
 */
export function useResponsiveChartSize(fallbackWidth = 640, fallbackHeight = 220): {
  readonly ref: React.RefObject<HTMLDivElement | null>;
  readonly width: number;
  readonly height: number;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ResponsiveChartSize>({ width: fallbackWidth, height: fallbackHeight });

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const measure = (): void => {
      const width = Math.max(1, Math.floor(node.clientWidth));
      const height = Math.max(1, Math.floor(node.clientHeight));
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
