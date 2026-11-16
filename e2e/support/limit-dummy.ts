import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import type { Adapter, AdapterContext, SessionSpec } from "@ancientvoid/contracts";

/** ADR-0076 Nachtrag (Limit-Wiederaufnahme): deterministischer Kontingent-
 * Ausfall in einem isolierten Test-Hub. Der erste Lauf stirbt am Limit
 * (provider.error quota + ein seit kurzem freies Fenster, ADR-0004); ein
 * fortgesetzter Lauf (resumeSessionId) arbeitet normal weiter. */
export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const base = createDummy({ eventsPerSecond: 20, autoStopAfterEvents: 3, ...(config ?? {}) });
  return {
    ...base,
    async start(spec: SessionSpec, ctx: AdapterContext) {
      if (spec.args?.resumeSessionId) return base.start(spec, ctx);
      // Native Identität wie der Basis-Dummy mit hubResume — die Auto-
      // Wiederaufnahme braucht sie (ADR-0076: native Fortsetzung).
      ctx.emit({ type: "system", summary: "native id", payload: { nativeSessionId: ctx.sessionId } });
      // Kontingent-Schnappschuss wie Claude ihn liefert — das Fenster ist
      // bereits frei (resetsAt vorbei), damit die Wiederaufnahme sofort darf.
      ctx.emit({
        type: "system",
        summary: "e2e: rate-limit status update",
        payload: { info: { status: "rejected", rateLimitType: "five_hour" } },
        usageQuota: { windows: [{ id: "five_hour", utilization: 1.03, resetsAt: new Date(Date.now() - 60_000).toISOString() }] },
      });
      ctx.turn?.("working");
      ctx.emit({ type: "system", summary: "e2e: Kontingent erschöpft", payload: { kind: "provider.error", category: "quota", title: "Kontingent erschöpft (session)", detail: "You've hit your session limit · längst frei" } });
      // Der Fehler muss vor dem Zugende im Journal stehen (ctx.emit ist
      // fire-and-forget) — wie bei einem echten CLI, das den Fehlertext
      // ausgibt, bevor der Zug endet.
      await new Promise((resolve) => setTimeout(resolve, 150));
      ctx.turn?.("idle");
      return { sessionId: ctx.sessionId };
    },
  };
}
