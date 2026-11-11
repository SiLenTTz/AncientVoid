import { ApiContext, useApi } from "../../shared/api-context.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { OrchestrationRun, OrchestrationRunStatus, OrchestrationTaskStatus } from "@ancientvoid/contracts";
import { hostApi, type AdapterInfo, type DiscoveredProject } from "../../shared/api.ts";
import { sessionHash } from "../../app/route.ts";

/** Status-Pill: done grün, failed/unknown rot, awaiting_gate gelb, sonst neutral. */
function statusTone(status: string): string {
  if (status === "done") return "run-pill--ok";
  if (status === "failed" || status === "unknown") return "run-pill--err";
  if (status === "awaiting_gate") return "run-pill--warn";
  return "";
}

const STATUS_LABEL: Record<string, string> = {
  planning: "plant",
  running: "läuft",
  awaiting_gate: "wartet auf Antwort",
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

function RunDetail({ run, onAnswer, onCancel, busy }: { run: OrchestrationRun; onAnswer: (gateId: string, label: string) => void; onCancel: () => void; busy: boolean }) {
  const done = run.tasks.filter((t) => t.status === "done").length;
  const openGates = run.gates.filter((g) => !g.answeredAt);
  return (
    <div class="run-detail" data-testid="run-detail">
      <header class="run-detail-head">
        <h3>{run.title}</h3>
        <span class={`run-pill ${statusTone(run.status)}`}>{label(run.status)}</span>
      </header>
      <p class="run-goal">{run.goal}</p>
      <p class="run-meta">
        Projekt: <span class="run-chip">{run.project}</span> · Plan: {run.planSource === "coordinator" ? "Koordinator" : "übergeben"} · Adapter: {run.frame.adapters.join(", ")} · Parallelität: {run.frame.maxParallel}
        {run.coordinatorSessionId && (
          <> · <a href={sessionHash(run.coordinatorSessionId)}>Koordinator-Session</a></>
        )}
      </p>

      {openGates.length > 0 && (
        <div class="run-gates">
          {openGates.map((gate) => (
            <div class="run-gate" data-testid="run-gate" key={gate.id}>
              <p>{gate.question}</p>
              <div class="run-gate-actions">
                {gate.options.map((opt) => (
                  <button type="button" class="btn" disabled={busy} key={opt.label} onClick={() => onAnswer(gate.id, opt.label)}>
                    {opt.label}
                  </button>
                ))}
                <button type="button" class="btn run-cancel" disabled={busy} onClick={onCancel}>
                  Run stoppen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ol class="run-tasks">
        {run.tasks.map((task) => {
          const current = task.dispatches[task.dispatches.length - 1];
          return (
            <li class={`run-task ${statusTone(task.status)}`} key={task.id}>
              <div class="run-task-head">
                <span class="run-task-id">{task.id}</span>
                <span class="run-task-title">{task.title}</span>
                <span class={`run-pill ${statusTone(task.status)}`}>{label(task.status)}</span>
              </div>
              <div class="run-task-meta">
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
                <div class="run-result">
                  <pre>{task.result.text.slice(0, 400)}{task.result.text.length > 400 ? "…" : ""}</pre>
                  {task.result.blobRef && <p class="run-blob">Ergebnis als Blob abgelegt: {task.result.blobRef} ({task.result.bytes} Bytes)</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p class="run-meta">{done}/{run.tasks.length} Tasks erledigt · {run.deliveries.length} Lieferungen</p>
    </div>
  );
}

function NewRunForm({ adapters, projects, onCreated }: { adapters: AdapterInfo[]; projects: DiscoveredProject[]; onCreated: (run: OrchestrationRun) => void }) {
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
      const run = await api.orchestrationStart({
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
      onCreated(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="run-new" data-testid="run-new" onSubmit={(e) => { e.preventDefault(); void start(); }}>
      <h3>Neuer Run</h3>
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
          <label class="run-adapter">
            <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} /> {a.id}
          </label>
        ))}
      </fieldset>
      <div class="run-new-row">
        <label>Koordinator <input value={coordinatorAdapter} onInput={(e) => setCoordinatorAdapter((e.target as HTMLInputElement).value)} /></label>
        <label>Parallelität <input type="number" min={1} max={4} value={maxParallel} onInput={(e) => setMaxParallel(Number((e.target as HTMLInputElement).value))} /></label>
      </div>
      {error && <div class="files-error" role="alert">{error}</div>}
      <button type="submit" class="btn" disabled={busy}>Run starten</button>
    </form>
  );
}

/** EPIC-P40: Orchestrierung — Runs mit Rahmen, Tasks, Dispatches und Gates (ADR-0064). */
export function RunsPane() {
  const host = new URLSearchParams(location.hash.split("?")[1] ?? "").get("host");
  const api = useMemo(() => hostApi(host), [host]);
  return <ApiContext.Provider value={api}><RunsHostPane key={host ?? "self"} /></ApiContext.Provider>;
}

function RunsHostPane() {
  const api = useApi();
  const [runs, setRuns] = useState<OrchestrationRun[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("run"));
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const list = await api.orchestrationRuns();
        if (!alive) return;
        setRuns(list);
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

  const selected = runs?.find((r) => r.id === selectedId) ?? null;

  const refresh = async () => {
    try {
      setRuns(await api.orchestrationRuns());
    } catch {
      // Der nächste Poll-Tick übernimmt es.
    }
  };

  const answer = async (gateId: string, answerLabel: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      const run = await api.orchestrationAnswer(selected.id, gateId, answerLabel);
      setRuns((prev) => (prev ? prev.map((r) => (r.id === run.id ? run : r)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Antwort fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!selected) return;
    if (!confirm("Diesen Run wirklich stoppen?")) return;
    setBusy(true);
    try {
      const run = await api.orchestrationCancel(selected.id, "Vom Nutzer gestoppt");
      setRuns((prev) => (prev ? prev.map((r) => (r.id === run.id ? run : r)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Abbruch fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="runs-pane" data-testid="runs-pane">
      <div class="runs-list">
        <div class="runs-list-head">
          <h3>Runs</h3>
          <button type="button" class="btn" onClick={() => setShowNew((v) => !v)}>{showNew ? "Abbrechen" : "Neuer Run"}</button>
        </div>
        {error && <div class="files-error" role="alert">{error}</div>}
        {showNew && (
          <NewRunForm
            adapters={adapters}
            projects={projects}
            onCreated={(run) => {
              setShowNew(false);
              setSelectedId(run.id);
              void refresh();
            }}
          />
        )}
        {runs === null ? (
          <div class="empty">lade…</div>
        ) : runs.length === 0 ? (
          <div class="empty">Noch keine Runs.</div>
        ) : (
          <ul>
            {runs.map((run) => {
              const done = run.tasks.filter((t) => t.status === "done").length;
              return (
                <li key={run.id}>
                  <button type="button" class={`run-row ${run.id === selectedId ? "active" : ""}`} onClick={() => setSelectedId(run.id)}>
                    <span class="run-row-title">{run.title}</span>
                    <span class={`run-pill ${statusTone(run.status)}`}>{label(run.status)}</span>
                    <span class="run-row-meta">{run.project || "—"} · {done}/{run.tasks.length} erledigt</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected && <RunDetail run={selected} onAnswer={answer} onCancel={cancel} busy={busy} />}
    </div>
  );
}
