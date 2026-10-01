import { useEffect, useState } from "preact/hooks";
import { hubApi, type DiscoveredSession, type SessionRecord } from "../../shared/api.ts";
import { groupDiscovery } from "./groups.ts";

/** "vor 5 min" — how old the observation is (EPIC-P5 §3: explicit age). */
export function observedAgo(observedAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(observedAt).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return "Zeit unbekannt";
  if (seconds < 60) return "gerade eben";
  if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `vor ${Math.floor(seconds / 3600)} h`;
  return `vor ${Math.floor(seconds / 86_400)} d`;
}

/**
 * T5.3 / AC-P5-1: every session the hub knows or found read-only in
 * provider files, deduplicated by host + provider + native id on the hub.
 * Hub sessions open as usual; external ones are observe-only. Grouped by
 * project, collapsible — the newest project is expanded, the rest folded.
 */
export function DiscoveryPane({ onOpen }: { onOpen: (session: SessionRecord) => void }) {
  const [items, setItems] = useState<DiscoveredSession[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (from: number) => {
    setBusy(true);
    try {
      const page = await hubApi.discovery(from);
      setItems((prev) => (from === 0 ? page.items : [...(prev ?? []), ...page.items]));
      setCursor(page.nextCursor);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load(0);
  }, []);

  const groups = groupDiscovery(items ?? []);

  const open = async (id: string) => {
    try {
      onOpen(await hubApi.session(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session nicht gefunden");
    }
  };

  /** Adoption (ADR-0011): hub-managed continuation of an observed session.
   * A subagent transcript is not continuable itself — its parent run is
   * (the subagent's work is part of that conversation). */
  const adopt = async (item: DiscoveredSession) => {
    const native = item.parentSessionId ?? item.nativeSessionId;
    if (!native) return;
    setBusy(true);
    try {
      const record = await hubApi.createSession({
        adapter: item.adapter,
        project: item.project,
        adoptNativeSessionId: native,
      });
      onOpen(record);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Übernehmen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  /** Read-only mirror (ADR-0011 Erweiterung): show an observed opencode
   * session's chat exactly as it happened — nothing is started or taken
   * over; it keeps updating while open. */
  const mirror = async (item: DiscoveredSession) => {
    if (!item.nativeSessionId) return;
    setBusy(true);
    try {
      const record = await hubApi.createSession({
        adapter: item.adapter,
        project: item.project,
        mirrorNativeSessionId: item.nativeSessionId,
      });
      onOpen(record);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spiegeln fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  if (items === null) return <div class="empty">{error || "lade…"}</div>;
  const unsupported = items.filter((i) => i.status === "unsupported-format").length;

  return (
    <div class="discovery">
      <div class="dashboard-summary dim">
        <span>{items.length} gefunden</span>
        {unsupported > 0 && <span class="badge risk-destructive">{unsupported} unbekanntes Format</span>}
      </div>
      {error && <div class="reply-error">{error}</div>}
      {items.length === 0 && <div class="empty">keine Sessions gefunden</div>}
      {groups.map((group, i) => (
        <details key={group.project} class="project-tile" open={i === 0}>
          <summary class="project-tile-header">
            <span class="project-tile-name">{group.project}</span>
            <span class="dim">
              {group.sessions.length} Session{group.sessions.length === 1 ? "" : "en"} · zuletzt {observedAgo(group.newestAt)}
            </span>
          </summary>
          {group.sessions.map((s) => (
            <DiscoveredRow key={`${s.hostId}|${s.adapter}|${s.nativeSessionId ?? s.hubSessionId}`} item={s} onOpen={open} onAdopt={adopt} onMirror={s.adapter === "opencode" ? mirror : undefined} />
          ))}
        </details>
      ))}
      {cursor !== null && (
        <button class={busy ? "btn busy" : "btn"} type="button" disabled={busy} onClick={() => void load(cursor)}>
          {busy ? "lädt…" : "Mehr laden"}
        </button>
      )}
    </div>
  );
}

function DiscoveredRow({ item, onOpen, onAdopt, onMirror }: { item: DiscoveredSession; onOpen: (id: string) => void; onAdopt?: (item: DiscoveredSession) => void; onMirror?: (item: DiscoveredSession) => void }) {
  const unknown = item.status === "unsupported-format";
  const body = (
    <>
      <div class="row">
        <strong>{item.adapter}</strong>
        <span class={`pill ${unknown ? "error" : item.status}`}>{unknown ? "unbekanntes Format" : item.status}</span>
      </div>
      <div class="row dim">
        <span class="mono">{item.nativeSessionId ?? item.hubSessionId ?? "—"}</span>
        <span>{observedAgo(item.observedAt)}</span>
      </div>
      <div class="provider-card-chips">
        <span class="chip subtle">{item.hubSessionId ? "Hub" : "extern · nur beobachtet"}</span>
        <span class="chip subtle">{item.harness}</span>
        {item.parentSessionId && <span class="chip subtle">Subagent von {item.parentSessionId.slice(0, 8)}</span>}
        {item.fork && <span class="chip subtle">Fork</span>}
      </div>
    </>
  );
  return (
    <div class="card session-card discovered-row">
      {item.hubSessionId ? (
        <button class="session-open" type="button" onClick={() => onOpen(item.hubSessionId!)}>
          {body}
        </button>
      ) : (
        <div class="session-open">
          {body}
          {onAdopt && item.nativeSessionId && !unknown && (
            <button
              class="btn"
              type="button"
              onClick={() => onAdopt(item)}
              title="Session in den Hub übernehmen und fortsetzen"
            >
              Fortsetzen
            </button>
          )}
          {onMirror && item.nativeSessionId && !unknown && (
            <button
              class="btn"
              type="button"
              onClick={() => onMirror(item)}
              title="Verlauf lesbar im Hub spiegeln — ohne Übernahme, nur lesen"
            >
              Spiegeln
            </button>
          )}
        </div>
      )}
    </div>
  );
}
