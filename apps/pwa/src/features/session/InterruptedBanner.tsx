import type { SessionInterruptionReason } from "@ancientvoid/contracts";
import { useState } from "preact/hooks";
import type { NormalizedEvent } from "../../shared/ws.ts";

const REASONS: Record<SessionInterruptionReason, string> = {
  worker_exit: "Agent-Prozess unerwartet beendet",
  hub_restart: "Hub neu gestartet — Agent-Prozess nicht mehr vorhanden",
  adapter_down: "Verbindung zum Adapter verloren",
  provider_limit: "Limit des Providers erreicht",
};

/** ADR-0076 Nachtrag: Starb der Zug am Kontingent/Rate-Limit (oder meldete
 * der Provider ein gesperrtes Fenster)? Nur dann bietet das Banner die
 * automatische Fortsetzung an. */
function limitFailure(events: NormalizedEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    const kind = e.payload.kind;
    if (kind === "session.prompt" || kind === "session.handover_out") return false;
    if (e.type === "assistant") return false;
    if (kind === "provider.error") return e.payload.category === "quota" || e.payload.category === "rate_limit" || blockedWindow(events) !== undefined;
    if (kind === "cursor.usage_limit") return true;
  }
  return false;
}

/** Früheste noch laufende Freigabezeit der ausgelasteten Fenster (ADR-0004). */
function blockedWindow(events: NormalizedEvent[]): string | undefined {
  const quota = [...events].reverse().find(e => e.usageQuota !== undefined)?.usageQuota;
  let earliest: string | undefined;
  for (const w of quota?.windows ?? []) {
    if (w.utilization < 1) continue;
    const at = Date.parse(w.resetsAt);
    if (!Number.isFinite(at) || at <= Date.now()) continue;
    if (earliest === undefined || at < Date.parse(earliest)) earliest = w.resetsAt;
  }
  return earliest;
}

export function InterruptedBanner({ events, since, nativeResume, onResume, onArchive, failed = false, onStop, onHandover, autoResumeOnLimit = false, onAutoResumeLimit }: {
  events: NormalizedEvent[];
  since: string;
  /** true = Adapter deklariert hub-Resume; false = Weitermachen nutzt Prompt-Fallback. */
  nativeResume: boolean;
  onResume: () => Promise<void>;
  onArchive: () => Promise<void>;
  failed?: boolean;
  onStop?: () => Promise<void>;
  onHandover?: () => void;
  /** ADR-0076 Nachtrag: Option dieser Session — nach dem Limit-Fenster automatisch fortsetzen. */
  autoResumeOnLimit?: boolean;
  onAutoResumeLimit?: (on: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const event = [...events].reverse().find(e => e.payload.kind === "session.interrupted");
  const boundary = [...events].reverse().find(e => e.payload.kind === "session.prompt")?.seq ?? 0;
  const blocked = [...events].reverse().find(e => e.seq > boundary && (e.payload.kind === "session.recovery_blocked" || e.payload.kind === "session.recovery_failed" || e.payload.kind === "session.start_failed" || e.payload.kind === "provider.error" || e.type === "error"));
  const reason = String(event?.payload.reason ?? "Unterbrechung erkannt");
  const at = typeof event?.payload.since === "string" ? event.payload.since : since;
  const isLimit = event?.payload.limit === true || (failed && limitFailure(events));
  const resumesAt = typeof event?.payload.resumesAt === "string" ? event.payload.resumesAt : blockedWindow(events);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <section class="interrupted-banner" role="status" aria-label={failed ? "Session benötigt Entscheidung" : "Session unterbrochen"}>
    <strong>{failed ? "Session benötigt eine Entscheidung" : "Session unterbrochen"}</strong>
    {blocked && <p>{String(blocked.payload.detail ?? blocked.payload.reason ?? blocked.payload.error ?? blocked.summary)}</p>}
    <p>{Object.hasOwn(REASONS, reason) ? REASONS[reason as SessionInterruptionReason] : reason} · <time dateTime={at}>{new Date(at).toLocaleString("de-DE")}</time></p>
    {event?.payload.lastTurnId && <p>Letzter Zug: {String(event.payload.lastTurnId)}</p>}
    {!failed && !nativeResume && <p>Dieser Adapter setzt ohne natives Resume fort — Weitermachen sendet eine Fortsetzungsnachricht.</p>}
    {isLimit && autoResumeOnLimit && <p class="dim" role="status">Macht automatisch weiter, sobald das Limit frei ist{resumesAt ? <> — spätestens ab <time dateTime={resumesAt}>{new Date(resumesAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</time></> : ""}.</p>}
    <div class="row">
      {!failed && <button class="btn" disabled={busy} onClick={() => void act(onResume)}>Weitermachen</button>}
      {isLimit && onAutoResumeLimit && !autoResumeOnLimit && <button class="btn" disabled={busy} onClick={() => void act(() => onAutoResumeLimit(true))}>Nach Limit automatisch weitermachen</button>}
      {isLimit && onAutoResumeLimit && autoResumeOnLimit && <button class="btn" disabled={busy} onClick={() => void act(() => onAutoResumeLimit(false))}>Automatik aus</button>}
      {onStop && <button class="btn" disabled={busy} onClick={() => void act(onStop)}>Abbrechen</button>}
      {onHandover && <button class="btn" disabled={busy} onClick={onHandover}>An andere Session übergeben…</button>}
      <button class="btn" disabled={busy} onClick={() => void act(onArchive)}>Archivieren</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
