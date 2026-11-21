import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** 仪表盘筛选记忆键：按登录账号隔离，避免同机换账号串用筛选。 */
export function dashboardFilterKey(viewerId: string, name: string): string {
  return "libiaolink.dashboard.filters.v1." + viewerId + "." + name;
}

function initialValueOf<T>(fallback: T | (() => T)): T {
  return typeof fallback === "function" ? (fallback as () => T)() : fallback;
}

/**
 * 仪表盘筛选状态 + 本机记忆。
 * storageKey = null 时不读写 localStorage（例如单项目筛选保持原行为）。
 */
export function usePersistentDashboardFilter<T>(
  storageKey: string | null,
  fallback: T | (() => T),
  isValid: (value: unknown) => value is T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (storageKey === null || typeof window === "undefined") return initialValueOf(fallback);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (isValid(parsed)) return parsed;
      }
    } catch {
      // localStorage 不可用或内容损坏时回退默认值。
    }
    return initialValueOf(fallback);
  });

  useEffect(() => {
    if (storageKey === null || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // 隐私模式 / 配额限制下静默降级，不影响页面使用。
    }
  }, [storageKey, value]);

  return [value, setValue];
}
