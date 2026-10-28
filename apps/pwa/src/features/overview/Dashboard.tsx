import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { registerField } from "../../shared/command-context.ts";
import type { FleetHost, SessionRecord } from "../../shared/api.ts";
import { hostApi, remoteHost } from "../../shared/api.ts";
import { isLastSession, type LastSession } from "../shell/last-session.ts";
import { compareByActivity, IDLE_STILL_ACTIVE_MS, lastActivityAt, sessionsForOverview } from "./session-list.ts";
import { metricView, totalCostText } from "../../shared/metrics.ts";
import { ago, statusLabel } from "../../shared/status.ts";
import { initSeen, isUnseen, seenKey } from "../../shared/seen.ts";

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Known window ids get a German label; anything else (future adapters —
 * zai, swarm, local-llm) shows its raw id rather than guessing a label. */
const WINDOW_LABELS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "7d",
};

export function formatWindow(w: { id: string; utilization: number; resetsAt: string }): string {
  const label = WINDOW_LABELS[w.id] ?? w.id;
  const pct = Math.round(w.utilization * 100);
  const reset = new Date(w.resetsAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${label} ${pct}% · reset ${reset}`;
}

export interface DashboardProps {
  sessions: SessionRecord[];
  /** EPIC-P6: the fleet's hosts; more than one groups the overview by host. */
  hosts?: FleetHost[];
  onOpen: (session: SessionRecord, opts?: { newTile?: boolean }) => void;
  /** T2.6: pending approval-queue count (0 on a hub without approvals
   * configured — not distinguished from "genuinely zero pending" here,
   * since either way there's nothing for the banner to show). */
  pendingApprovals?: number;
  onOpenApprovals?: () => void;
  /** T5.3: all found sessions, including external provider sessions. */
  onOpenDiscovery?: () => void;
  /** EPIC-P23 T23.1: the session worked in last on this device — marked and brought into view. */
  lastSession?: LastSession | null;
}

/**
 * T1.5 Monitor-Dashboard.
 *
 * Grouped by PROJECT, not "Rechner" (machine): EPIC-P1 §2 describes
 * "Rechner-Kacheln → Projekte → Sessions", which assumes a PWA aggregating
 * several hubs on different machines. That doesn't exist — one PWA talks
 * to exactly one hub (one server process, hence one machine) via
 * relative /api/* paths (see api.ts); there's no multi-hub registry or
 * config anywhere in the codebase to group by. Project is the real,
 * present grouping key today. Revisit this component if/when multi-hub
 * aggregation becomes its own task — don't build that scaffolding on
 * spec now (architecture-best-practices: no seam without a second
 * caller).
 *
 * Traffic-light: reuses the existing `.pill.<status>` color coding
 * (ok/warn/err/dim, see app/styles/) rather than adding a second,
 * redundant status-color indicator next to it.
 */
const HOST_STATE_LABEL: Record<FleetHost["state"], string> = {
  reachable: "verbunden",
  stale: "veraltet",
  offline: "offline",
  incompatible: "inkompatibel",
  unauthorized: "Zugriff entzogen",
};

function projectName(project: string): string {
  return project.split("/").filter(Boolean).pop() ?? project;
}

type Section = "braucht" | "pins" | "aktiv" | "zuletzt";

/** T8.1: what needs you first, then what runs, then what happened. */
export function sectionOf(s: SessionRecord, now: number = Date.now()): Section {
  if (s.status === "waiting_approval" || s.status === "error") return "braucht";
  if (s.pinned) return "pins";
  if (s.status === "starting" || s.status === "working") return "aktiv";
  // EPIC-P15 T15.6: an idle session nobody has touched for half a day is history, not "active".
  if (s.status === "idle") return now - Date.parse(lastActivityAt(s)) <= IDLE_STILL_ACTIVE_MS ? "aktiv" : "zuletzt";
  return "zuletzt";
}

const SECTION_TITLE: Record<Section, string> = { braucht: "Braucht dich", pins: "Angeheftet", aktiv: "Aktiv", zuletzt: "Zuletzt" };
const RECENT_LIMIT = 15;

function matches(s: SessionRecord, q: string): boolean {
  if (!q) return true;
  const hay = `${s.title ?? ""} ${s.project} ${s.hostId ?? ""} ${s.adapter} ${s.model ?? ""} ${s.lastActivity?.text ?? ""}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

export function Dashboard({ sessions, hosts = [], onOpen, pendingApprovals = 0, onOpenApprovals, onOpenDiscovery, lastSession = null }: DashboardProps) {
  // Once per visit (not per 3 s poll): bring the remembered session into view.
  const hasSessions = sessions.length > 0;
  useEffect(() => {
    document.querySelector(".session-card[aria-current]")?.scrollIntoView?.({ block: "nearest" });
  }, [lastSession?.sessionId, hasSessions]);
  const fleet = hosts.length > 1;
  const [showArchived, setShowArchived] = useState(false);
  const [override, setOverride] = useState<Record<string, Partial<SessionRecord>>>({});
  const [actionError, setActionError] = useState("");
  // Sessions deleted from the archive view: gone locally right away, the
  // next poll confirms. A failed delete puts the row back (fail loud).
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [allRecent, setAllRecent] = useState(false);
  // T9.4: "Zeig wartende Sessions" narrows the overview; the chip undoes it.
  const [statusFilter, setStatusFilter] = useState(() => sessionStorage.getItem("uacc.overviewFilter") ?? "all");
  useEffect(() => {
    const on = (e: Event) => setStatusFilter(String((e as CustomEvent<string>).detail ?? "all"));
    window.addEventListener("uacc:overview-filter", on);
    return () => window.removeEventListener("uacc:overview-filter", on);
  }, []);
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => registerField("session_filter", { get: () => queryRef.current, set: setQuery }), []);
  // T8.6: first run on this device — what exists now counts as read.
  useEffect(() => {
    if (sessions.length > 0) initSeen(sessions.map((s) => ({ key: seenKey(s.hostId ?? "", s.id), lastSeq: s.lastSeq })));
  }, [sessions.length > 0]);

  // Local changes win until the next poll reports the same value.
  useEffect(() => {
    setOverride((prev) => {
      const next: Record<string, Partial<SessionRecord>> = {};
      for (const [id, patch] of Object.entries(prev)) {
        const server = sessions.find((s) => s.id === id);
        if (server && Object.entries(patch).some(([k, v]) => server[k as keyof SessionRecord] !== v)) next[id] = patch;
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [sessions]);
  const withOverride = useMemo(
    () => sessions.filter((s) => !deleted.has(s.id)).map((s) => (override[s.id] ? { ...s, ...override[s.id] } : s)),
    [sessions, override, deleted],
  );
  const visible = useMemo(
    () =>
      sessionsForOverview(withOverride, showArchived)
        .filter((s) => matches(s, query.trim()))
        .filter((s) => (statusFilter === "waiting" ? sectionOf(s) === "braucht" : statusFilter === "active" ? sectionOf(s) === "aktiv" || sectionOf(s) === "braucht" : true)),
    [withOverride, showArchived, query, statusFilter],
  );
  const sorted = useMemo(() => [...visible].sort(compareByActivity), [visible]);
  const sections = useMemo(() => {
    const out: Record<Section, SessionRecord[]> = { braucht: [], pins: [], aktiv: [], zuletzt: [] };
    for (const s of sorted) out[showArchived ? "zuletzt" : sectionOf(s)].push(s);
    return out;
  }, [sorted, showArchived]);

  // ADR-0023: a sum with unknown parts is no number — shown only when any
  // session of today reported a cost at all.
  const today = useMemo(() => sessions.filter((s) => s.createdAt.slice(0, 10) === todayKey()), [sessions]);
  const todayCost = today.some((s) => s.metrics && s.metrics.cost !== "unknown") ? totalCostText(today, formatUsd) : null;
  const archivedCount = withOverride.filter((s) => s.archived === true).length;

  const change = async (session: SessionRecord, patch: Partial<SessionRecord>, call: () => Promise<unknown>) => {
    setOverride((prev) => ({ ...prev, [session.id]: { ...prev[session.id], ...patch } }));
    try {
      await call();
      setActionError("");
    } catch (err) {
      setOverride((prev) => ({ ...prev, [session.id]: {} }));
      setActionError(err instanceof Error ? err.message : "Änderung fehlgeschlagen.");
    }
  };
  const archive = (s: SessionRecord) => change(s, { archived: !s.archived }, () => hostApi(s.hostId).setArchived(s.id, !s.archived));
  const pin = (s: SessionRecord) => change(s, { pinned: !s.pinned }, () => hostApi(s.hostId).setSessionMeta(s.id, { pinned: !s.pinned }));
  // Archiv aufräumen: endgültig löschen, gleiche Sicherheitsfrage wie in
  // der Session-Ansicht — Verlauf, Statistik und Worktree sind weg.
  const remove = (s: SessionRecord) => {
    if (!confirm("Session endgültig löschen? Verlauf, Statistik und Worktree sind weg.")) return;
    setDeleted((prev) => new Set(prev).add(s.id));
    hostApi(s.hostId)
      .deleteSession(s.id)
      .catch((err: unknown) => {
        setDeleted((prev) => {
          const next = new Set(prev);
          next.delete(s.id);
          return next;
        });
        setActionError(err instanceof Error ? err.message : "Löschen fehlgeschlagen.");
      });
  };

  const order: Section[] = ["braucht", "pins", "aktiv", "zuletzt"];
  return (
    <div class="dashboard">
      {pendingApprovals > 0 && onOpenApprovals && (
        <button class="approval-banner" onClick={onOpenApprovals}>
          ⚠ {pendingApprovals} {pendingApprovals === 1 ? "Freigabe wartet" : "Freigaben warten"} auf dich
        </button>
      )}
      {actionError && <div class="reply-error">{actionError}</div>}
      <div class="dashboard-summary dim">
        {todayCost && <span>Heute: {todayCost}</span>}
        <button class={`chip ${showArchived ? "active" : ""}`} type="button" onClick={() => setShowArchived((on) => !on)}>
          {showArchived ? "Aktive" : `Archiv${archivedCount > 0 ? ` (${archivedCount})` : ""}`}
        </button>
        {onOpenDiscovery && (
          <button class="chip" type="button" onClick={onOpenDiscovery}>
            Gefunden
          </button>
        )}
      </div>
      {statusFilter !== "all" && statusFilter !== "recent" && (
        <button
          type="button"
          class="chip active status-filter"
          onClick={() => {
            sessionStorage.removeItem("uacc.overviewFilter");
            setStatusFilter("all");
          }}
        >
          {statusFilter === "waiting" ? "nur wartende" : "nur aktive"} ✕
        </button>
      )}
      {sessions.length > 4 && (
        <input class="dashboard-search" type="search" placeholder="Sessions filtern…" aria-label="Sessions filtern" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
      )}
      {fleet && (
        <div class="fleet-hosts">
          {hosts.map((h) => (
            <span key={h.hostId} class={`chip subtle host-chip ${h.state}`} title={h.detail ?? undefined}>
              {h.label ?? h.hostId.slice(0, 8)} · {HOST_STATE_LABEL[h.state]}
              {h.state !== "reachable" && h.lastSyncAt
                ? ` · Stand ${new Date(h.lastSyncAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </span>
          ))}
        </div>
      )}
      {sorted.length === 0 ? (
        <div class="empty">{query ? "nichts gefunden" : showArchived ? "nichts archiviert" : "keine Sessions — lege eine an"}</div>
      ) : (
        order
          .filter((key) => sections[key].length > 0)
          .map((key) => {
            const list = key === "zuletzt" && !allRecent && !query ? sections[key].slice(0, RECENT_LIMIT) : sections[key];
            return (
              <section key={key} class={`session-section section-${key}`} aria-label={SECTION_TITLE[key]}>
                <h2 class="section-title">
                  {showArchived ? "Archiv" : SECTION_TITLE[key]} <span class="dim">{sections[key].length}</span>
                </h2>
                {list.map((s) => (
                  <SessionRow
                    key={`${s.hostId ?? ""}:${s.id}`}
                    session={s}
                    hosts={hosts ?? []}
                    onOpen={onOpen}
                    isLast={isLastSession(lastSession, s.id, remoteHost(s.hostId))}
                    onArchive={archive}
                    onPin={pin}
                    onDelete={remove}
                  />
                ))}
                {list.length < sections[key].length && (
                  <button class="btn more-sessions" type="button" onClick={() => setAllRecent(true)}>
                    Alle {sections[key].length} zeigen
                  </button>
                )}
              </section>
            );
          })
      )}
    </div>
  );
}

function SessionRow({
  session,
  hosts,
  onOpen,
  isLast,
  onArchive,
  onPin,
  onDelete,
}: {
  session: SessionRecord;
  hosts: FleetHost[];
  onOpen: (s: SessionRecord, opts?: { newTile?: boolean }) => void;
  isLast: boolean;
  onArchive: (s: SessionRecord) => void;
  onPin: (s: SessionRecord) => void;
  onDelete: (s: SessionRecord) => void;
}) {
  const waiting = session.status === "waiting_approval";
  const glow = session.status === "working" ? "st-working" : waiting ? "st-waiting" : "";
  const unseen = isUnseen(seenKey(session.hostId ?? "", session.id), session.lastSeq);
  const project = projectName(session.project);
  return (
    <div class={`card session-card ${glow}${unseen ? " unseen" : ""}${isLast ? " last-active" : ""}`} aria-current={isLast ? "true" : undefined}>
      <button class="session-open" type="button" onClick={(ev) => onOpen(session, { newTile: ev.ctrlKey || ev.metaKey })}>
        <div class="row">
          <strong class={`session-title${session.title ? "" : " dim"}`}>{session.title ?? `${project} — ohne Auftrag`}</strong>
          <span class={`pill ${session.status}`} data-status={session.status}>
            {statusLabel(session.status)}
          </span>
        </div>
        <div class="session-where dim">
          {/* 2026-10-26: host and model are always visible — readable host
           * label (fallback short id), model or the honest "Standardmodell"
           * (no guessed provider). */}
          {session.hostId ? `${hostLabel(hosts ?? [], session.hostId)} · ` : ""}
          <span class="session-project">{project}</span> · {session.adapter} · {session.model ?? "Standardmodell"}
          {session.costUsd > 0 ? ` · ${metricView(session, "cost", formatUsd, true).text}` : ""}
        </div>
        <div class="session-activity">
          <span class="session-activity-text">{session.lastActivity?.text ?? "noch nichts passiert"}</span>
          <span class="dim session-ago">
            {unseen && <span class="badge new-badge">neu</span>} {ago(session.lastActivity?.at ?? session.updatedAt)}
          </span>
        </div>
      </button>
      <div class="session-card-actions">
        <button class="link-btn" type="button" aria-pressed={session.pinned === true} onClick={() => void onPin(session)}>
          {session.pinned ? "Lösen" : "Anheften"}
        </button>
        <button class="link-btn" type="button" onClick={() => void onArchive(session)}>
          {session.archived ? "Zurückholen" : "Archivieren"}
        </button>
        {session.archived && (
          <button class="link-btn danger" type="button" onClick={() => onDelete(session)}>
            Löschen
          </button>
        )}
      </div>
    </div>
  );
}

/** 2026-10-26: readable host label — the fleet's own label (hostname /
 * tailnet name), falling back to a short id. Never empty, never guessed. */
function hostLabel(hosts: readonly FleetHost[], hostId: string): string {
  const host = hosts.find((h) => h.hostId === hostId);
  if (host?.label) return host.label;
  if (hostId === "local") return "dieser Rechner";
  return hostId.slice(0, 8);
}
