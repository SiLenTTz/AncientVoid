import type { HubMetrics, HubMetricsSnapshot } from "@uacc/contracts";

/** In-process counters. Process restart resets them — not K7 state (ADR-0010). */
export class InMemoryMetrics implements HubMetrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  snapshot(): HubMetricsSnapshot {
    return {
      ts: new Date().toISOString(),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }
}
