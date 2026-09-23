import { useMemo, useState } from "preact/hooks";
import type { SessionRecord } from "./api.ts";
import { hubApi } from "./api.ts";
import { sessionsForOverview } from "./session-list.ts";

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
  onOpen: (session: SessionRecord) => void;
  /** T2.6: pending approval-queue count (0 on a hub without approvals
   * configured — not distinguished from "genuinely zero pending" here,
   * since either way there's nothing for the banner to show). */
  pendingApprovals?: number;
  onOpenApprovals?: () => void;
  /** T5.3: all found sessions, including external provider sessions. */
  onOpenDiscovery?: () => void;
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
 * (ok/warn/err/dim, see styles.css) rather than adding a second,
 * redundant status-color indicator next to it.
 */
export function Dashboard({ sessions, onOpen, pendingApprovals = 0, onOpenApprovals, onOpenDiscovery }: DashboardProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [archivedOverride, setArchivedOverride] = useState<Record<string, boolean>>({});
  const [archiveError, setArchiveError] = useState("");
  const withArchive = useMemo(
    () => sessions.map((session) => (session.id in archivedOverride ? { ...session, archived: archivedOverride[session.id] } : session)),
    [sessions, archivedOverride],
  );
  const visible = useMemo(() => sessionsForOverview(withArchive, showArchived), [withArchive, showArchived]);
  const sorted = useMemo(
    () => [...visible].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
    [visible],
  );

  const byProject = useMemo(() => {
    const map = new Map<string, SessionRecord[]>();
    for (const s of sorted) {
      const list = map.get(s.project) ?? [];
      list.push(s);
      map.set(s.project, list);
    }
    // Projects ordered by their most-recently-active session (sorted already).
    return [...map.entries()];
  }, [sorted]);

  const todayTotalUsd = useMemo(() => {
    const today = todayKey();
    return sessions
      .filter((s) => s.createdAt.slice(0, 10) === today)
      .reduce((sum, s) => sum + s.costUsd, 0);
  }, [sessions]);

  const waitingCount = sessions.filter((s) => s.status === "waiting_approval").length;
  const archivedCount = withArchive.filter((s) => s.archived === true).length;

  const archive = async (session: SessionRecord) => {
    const next = session.archived !== true;
    try {
      await hubApi.setArchived(session.id, next);
      setArchivedOverride((prev) => ({ ...prev, [session.id]: next }));
      setArchiveError("");
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : "Archivieren fehlgeschlagen.");
    }
  };

  return (
    <div class="dashboard">
      {pendingApprovals > 0 && onOpenApprovals && (
        <button class="approval-banner" onClick={onOpenApprovals}>
          ⚠ {pendingApprovals} {pendingApprovals === 1 ? "Freigabe wartet" : "Freigaben warten"} auf dich
        </button>
      )}
      {archiveError && <div class="reply-error">{archiveError}</div>}
      <div class="dashboard-summary dim">
        <span>Heute: {formatUsd(todayTotalUsd)}</span>
        <button class={`chip ${showArchived ? "active" : ""}`} type="button" onClick={() => setShowArchived((on) => !on)}>
          {showArchived ? "Aktive" : `Archiv${archivedCount > 0 ? ` (${archivedCount})` : ""}`}
        </button>
        {onOpenDiscovery && (
          <button class="chip" type="button" onClick={onOpenDiscovery}>
            Gefunden
          </button>
        )}
        {waitingCount > 0 && (
          <span class="badge waiting">
            {waitingCount} {waitingCount === 1 ? "wartet" : "warten"} auf dich
          </span>
        )}
      </div>
      {sorted.length === 0 ? (
        <div class="empty">{showArchived ? "nichts archiviert" : "keine Sessions — lege eine an"}</div>
      ) : (
        byProject.map(([project, projectSessions]) => (
          <div key={project} class="project-tile">
            <div class="project-tile-header dim">{project.split("/").pop() ?? project}</div>
            {projectSessions.map((s) => (
              <SessionRow key={s.id} session={s} onOpen={onOpen} onArchive={archive} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}


function SessionRow({
  session,
  onOpen,
  onArchive,
}: {
  session: SessionRecord;
  onOpen: (s: SessionRecord) => void;
  onArchive: (s: SessionRecord) => void;
}) {
  const waiting = session.status === "waiting_approval";
  const glow = session.status === "working" ? "st-working" : waiting ? "st-waiting" : "";
  return (
    <div class={`card session-card ${glow}`}>
      <button class="session-open" type="button" onClick={() => onOpen(session)}>
        <div class="row">
          <strong class="session-project">{session.project.split("/").filter(Boolean).pop() ?? session.project}</strong>
          <span class={`pill ${session.status}`}>{session.status}</span>
        </div>
        <div class={`session-title${session.title ? "" : " dim"}`}>{session.title ?? "ohne Startprompt"}</div>
        <div class="row dim">
          <span>
            {session.adapter} · {session.model ?? "n/a"} · #{session.lastSeq}
          </span>
          <span>{session.costUsd > 0 ? formatUsd(session.costUsd) : ""}</span>
        </div>
        {waiting && <span class="badge waiting">wartet auf dich</span>}
      </button>
      <button class="link-btn" type="button" onClick={() => void onArchive(session)}>
        {session.archived ? "Zurückholen" : "Archivieren"}
      </button>
    </div>
  );
}
