import { useEffect, useState } from "preact/hooks";
import { hubApi, type AdapterInfo, type AdapterUsage, type DiscoveredProject, type SessionRecord } from "./api.ts";
import { Dashboard } from "./Dashboard.tsx";

export function App({
  onOpen,
  ready,
}: {
  onOpen: (session: SessionRecord) => void;
  ready: () => void;
}) {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [usage, setUsage] = useState<Record<string, AdapterUsage>>({});
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [s, a] = await Promise.all([hubApi.sessions(), hubApi.adapters()]);
        if (!alive) return;
        setSessions(s);
        setAdapters(a);
        setError("");
        // T1.5-3/ADR-0004: one usage snapshot per known adapter, not per
        // session — fetched alongside the existing poll, not a second
        // independent timer.
        const usageEntries = await Promise.all(
          a.map(async (adapter) => [adapter.id, await hubApi.adapterUsage(adapter.id)] as const),
        );
        if (!alive) return;
        setUsage(Object.fromEntries(usageEntries));
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "load failed");
      }
    };
    void tick();
    const timer = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div>
      <div class="topbar">
        <h1>UACC</h1>
        <div style="display: flex; gap: 8px">
          <button class="btn" onClick={ready} title="Token wechseln">
            ⚙
          </button>
          <button class="btn primary" onClick={() => setShowCreate((v) => !v)}>
            + Session
          </button>
        </div>
      </div>

      {error && <div class="card" style="color: var(--err)">{error}</div>}

      {showCreate && <CreateSession adapters={adapters} onCreated={(s) => {
        setShowCreate(false);
        onOpen(s);
      }} />}

      {sessions === null ? (
        <div class="empty">lade…</div>
      ) : (
        <Dashboard sessions={sessions} usage={usage} onOpen={onOpen} />
      )}

      <div class="bottom-actions" />
    </div>
  );
}

function CreateSession({
  adapters,
  onCreated,
}: {
  adapters: AdapterInfo[];
  onCreated: (s: SessionRecord) => void;
}) {
  const [adapter, setAdapter] = useState(adapters[0]?.id ?? "dummy");
  const [project, setProject] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<DiscoveredProject[] | null>(null);

  useEffect(() => {
    let alive = true;
    hubApi
      .projects()
      .then((res) => {
        if (!alive) return;
        setProjects(res.projects);
        // Preselect the first discovered project so "Starten" works
        // without any typing when a picker is shown.
        if (res.projects.length > 0) setProject((p) => p || res.projects[0]!.path);
      })
      .catch(() => {
        // T1.5-5: an unreachable /api/projects must not make the form
        // unusable — fall back to the free-text path exactly as if no
        // projectRoots were configured (BUG-0006 lesson: onboarding paths
        // must never become a dead end).
        if (alive) setProjects([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      // T1.5-3: no budgetUsd input — the user works exclusively with
      // coding subscriptions, where a $ figure per session doesn't answer
      // anything real (see the Kontingent display instead). The contract
      // field itself is untouched (createSession still accepts it) for P2
      // to build on for API-key-billed adapters.
      const rec = await hubApi.createSession({
        adapter,
        project,
        ...(prompt ? { prompt } : {}),
      });
      onCreated(rec);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="card form-grid">
      <label>
        Adapter
        <select value={adapter} onChange={(e) => setAdapter((e.target as HTMLSelectElement).value)}>
          {adapters.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} ({a.capabilities.steer ? "steer" : "mono"})
            </option>
          ))}
        </select>
      </label>
      <label>
        Projekt
        {projects === null ? (
          <input disabled placeholder="lade…" />
        ) : projects.length > 0 ? (
          <select value={project} onChange={(e) => setProject((e.target as HTMLSelectElement).value)}>
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
                {p.branch ? ` (${p.branch})` : ""}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              value={project}
              onInput={(e) => setProject((e.target as HTMLInputElement).value)}
              placeholder="/home/user/repo"
            />
            <span class="dim" style="font-size: 11px">
              keine Projekt-Wurzeln konfiguriert — siehe docs/configuration.md
            </span>
          </>
        )}
      </label>
      <label>
        Prompt (optional)
        <input
          value={prompt}
          onInput={(e) => setPrompt((e.target as HTMLInputElement).value)}
          placeholder="Refactore den Auth-Flow…"
        />
      </label>
      {error && <div style="color: var(--err)">{error}</div>}
      <button class="btn primary" onClick={submit} disabled={busy || !project}>
        {busy ? "Starte…" : "Starten"}
      </button>
    </div>
  );
}
