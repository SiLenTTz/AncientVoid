import { useEffect, useState } from "preact/hooks";
import { remoteHost } from "../../shared/api.ts";
import { StatusDot } from "../../shared/StatusDot.tsx";
import type { TileRef } from "../workspace/tiles.ts";
import { useHubStatus } from "./hub-status.ts";
import { useOpenWindows } from "../windows/windows.ts";
import { clockText, countSessions, fleetSummary } from "./status-summary.ts";

/**
 * EPIC-P23 T23.2 (desktop only): the one bar for what holds for the whole hub — connection, fleet,
 * sessions by state, open approvals — plus the focused tile's session. It reads what `App` polls.
 */
export function StatusBar({ focused, onOpenApprovals }: { focused: TileRef | null; onOpenApprovals: () => void }) {
  const hub = useHubStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const counts = countSessions(hub.sessions);
  // EPIC-P43 T43.7 (ADR-0068): wie viele eigene Fenster gerade leben.
  const windows = Object.keys(useOpenWindows()).length;
  const fleet = fleetSummary(hub.hosts);
  const session = focused ? hub.sessions.find((s) => s.id === focused.sessionId && remoteHost(s.hostId) === (focused.hostId ?? null)) : undefined;
  return (
    <div class="status-bar" role="status" aria-live="off" aria-label="Statusleiste">
      <span class={`status-item ${hub.connected ? "" : "bad"}`} title={hub.connected ? "Verbindung zum Hub steht" : hub.error}>
        <span class={`conn-dot ${hub.connected ? "live" : "closed"}`} />
        {hub.connected ? "verbunden" : `keine Verbindung · Stand ${clockText(hub.lastOkAt)}`}
      </span>
      <span class={`status-item ${fleet.problem ? "bad" : ""}`} title="Flotte">
        {fleet.text}
      </span>
      <span class="status-item" title="Sessions nach Zustand">
        {counts.working} läuft · {counts.waiting} wartet · {counts.error} Fehler · {counts.idle} bereit
      </span>
      {hub.pendingApprovals > 0 && (
        <button class="status-item status-link" type="button" onClick={onOpenApprovals} aria-live="polite">
          {hub.pendingApprovals} Freigabe{hub.pendingApprovals === 1 ? "" : "n"} offen
        </button>
      )}
      {windows > 0 && (
        <span class="status-item status-windows" title="Eigene Fenster">
          ⧉ {windows} Fenster
        </span>
      )}
      <span class="status-spacer" />
      {session && (
        <span class="status-item status-focus" title="Fokussierte Kachel">
          {session.title ?? session.project.split("/").filter(Boolean).pop()} · {session.adapter}
          {session.model ? ` · ${session.model}` : ""} · <StatusDot status={session.status} question={hub.questionSessions.includes(session.id)} />
        </span>
      )}
      <span class="status-item dim">{new Date(now).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>
    </div>
  );
}
