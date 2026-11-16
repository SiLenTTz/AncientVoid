import { getHeapStatistics } from "node:v8";
import type { HubMemoryCheck } from "@ancientvoid/contracts";

/** Anteil des V8-Heap-Limits, ab dem gewarnt bzw. kritisch gemeldet wird. */
export const MEMORY_WARN_RATIO = 0.6;
export const MEMORY_CRITICAL_RATIO = 0.8;

const MB = 1024 * 1024;

export function memoryCheck(
  usage: { heapUsed: number; rss: number } = process.memoryUsage(),
  heapLimit: number = getHeapStatistics().heap_size_limit,
): HubMemoryCheck {
  const ratio = usage.heapUsed / heapLimit;
  const level = ratio >= MEMORY_CRITICAL_RATIO ? "critical" : ratio >= MEMORY_WARN_RATIO ? "warn" : "ok";
  const heapUsedMb = Math.round(usage.heapUsed / MB);
  const heapLimitMb = Math.round(heapLimit / MB);
  return {
    ok: level === "ok",
    level,
    heapUsedMb,
    heapLimitMb,
    rssMb: Math.round(usage.rss / MB),
    ...(level === "ok" ? {} : { detail: `Heap bei ${Math.round(ratio * 100)} % des Limits (${heapUsedMb} von ${heapLimitMb} MB)` }),
  };
}

/**
 * Meldet nur Stufenwechsel, nicht jeden Tick: ein Hub, der bei 70 % steht,
 * soll das Log nicht jede halbe Minute füllen.
 */
export function watchMemory(
  onChange: (check: HubMemoryCheck, previous: HubMemoryCheck["level"]) => void,
  opts: { intervalMs?: number; sample?: () => HubMemoryCheck } = {},
): () => void {
  const sample = opts.sample ?? memoryCheck;
  let last: HubMemoryCheck["level"] = "ok";
  const tick = () => {
    const check = sample();
    if (check.level !== last) {
      const previous = last;
      last = check.level;
      onChange(check, previous);
    }
  };
  const timer = setInterval(tick, opts.intervalMs ?? 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
