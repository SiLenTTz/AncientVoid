import { useEffect, useState } from "preact/hooks";
import { hubApi, type AdapterInfo, type SessionRecord } from "./api.ts";

export function App({
  onOpen,
  ready,
}: {
  onOpen: (session: SessionRecord) => void;
  ready: () => void;
}) {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
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
      ) : sessions.length === 0 ? (
        <div class="empty">keine Sessions — lege eine an</div>
      ) : (
        sessions.map((s) => <SessionCard key={s.id} session={s} onOpen={onOpen} />)
      )}

      <div class="bottom-actions" />
    </div>
  );
}

function statusClass(status: string): string {
  return `pill ${status}`;
}

function SessionCard({ session, onOpen }: { session: SessionRecord; onOpen: (s: SessionRecord) => void }) {
  const shortProject = session.project.split("/").pop() ?? session.project;
  return (
    <button class="card session-card btn" onClick={() => onOpen(session)}>
      <div class="row">
        <strong>{shortProject}</strong>
        <span class={statusClass(session.status)}>{session.status}</span>
      </div>
      <div class="row dim">
        <span>
          {session.adapter} · {session.model ?? "n/a"}
        </span>
        <span>#{session.lastSeq}</span>
      </div>
    </button>
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
  const [budget, setBudget] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const rec = await hubApi.createSession({
        adapter,
        project,
        ...(prompt ? { prompt } : {}),
        ...(budget ? { budgetUsd: Number(budget) } : {}),
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
        Projekt (Pfad)
        <input
          value={project}
          onInput={(e) => setProject((e.target as HTMLInputElement).value)}
          placeholder="/home/user/repo"
        />
      </label>
      <label>
        Prompt (optional)
        <input
          value={prompt}
          onInput={(e) => setPrompt((e.target as HTMLInputElement).value)}
          placeholder="Refactore den Auth-Flow…"
        />
      </label>
      <label>
        Budget USD (optional)
        <input
          type="number"
          min="0"
          step="0.5"
          value={budget}
          onInput={(e) => setBudget((e.target as HTMLInputElement).value)}
          placeholder="5"
        />
      </label>
      {error && <div style="color: var(--err)">{error}</div>}
      <button class="btn primary" onClick={submit} disabled={busy || !project}>
        {busy ? "Starte…" : "Starten"}
      </button>
    </div>
  );
}
