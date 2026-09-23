import { useEffect, useMemo, useState } from "preact/hooks";
import { hubApi, type DiscoveredSession, type SessionRecord } from "./api.ts";

/** "vor 5 min" — how old the observation is (EPIC-P5 §3: explicit age). */
export function observedAgo(observedAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(observedAt).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return "Zeit unbekannt";
  if (seconds < 60) return "gerade eben";
  if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `vor ${Math.floor(seconds / 3600)} h`;
  return `vor ${Math.floor(seconds / 86_400)} d`;
}

function projectName(project: string): string {
  return project.split("/").filter(Boolean).pop() ?? project;
}

/**
 * T5.3 / AC-P5-1: every session the hub knows or found read-only in
 * provider files, deduplicated by host + provider + native id on the hub.
 * Hub sessions open as usual; external ones are observe-only.
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

  const byProject = useMemo(() => {
    const map = new Map<string, DiscoveredSession[]>();
    for (const item of items ?? []) {
      const key = projectName(item.project);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  const open = async (id: string) => {
    try {
      onOpen(await hubApi.session(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session nicht gefunden");
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
      {byProject.map(([project, sessions]) => (
        <div key={project} class="project-tile">
          <div class="project-tile-header dim">{project}</div>
          {sessions.map((s) => (
            <DiscoveredRow key={`${s.hostId}|${s.adapter}|${s.nativeSessionId ?? s.hubSessionId}`} item={s} onOpen={open} />
          ))}
        </div>
      ))}
      {cursor !== null && (
        <button class={busy ? "btn busy" : "btn"} type="button" disabled={busy} onClick={() => void load(cursor)}>
          {busy ? "lädt…" : "Mehr laden"}
        </button>
      )}
    </div>
  );
}

function DiscoveredRow({ item, onOpen }: { item: DiscoveredSession; onOpen: (id: string) => void }) {
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
        <div class="session-open">{body}</div>
      )}
    </div>
  );
}
