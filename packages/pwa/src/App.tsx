import { useEffect, useState } from "preact/hooks";
import { hubApi, getToken, type AdapterInfo, type AdapterUsage, type DiscoveredProject, type SessionRecord } from "./api.ts";
import { Dashboard } from "./Dashboard.tsx";
import { Composer } from "./Composer.tsx";
import { SkillPicker, loadSelectedSkill, type SelectedSkill } from "./SkillOverlay.tsx";
import { applyTheme, getTheme, type Theme } from "./theme.ts";
import { GlobalDock, type Page } from "./Dock.tsx";

export function App({
  onOpen,
  ready,
  initialPage,
}: {
  onOpen: (session: SessionRecord) => void;
  ready: () => void;
  initialPage?: Page;
}) {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [usage, setUsage] = useState<Record<string, AdapterUsage>>({});
  const [error, setError] = useState("");
  // T1.6-2: bottom-dock navigation replaces the top icon buttons ("Buttons
  // oben sind sehr schlecht zu bedienen" — real ergonomics feedback from
  // the mockup review). Settings didn't exist as a destination before.
  // T1.6-3: initialPage lets SessionTail's dock jump straight to "new" or
  // "settings" instead of always landing back on the dashboard.
  const [page, setPage] = useState<Page>(initialPage ?? "dashboard");

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
    <div class="app-page">
      <div class="topbar">
        <h1>UACC</h1>
        {/* Real connection health, not a decorative always-green dot — same
         * classes SessionTail already uses for its own WS status. */}
        <span class={`conn-dot ${error ? "closed" : "live"}`} title={error ? error : "verbunden"} />
      </div>

      {error && <div class="card" style="color: var(--err)">{error}</div>}

      {page === "new" && (
        <CreateSession
          adapters={adapters}
          onCreated={(s) => {
            setPage("dashboard");
            onOpen(s);
          }}
        />
      )}

      {page === "settings" && <Settings onSwitchToken={ready} />}

      {page === "dashboard" &&
        (sessions === null ? (
          <div class="empty">lade…</div>
        ) : (
          <Dashboard sessions={sessions} usage={usage} onOpen={onOpen} />
        ))}

      <div class="dock-stack">
        <GlobalDock active={page} onNavigate={setPage} />
      </div>
    </div>
  );
}

function Settings({ onSwitchToken }: { onSwitchToken: () => void }) {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [projectCount, setProjectCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    hubApi
      .projects()
      .then((res) => {
        if (alive) setProjectCount(res.projects.length);
      })
      .catch(() => {
        if (alive) setProjectCount(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setThemeState(next);
  };

  return (
    <div class="card form-grid">
      <div class="settings-row">
        <span>Erscheinungsbild</span>
        <button class="btn" onClick={toggleTheme}>
          {theme === "dark" ? "☾ Dunkel" : "☀ Hell"}
        </button>
      </div>
      <div class="settings-row">
        <span>Erreichbar über</span>
        <span class="mono dim">{location.host}</span>
      </div>
      <div class="settings-row">
        <span>Geräte-Token</span>
        <span class="dim">{getToken() ? "•••• aktiv" : "kein Token"}</span>
      </div>
      <div class="settings-row">
        <span>Projekt-Wurzeln</span>
        <span class="dim">{projectCount === null ? "n/a" : `${projectCount} Projekte gefunden`}</span>
      </div>
      <button class="btn" onClick={onSwitchToken}>
        Geräte-Token wechseln
      </button>
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
  const [skill, setSkill] = useState<SelectedSkill | null>(null);

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

  // T1.5-10: the last skill/agent chosen FOR THIS PROJECT is always the
  // default (user's own requirement — "so dass man nicht immer auswählen
  // muss aber kann") — reloaded whenever the selected project changes.
  useEffect(() => {
    setSkill(project ? loadSelectedSkill(project) : null);
  }, [project]);

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
        ...(skill ? { args: { [skill.kind]: skill.name } } : {}),
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
        <Composer
          value={prompt}
          onChange={setPrompt}
          placeholder="Refactore den Auth-Flow…"
          adapter={adapter}
          project={project}
        />
      </label>
      {error && <div style="color: var(--err)">{error}</div>}
      <SkillPicker project={project} adapter={adapter} selection={skill} onChange={setSkill} />
      <button class="btn primary" onClick={submit} disabled={busy || !project}>
        {busy ? "Starte…" : "Starten"}
      </button>
    </div>
  );
}
