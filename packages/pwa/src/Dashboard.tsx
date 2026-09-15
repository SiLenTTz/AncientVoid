import { useMemo } from "preact/hooks";
import type { AdapterUsage, SessionRecord } from "./api.ts";

function formatUsd(n: number): string {
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

function formatWindow(w: { id: string; utilization: number; resetsAt: string }): string {
  const label = WINDOW_LABELS[w.id] ?? w.id;
  const pct = Math.round(w.utilization * 100);
  const reset = new Date(w.resetsAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${label} ${pct}% · reset ${reset}`;
}

export interface DashboardProps {
  sessions: SessionRecord[];
  /** ADR-0004: adapter id -> its latest account-level usage snapshot. */
  usage: Record<string, AdapterUsage>;
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
export function Dashboard({ sessions, usage, onOpen }: DashboardProps) {
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
      <UsageRow usage={usage} />
      {sessions.length === 0 ? (
        <div class="empty">keine Sessions — lege eine an</div>
      ) : (
        byProject.map(([project, projectSessions]) => (
          <div key={project} class="project-tile">
            <div class="project-tile-header dim">{project.split("/").pop() ?? project}</div>
            {projectSessions.map((s) => (
              <SessionRow key={s.id} session={s} onOpen={onOpen} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/**
 * T1.5-3/ADR-0004: account-level Kontingent, not session-scoped — shown
 * once per known adapter, always visible regardless of whether any
 * session currently exists. `null` (no observation yet) reads as "noch
 * keine Meldung", never as 0%; `supported:false` reads as an explicit,
 * sourced "unbekannt" (R9.7), never a guess or an omitted row.
 */
function UsageRow({ usage }: { usage: Record<string, AdapterUsage> }) {
  const entries = Object.values(usage);
  if (entries.length === 0) return null;
  return (
    <div class="dashboard-summary dim" style="flex-wrap: wrap">
      {entries.map((u) => (
        <span key={u.adapterId}>
          {u.adapterId}:{" "}
          {!u.supported
            ? "unbekannt (Adapter meldet kein Kontingent)"
            : u.quota === null
              ? "noch keine Meldung"
              : [
                  u.quota.windows.map(formatWindow).join(" · "),
                  u.quota.overageAvailable === false
                    ? ` · ${u.quota.overageBlockedReason ?? "kein Guthaben"}`
                    : "",
                ].join("")}
        </span>
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
