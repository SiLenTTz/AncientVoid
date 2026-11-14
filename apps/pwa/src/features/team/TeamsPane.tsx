import { ApiContext, useApi } from "../../shared/api-context.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Team, TeamStatus, TeamTaskStatus } from "@ancientvoid/contracts";
import { hostApi, type AdapterInfo, type DiscoveredProject } from "../../shared/api.ts";
import { sessionHash } from "../../app/route.ts";

/** Status-Pill: done grün, failed/unknown rot, awaiting_gate gelb, sonst neutral. */
function statusTone(status: string): string {
  if (status === "done") return "team-pill--ok";
  if (status === "failed" || status === "unknown") return "team-pill--err";
  if (status === "awaiting_gate") return "team-pill--warn";
  return "";
}

const STATUS_LABEL: Record<string, string> = {
  planning: "plant",
  running: "läuft",
  awaiting_gate: "Rückfrage offen",
  done: "fertig",
  failed: "fehlgeschlagen",
  cancelled: "abgebrochen",
  pending: "wartet",
  ready: "bereit",
  active: "aktiv",
  stale: "veraltet",
};

function label(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function TeamDetail({ team, onAnswer, onCancel, busy }: { team: Team; onAnswer: (gateId: string, label: string) => void; onCancel: () => void; busy: boolean }) {
  const done = team.tasks.filter((t) => t.status === "done").length;
  const openGates = team.gates.filter((g) => !g.answeredAt);
  return (
    <div class="team-detail" data-testid="team-detail">
      <header class="team-detail-head">
        <h3>{team.title}</h3>
        <span class={`team-pill ${statusTone(team.status)}`}>{label(team.status)}</span>
      </header>
      <p class="team-goal">{team.goal}</p>
      <p class="team-meta">
        Projekt: <span class="team-chip">{team.project}</span> · Plan: {team.planSource === "coordinator" ? "Koordinator" : "übergeben"} · Adapter: {team.frame.adapters.join(", ")} · Parallelität: {team.frame.maxParallel}
        {team.coordinatorSessionId && (
          <> · <a href={sessionHash(team.coordinatorSessionId)}>Koordinator-Session</a></>
        )}
      </p>

      {openGates.length > 0 && (
        <div class="team-gates">
          {openGates.map((gate) => (
            <div class="team-gate" data-testid="team-gate" key={gate.id}>
              <p>{gate.question}</p>
              <div class="team-gate-actions">
                {gate.options.map((opt) => (
                  <button type="button" class="btn" disabled={busy} key={opt.label} onClick={() => onAnswer(gate.id, opt.label)}>
                    {opt.label}
                  </button>
                ))}
                <button type="button" class="btn team-cancel" disabled={busy} onClick={onCancel}>
                  Team stoppen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ol class="team-tasks">
        {team.tasks.map((task) => {
          const current = task.dispatches[task.dispatches.length - 1];
          return (
            <li class={`team-task ${statusTone(task.status)}`} key={task.id}>
              <div class="team-task-head">
                <span class="team-task-id">{task.id}</span>
                <span class="team-task-title">{task.title}</span>
                <span class={`team-pill ${statusTone(task.status)}`}>{label(task.status)}</span>
              </div>
              <div class="team-task-meta">
                {task.adapter}
                {task.dependsOn.length > 0 && <> · hängt ab von {task.dependsOn.join(" → ")}</>}
                {current && (
                  <>
                    {" "}&middot; Dispatch g{current.generation} {current.adapter} ({label(current.status)}){" "}
                    <a href={sessionHash(current.sessionId)} title={current.sessionId}>Session ↗</a>
                  </>
                )}
              </div>
              {task.result && (
                <div class="team-result">
                  <pre>{task.result.text.slice(0, 400)}{task.result.text.length > 400 ? "…" : ""}</pre>
                  {task.result.blobRef && <p class="team-blob">Ergebnis als Blob abgelegt: {task.result.blobRef} ({task.result.bytes} Bytes)</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p class="team-meta">{done}/{team.tasks.length} Tasks erledigt · {team.deliveries.length} Lieferungen</p>
    </div>
  );
}

function NewTeamForm({ adapters, projects, onCreated }: { adapters: AdapterInfo[]; projects: DiscoveredProject[]; onCreated: (team: Team) => void }) {
  const api = useApi();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [project, setProject] = useState(projects[0]?.name ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [coordinatorAdapter, setCoordinatorAdapter] = useState("hermes");
  const [maxParallel, setMaxParallel] = useState(2);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const start = async () => {
    setError("");
    if (!title.trim() || !goal.trim() || selected.length === 0) {
      setError("Titel, Ziel und mindestens ein Adapter sind nötig.");
      return;
    }
    setBusy(true);
    try {
      const team = await api.teamStart({
        title: title.trim(),
        goal: goal.trim(),
        project,
        frame: {
          adapters: selected,
          coordinatorAdapter: coordinatorAdapter.trim() || null,
          model: null,
          maxTasks: 8,
          maxDispatchesPerTask: 2,
          maxParallel,
        },
        plan: null,
      });
      onCreated(team);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="team-new" data-testid="team-new" onSubmit={(e) => { e.preventDefault(); void start(); }}>
      <h3>Neues Team</h3>
      <label>Titel <input value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
      <label>Ziel <textarea rows={3} value={goal} onInput={(e) => setGoal((e.target as HTMLTextAreaElement).value)} /></label>
      <label>Projekt
        <select value={project} onChange={(e) => setProject((e.target as HTMLSelectElement).value)}>
          {projects.map((p) => <option value={p.name} key={p.path}>{p.name}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>Adapter</legend>
        {adapters.map((a) => (
          <label class="team-adapter">
            <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} /> {a.id}
          </label>
        ))}
      </fieldset>
      <div class="team-new-row">
        <label>Koordinator <input value={coordinatorAdapter} onInput={(e) => setCoordinatorAdapter((e.target as HTMLInputElement).value)} /></label>
        <label>Parallelität <input type="number" min={1} max={4} value={maxParallel} onInput={(e) => setMaxParallel(Number((e.target as HTMLInputElement).value))} /></label>
      </div>
      {error && <div class="files-error" role="alert">{error}</div>}
      <button type="submit" class="btn" disabled={busy}>Team starten</button>
    </form>
  );
}

/** EPIC-P40/EPIC-P60: Agenten-Teams mit Rahmen, Tasks, Dispatches und Gates (ADR-0064, Run→Team ADR-0077). */
export function TeamsPane() {
  const host = new URLSearchParams(location.hash.split("?")[1] ?? "").get("host");
  const api = useMemo(() => hostApi(host), [host]);
  return <ApiContext.Provider value={api}><TeamsHostPane key={host ?? "self"} /></ApiContext.Provider>;
}

function TeamsHostPane() {
  const api = useApi();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("team"));
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const list = await api.teamList();
        if (!alive) return;
        setTeams(list);
        setError("");
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Abruf fehlgeschlagen");
      }
    };
    void tick();
    const timer = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void api.adapters().then((a) => alive && setAdapters(a)).catch(() => {});
    void api.projects().then((p) => alive && setProjects(p.projects)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const selected = teams?.find((r) => r.id === selectedId) ?? null;

  const refresh = async () => {
    try {
      setTeams(await api.teamList());
    } catch {
      // Der nächste Poll-Tick übernimmt es.
    }
  };

  const answer = async (gateId: string, answerLabel: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      const team = await api.teamAnswer(selected.id, gateId, answerLabel);
      setTeams((prev) => (prev ? prev.map((r) => (r.id === team.id ? team : r)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Antwort fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!selected) return;
    if (!confirm("Dieses Team wirklich stoppen?")) return;
    setBusy(true);
    try {
      const team = await api.teamCancel(selected.id, "Vom Nutzer gestoppt");
      setTeams((prev) => (prev ? prev.map((r) => (r.id === team.id ? team : r)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Abbruch fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="teams-pane" data-testid="teams-pane">
      <div class="teams-list">
        <div class="teams-list-head">
          <h3>Teams</h3>
          <button type="button" class="btn" onClick={() => setShowNew((v) => !v)}>{showNew ? "Abbrechen" : "Neues Team"}</button>
        </div>
        {error && <div class="files-error" role="alert">{error}</div>}
        {showNew && (
          <NewTeamForm
            adapters={adapters}
            projects={projects}
            onCreated={(team) => {
              setShowNew(false);
              setSelectedId(team.id);
              void refresh();
            }}
          />
        )}
        {teams === null ? (
          <div class="empty">lade…</div>
        ) : teams.length === 0 ? (
          <div class="empty">Noch keine Teams.</div>
        ) : (
          <ul>
            {teams.map((team) => {
              const done = team.tasks.filter((t) => t.status === "done").length;
              return (
                <li key={team.id}>
                  <button type="button" class={`team-row ${team.id === selectedId ? "active" : ""}`} onClick={() => setSelectedId(team.id)}>
                    <span class="team-row-title">{team.title}</span>
                    <span class={`team-pill ${statusTone(team.status)}`}>{label(team.status)}</span>
                    <span class="team-row-meta">{team.project || "—"} · {done}/{team.tasks.length} erledigt</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected && <TeamDetail team={selected} onAnswer={answer} onCancel={cancel} busy={busy} />}
    </div>
  );
}
