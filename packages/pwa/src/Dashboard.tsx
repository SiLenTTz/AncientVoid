import { useMemo } from "preact/hooks";
import type { SessionRecord } from "./api.ts";

function formatUsd(n: number): string {
  if (n === 0) return "$0";
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface DashboardProps {
  sessions: SessionRecord[];
  onOpen: (session: SessionRecord) => void;
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
export function Dashboard({ sessions, onOpen }: DashboardProps) {
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
    [sessions],
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

  if (sessions.length === 0) {
    return <div class="empty">keine Sessions — lege eine an</div>;
  }

  return (
    <div class="dashboard">
      <div class="dashboard-summary dim">
        <span>Heute: {formatUsd(todayTotalUsd)}</span>
        {waitingCount > 0 && (
          <span class="badge waiting">
            {waitingCount} {waitingCount === 1 ? "wartet" : "warten"} auf dich
          </span>
        )}
      </div>
      {byProject.map(([project, projectSessions]) => (
        <div key={project} class="project-tile">
          <div class="project-tile-header dim">{project.split("/").pop() ?? project}</div>
          {projectSessions.map((s) => (
            <SessionRow key={s.id} session={s} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  );
}

function SessionRow({ session, onOpen }: { session: SessionRecord; onOpen: (s: SessionRecord) => void }) {
  const waiting = session.status === "waiting_approval";
  return (
    <button class="card session-card btn" onClick={() => onOpen(session)}>
      <div class="row">
        <strong>{session.adapter}</strong>
        <span class={`pill ${session.status}`}>{session.status}</span>
      </div>
      <div class="row dim">
        <span>
          {session.model ?? "n/a"} · #{session.lastSeq}
        </span>
        <span>{session.costUsd > 0 ? formatUsd(session.costUsd) : ""}</span>
      </div>
      {waiting && <span class="badge waiting">wartet auf dich</span>}
    </button>
  );
}
