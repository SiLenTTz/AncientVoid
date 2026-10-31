/**
 * Example reporting sink (T4.1, ADR-0009): POSTs a completed session's
 * SessionSummary as JSON to a configured URL. No retry, no queue, no
 * knowledge of what the receiving end does with it — that's the whole
 * point of the Reporting-Sink-Contract boundary (the OSS core defines
 * `onSessionComplete`, it never becomes a specific consumer like Brain).
 *
 * Wire it into hub.config.json:
 *
 *   {
 *     "module": "./examples/reporting-sinks/webhook/sink.ts",
 *     "config": {
 *       "url": "https://example.com/ancientvoid-digest",
 *       "headers": { "Authorization": "Bearer <token>" }
 *     }
 *   }
 *
 * The ONLY thing a reporting sink is allowed to touch is @ancientvoid/contracts —
 * same rule as adapters (AGENTS.md).
 */
import { z } from "zod";
import type { ReportingSink } from "@ancientvoid/contracts";

const WebhookSinkConfig = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).default({}),
  /** Real, bounded — a hanging remote endpoint must never keep the hub's
   * digest dispatch loop (and therefore session.stop()'s cleanup path)
   * open indefinitely. */
  timeoutMs: z.number().int().positive().default(5000),
});

export function createSink(config?: Readonly<Record<string, unknown>>): ReportingSink {
  const cfg = WebhookSinkConfig.parse(config ?? {});

  return async (summary) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...cfg.headers },
        body: JSON.stringify(summary),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`webhook sink: ${cfg.url} responded ${res.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
