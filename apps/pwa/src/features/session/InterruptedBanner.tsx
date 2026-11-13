import type { SessionInterruptionReason } from "@ancientvoid/contracts";
import { useState } from "preact/hooks";
import type { NormalizedEvent } from "../../shared/ws.ts";

const REASONS: Record<SessionInterruptionReason, string> = {
  worker_exit: "Agent-Prozess unerwartet beendet",
  hub_restart: "Hub neu gestartet — Agent-Prozess nicht mehr vorhanden",
  adapter_down: "Verbindung zum Adapter verloren",
};

export function InterruptedBanner({ events, since, nativeResume, onResume, onArchive, failed = false, onStop, onHandover }: {
  events: NormalizedEvent[];
  since: string;
  /** true = Adapter deklariert hub-Resume; false = Weitermachen nutzt Prompt-Fallback. */
  nativeResume: boolean;
  onResume: () => Promise<void>;
  onArchive: () => Promise<void>;
  failed?: boolean;
  onStop?: () => Promise<void>;
  onHandover?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const event = [...events].reverse().find(e => e.payload.kind === "session.interrupted");
  const boundary = [...events].reverse().find(e => e.payload.kind === "session.prompt")?.seq ?? 0;
  const blocked = [...events].reverse().find(e => e.seq > boundary && (e.payload.kind === "session.recovery_blocked" || e.payload.kind === "session.recovery_failed" || e.payload.kind === "session.start_failed" || e.payload.kind === "provider.error" || e.type === "error"));
  const reason = String(event?.payload.reason ?? "Unterbrechung erkannt");
  const at = typeof event?.payload.since === "string" ? event.payload.since : since;
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
    <div class="row">
      {!failed && <button class="btn" disabled={busy} onClick={() => void act(onResume)}>Weitermachen</button>}
      {onStop && <button class="btn" disabled={busy} onClick={() => void act(onStop)}>Abbrechen</button>}
      {onHandover && <button class="btn" disabled={busy} onClick={onHandover}>An andere Session übergeben…</button>}
      <button class="btn" disabled={busy} onClick={() => void act(onArchive)}>Archivieren</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
