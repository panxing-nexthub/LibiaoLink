import { statfs } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { CaseDataError } from "./database-credentials.mjs";

export function createRequestAdmission(maximum, perClient) {
  let active = 0;
  const clients = new Map();
  return (clientId) => {
    const count = clients.get(clientId) ?? 0;
    if (count >= perClient) return { status: 429, code: "CLIENT_CONCURRENCY_LIMIT", message: "服务并发请求过多" };
    if (active >= maximum) return { status: 503, code: "GATEWAY_BUSY", message: "案例网关暂忙" };
    active += 1;
    clients.set(clientId, count + 1);
    return { release() {
      active -= 1;
      const remaining = clients.get(clientId) - 1;
      if (remaining === 0) clients.delete(clientId);
      else clients.set(clientId, remaining);
    } };
  };
}

function usePercent(stats) {
  if (stats.blocks <= 0n || stats.bavail < 0n || stats.bavail > stats.blocks) throw new CaseDataError("容量样本无效");
  return Number(((stats.blocks - stats.bavail) * 100n + stats.blocks - 1n) / stats.blocks);
}

export function createCapacityGuard({ locations, warning, stopUploads, stopWrites }, {
  sample = statfs, clock = () => performance.now(), notify = (event) => console.warn(JSON.stringify(event)),
} = {}) {
  if (locations === undefined) return async () => null;
  let paths;
  try { paths = JSON.parse(locations); } catch { throw new CaseDataError("容量探测路径须为绝对路径 JSON 数组"); }
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 8 ||
      !paths.every((path) => typeof path === "string" && isAbsolute(path))) {
    throw new CaseDataError("容量探测路径须为 1 至 8 个绝对路径的 JSON 数组");
  }
  if (!(warning < stopUploads && stopUploads < stopWrites)) throw new CaseDataError("容量水位须按预警、暂停上传、只读严格递增");

  let nextSample = 0;
  let currentLevel;
  let pending;
  function inspect() {
    if (clock() < nextSample) return currentLevel;
    pending ??= Promise.all(paths.map(async (path) => usePercent(await sample(path, { bigint: true }))))
      .then((values) => {
        const percent = Math.max(...values);
        const level = percent >= stopWrites ? "read-only" : percent >= stopUploads ? "no-uploads" :
          percent >= warning ? "warning" : "normal";
        return { level, percent };
      }, () => ({ level: "unavailable" }))
      .then(({ level, percent }) => {
        if (level !== currentLevel && (level !== "normal" || currentLevel !== undefined)) {
          notify({ event: "case_capacity_changed", level, percent });
        }
        currentLevel = level;
        nextSample = clock() + 1000;
        pending = undefined;
        return level;
      });
    return pending;
  }

  return async (effect) => {
    if (effect === "read" || effect === "withdraw") return null;
    const level = await inspect();
    if (level === "unavailable") return "CAPACITY_UNAVAILABLE";
    if (level === "read-only") return "CAPACITY_READ_ONLY";
    if (level === "no-uploads" && effect === "upload") return "CAPACITY_UPLOAD_PAUSED";
    return null;
  };
}

export function createStorageCircuit(clock = () => performance.now()) {
  let failures = 0;
  let openUntil = 0;
  let probing = false;
  let generation = 0;
  return () => {
    if (probing || clock() < openUntil) return null;
    const started = generation;
    if (openUntil) probing = true;
    return (healthy) => {
      // 已开路时忽略上一个周期尚未返回的请求。
      if (started !== generation) return;
      if (healthy) {
        failures = 0;
        openUntil = 0;
        probing = false;
      } else if (++failures >= 3 || probing) {
        generation += 1;
        openUntil = clock() + 5000;
        probing = false;
      }
    };
  };
}
