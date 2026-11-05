import type { SessionInterruptionReason } from "@ancientvoid/contracts";
import { useState } from "preact/hooks";
import type { NormalizedEvent } from "../../shared/ws.ts";

const REASONS: Record<SessionInterruptionReason, string> = {
  worker_exit: "Agent-Prozess unerwartet beendet",
  hub_restart: "Hub neu gestartet — Agent-Prozess nicht mehr vorhanden",
  adapter_down: "Verbindung zum Adapter verloren",
};

export function InterruptedBanner({ events, since, canResume, onResume, onArchive }: {
  events: NormalizedEvent[];
  since: string;
  canResume: boolean;
  onResume: () => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const event = [...events].reverse().find(e => e.payload.kind === "session.interrupted");
  const reason = String(event?.payload.reason ?? "Unterbrechung erkannt");
  const at = typeof event?.payload.since === "string" ? event.payload.since : since;
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <section class="interrupted-banner" role="status" aria-label="Session unterbrochen">
    <strong>Session unterbrochen</strong>
    <p>{Object.hasOwn(REASONS, reason) ? REASONS[reason as SessionInterruptionReason] : reason} · <time dateTime={at}>{new Date(at).toLocaleString("de-DE")}</time></p>
    {event?.payload.lastTurnId && <p>Letzter Zug: {String(event.payload.lastTurnId)}</p>}
    {!canResume && <p>Dieser Adapter kann nicht nativ fortsetzen. Neue Nachricht mit Kontext senden oder archivieren.</p>}
    <div class="row">
      <button class="btn" disabled={busy || !canResume} onClick={() => void act(onResume)}>Weitermachen</button>
      <button class="btn" disabled={busy} onClick={() => void act(onArchive)}>Archivieren</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
