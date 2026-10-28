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
  const [query, setQuery] = useState("");

  const load = async (from: number, q = query) => {
    setBusy(true);
    try {
      const page = await hubApi.discovery(from, 50, q.trim() ? { q: q.trim() } : {});
      setItems((prev) => (from === 0 ? page.items : [...(prev ?? []), ...page.items]));
      setCursor(page.nextCursor);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  // ADR-0040: the hub searches before it pages — a hit on page 9 is found, too.
  useEffect(() => {
    const handle = setTimeout(() => void load(0, query), items === null ? 0 : 300);
    return () => clearTimeout(handle);
  }, [query]);

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
  const adopt = async (item: DiscoveredSession, asCopy: boolean) => {
    const native = item.parentSessionId ?? item.nativeSessionId;
    if (!native) return;
    setBusy(true);
    try {
      const record = await hubApi.createSession({
        adapter: item.adapter,
        project: item.project,
        adoptNativeSessionId: native,
        ...(asCopy ? { adoptFork: true } : {}),
        ...(item.title ? { title: item.title } : {}),
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
  const searching = query.trim() !== "";
  const unsupported = items.filter((i) => i.status === "unsupported-format").length;

  return (
    <div class="discovery">
      <input
        class="discovery-search"
        type="search"
        placeholder="Sessions durchsuchen: Titel, letzte Nachricht, Projekt …"
        aria-label="Sessions durchsuchen"
        value={query}
        onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
      />
      <div class="dashboard-summary dim">
        <span>{items.length} gefunden</span>
        {unsupported > 0 && <span class="badge risk-destructive">{unsupported} unbekanntes Format</span>}
      </div>
      {error && <div class="reply-error">{error}</div>}
      {items.length === 0 && <div class="empty">{searching ? "keine Session passt zur Suche" : "keine Sessions gefunden"}</div>}
      {groups.map((group, i) => (
        <details key={`${group.project}|${searching}`} class="project-tile" open={i === 0 || searching}>
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

/** First line of the card: what the session is about. A bare id is the last
 * resort — and says so, instead of looking like a name. */
export function discoveryHeading(item: Pick<DiscoveredSession, "title" | "nativeSessionId" | "hubSessionId">): { text: string; untitled: boolean } {
  if (item.title) return { text: item.title, untitled: false };
  const id = item.nativeSessionId ?? item.hubSessionId ?? "";
  return { text: id ? `Ohne Titel · ${id.slice(0, 8)}` : "Ohne Titel", untitled: true };
}

function DiscoveredRow({ item, onOpen, onAdopt, onMirror }: { item: DiscoveredSession; onOpen: (id: string) => void; onAdopt?: (item: DiscoveredSession, asCopy: boolean) => void; onMirror?: (item: DiscoveredSession) => void }) {
  const unknown = item.status === "unsupported-format";
  const heading = discoveryHeading(item);
  const body = (
    <>
      <div class="row">
        <strong class={heading.untitled ? "discovery-title dim" : "discovery-title"}>{heading.text}</strong>
        <span class={`pill ${unknown ? "error" : item.status}`}>{unknown ? "unbekanntes Format" : item.status}</span>
      </div>
      {item.preview && item.preview !== item.title && <div class="discovery-preview dim">{item.preview}</div>}
      <div class="row dim">
        <span>{item.adapter}</span>
        <span>{observedAgo(item.observedAt)}</span>
      </div>
      <div class="provider-card-chips">
        <span class="chip subtle">{item.hubSessionId ? "Hub" : "extern · nur beobachtet"}</span>
        <span class="chip subtle">{item.harness}</span>
        {item.live && !item.hubSessionId && <span class="chip live" title="Wurde eben erst geschrieben — vermutlich noch in einem Terminal offen">läuft gerade woanders</span>}
        {item.parentSessionId && <span class="chip subtle">Subagent von {item.parentSessionId.slice(0, 8)}</span>}
        {item.fork && <span class="chip subtle">Fork</span>}
        <span class="chip subtle mono discovery-id">{item.nativeSessionId ?? item.hubSessionId ?? "—"}</span>
      </div>
    </>
  );
  const canContinue = Boolean(onAdopt && item.nativeSessionId && !unknown);
  return (
    <div class="card session-card discovered-row">
      {item.hubSessionId ? (
        <button class="session-open" type="button" onClick={() => onOpen(item.hubSessionId!)}>
          {body}
        </button>
      ) : (
        <div class="session-open">
          {body}
          {canContinue && (
            <div class="row discovery-actions">
              {/* A transcript another process is writing right now is never shared: the copy has its own id. */}
              <button
                class="btn"
                type="button"
                onClick={() => onAdopt!(item, Boolean(item.live))}
                title={item.live ? "Läuft gerade woanders — der Hub setzt eine Kopie mit eigener ID fort, das Original bleibt unberührt" : "Session in den Hub übernehmen und fortsetzen"}
              >
                {item.live ? "Als Kopie fortsetzen" : "Fortsetzen"}
              </button>
              {!item.live && (
                <button class="btn subtle" type="button" onClick={() => onAdopt!(item, true)} title="Eigene Kopie fortsetzen — das Original bleibt unverändert">
                  Als Kopie
                </button>
              )}
            </div>
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
