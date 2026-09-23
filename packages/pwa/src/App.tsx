import { useEffect, useMemo, useState } from "preact/hooks";
import { hubApi, hostApi, getToken, type AdapterInfo, type AdapterUsage, type DiscoveredProject, type FleetHost, type SessionRecord } from "./api.ts";
import { ApiContext } from "./api-context.ts";
import { Dashboard } from "./Dashboard.tsx";
import { Composer } from "./Composer.tsx";
import { SkillPicker, loadSelectedSkill, loadSelectedWorkflow, type SelectedSkill } from "./SkillOverlay.tsx";
import { applyTheme, getTheme, type Theme } from "./theme.ts";
import { GlobalDock, type Page } from "./Dock.tsx";
import { VoiceSheet } from "./VoiceSheet.tsx";
import { ApprovalQueuePane } from "./Approvals.tsx";
import { StatusPage } from "./StatusPage.tsx";
import { DiscoveryPane } from "./Discovery.tsx";
import { FleetSettings } from "./Fleet.tsx";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

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
  // EPIC-P6: hosts of the fleet (just this hub when nothing is paired).
  const [hosts, setHosts] = useState<FleetHost[]>([]);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [usage, setUsage] = useState<Record<string, AdapterUsage>>({});
  const [error, setError] = useState("");
  // T1.6-2: bottom-dock navigation replaces the top icon buttons ("Buttons
  // oben sind sehr schlecht zu bedienen" — real ergonomics feedback from
  // the mockup review). Settings didn't exist as a destination before.
  // T1.6-3: initialPage lets SessionTail's dock jump straight to "new" or
  // "settings" instead of always landing back on the dashboard.
  const [page, setPage] = useState<Page>(initialPage ?? "dashboard");
  const [voiceOpen, setVoiceOpen] = useState(false);
  // T2.6: pending-approval count for the Dashboard banner. A 501 (no
  // ApprovalService configured on this hub) is a real, common state, not
  // an error to surface — same "feature genuinely absent" handling as
  // Approvals.tsx itself.
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [fleet, a] = await Promise.all([
          // An older hub has no /api/fleet — its own list is the whole fleet.
          hubApi.fleet().catch(async () => ({ self: "", hosts: [] as FleetHost[], sessions: await hubApi.sessions() })),
          hubApi.adapters(),
        ]);
        if (!alive) return;
        setSessions(fleet.sessions);
        setHosts(fleet.hosts);
        setAdapters(a);
        setError("");
        hubApi
          .approvals("pending")
          .then((pending) => alive && setPendingApprovals(pending.length))
          .catch(() => alive && setPendingApprovals(0));
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
        <div style="display: flex; gap: 10px; align-items: center">
          {/* Real user feedback (2026-09-19): provider/quota detail used to
           * sit inline on the Dashboard, dominating small screens before
           * any session ever showed — moved to its own page, reached from
           * here. */}
          <button class="link-btn" onClick={() => setPage("status")} title="Provider-Status">
            Status
          </button>
          {/* Real connection health, not a decorative always-green dot — same
           * classes SessionTail already uses for its own WS status. */}
          <span class={`conn-dot ${error ? "closed" : "live"}`} title={error ? error : "verbunden"} />
        </div>
      </div>

      {error && <div class="card" style="color: var(--err)">{error}</div>}

      {page === "new" && (
        <CreateSession
          adapters={adapters}
          hosts={hosts}
          onCreated={(s) => {
            setPage("dashboard");
            onOpen(s);
          }}
        />
      )}

      {page === "settings" && (
        <>
          <Settings onSwitchToken={ready} />
          <FleetSettings />
        </>
      )}

      {page === "approvals" && <ApprovalQueuePane />}

      {page === "status" && <StatusPage adapters={adapters} usage={usage} />}

      {page === "discovery" && <DiscoveryPane onOpen={onOpen} />}

      {page === "dashboard" &&
        (sessions === null ? (
          <div class="empty">lade…</div>
        ) : (
          <Dashboard
            sessions={sessions}
            hosts={hosts}
            onOpen={onOpen}
            pendingApprovals={pendingApprovals}
            onOpenApprovals={() => setPage("approvals")}
            onOpenDiscovery={() => setPage("discovery")}
          />
        ))}

      <VoiceSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} />

      <div class="dock-stack">
        <GlobalDock active={page} onNavigate={setPage} onVoice={() => setVoiceOpen(true)} />
      </div>
    </div>
  );
}

function Settings({ onSwitchToken }: { onSwitchToken: () => void }) {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [projectCount, setProjectCount] = useState<number | null>(null);
  // T2.5: null = unknown/loading, undefined = webauthn not configured on
  // this hub (501) — kept distinct from "false" (configured, not
  // registered yet) so the row can say the right thing in each case.
  const [passkey, setPasskey] = useState<boolean | null | undefined>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");

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
    hubApi
      .webauthnStatus()
      .then((res) => alive && setPasskey(res.registered))
      .catch(() => alive && setPasskey(undefined));
    return () => {
      alive = false;
    };
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setThemeState(next);
  };

  const registerPasskey = async () => {
    setPasskeyBusy(true);
    setPasskeyError("");
    try {
      const options = (await hubApi.webauthnRegisterOptions()) as PublicKeyCredentialCreationOptionsJSON;
      const attestation = await startRegistration({ optionsJSON: options });
      const result = await hubApi.webauthnRegisterVerify(attestation);
      setPasskey(result.ok);
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : "Passkey-Registrierung fehlgeschlagen");
    } finally {
      setPasskeyBusy(false);
    }
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
      <div class="settings-row">
        <span>Passkey (für destruktive Freigaben, T2.5)</span>
        {passkey === undefined ? (
          <span class="dim">nicht konfiguriert</span>
        ) : passkey === true ? (
          <span class="dim">✓ registriert</span>
        ) : (
          <button
            class={passkeyBusy ? "btn busy" : "btn"}
            aria-busy={passkeyBusy}
            onClick={registerPasskey}
            disabled={passkeyBusy}
          >
            {passkeyBusy ? "lädt…" : "Passkey registrieren"}
          </button>
        )}
      </div>
      {passkeyError && <div style="color: var(--err); font-size: 12px">{passkeyError}</div>}
      <button class="btn" onClick={onSwitchToken}>
        Geräte-Token wechseln
      </button>
    </div>
  );
}

function CreateSession({
  adapters: localAdapters,
  hosts,
  onCreated,
}: {
  adapters: AdapterInfo[];
  hosts: FleetHost[];
  onCreated: (s: SessionRecord) => void;
}) {
  // EPIC-P6: a session starts on exactly the chosen host.
  const selfHost = hosts.find((h) => h.self)?.hostId ?? null;
  const [host, setHost] = useState<string | null>(selfHost);
  const remote = host !== null && host !== selfHost;
  const api = useMemo(() => (remote ? hostApi(host) : hubApi), [host, remote]);
  const [remoteAdapters, setRemoteAdapters] = useState<AdapterInfo[]>([]);
  const adapters = remote ? remoteAdapters : localAdapters;
  useEffect(() => {
    if (!remote) return;
    api.adapters().then(setRemoteAdapters).catch(() => setRemoteAdapters([]));
  }, [api, remote]);
  const [adapter, setAdapter] = useState(adapters[0]?.id ?? "dummy");
  useEffect(() => {
    if (adapters.length > 0 && !adapters.some((a) => a.id === adapter)) setAdapter(adapters[0]!.id);
  }, [adapters]);
  const [project, setProject] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<DiscoveredProject[] | null>(null);
  const [skill, setSkill] = useState<SelectedSkill | null>(null);
  // T1.6-6: SessionSpec.model existed in the contract (and the PWA client
  // type) since P0 but nothing ever set it and adapter-claude never read
  // it — a real dead field, closed end to end now. Only claude has a
  // verified --model flag (adapter-claude/src/index.ts); other adapters
  // get no picker rather than a chip that silently does nothing.
  const [model, setModel] = useState<string | null>(null);
  useEffect(() => {
    setModel(adapter === "claude" ? "sonnet" : null);
  }, [adapter]);

  useEffect(() => {
    let alive = true;
    setProjects(null);
    setProject("");
    api
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
  }, [api]);

  // T1.5-10: the last skill/agent chosen FOR THIS PROJECT is always the
  // default (user's own requirement — "so dass man nicht immer auswählen
  // muss aber kann") — reloaded whenever the selected project changes.
  useEffect(() => {
    setSkill(project ? loadSelectedSkill(project) : null);
  }, [project]);

  const withWorkflow = (text: string): string => {
    if (skill || !project) return text;
    const name = loadSelectedWorkflow(project);
    if (!name) return text;
    const line = `Workflow: ${name}\n\n`;
    return text.startsWith(line) ? text : `${line}${text}`;
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      // T1.5-3: no budgetUsd input — the user works exclusively with
      // coding subscriptions, where a $ figure per session doesn't answer
      // anything real (see the Kontingent display instead). The contract
      // field itself is untouched (createSession still accepts it) for P2
      // to build on for API-key-billed adapters.
      const rec = await api.createSession({
        adapter,
        project,
        ...(prompt ? { prompt: withWorkflow(prompt) } : {}),
        ...(model ? { model } : {}),
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
    <ApiContext.Provider value={api}>
    <div class="card form-grid">
      {hosts.length > 1 && (
        <label>
          Host
          <select value={host ?? ""} onChange={(e) => setHost((e.target as HTMLSelectElement).value)}>
            {hosts.map((h) => (
              <option key={h.hostId} value={h.hostId} disabled={h.state !== "reachable"}>
                {h.hostId}
                {h.self ? " (dieser)" : h.state !== "reachable" ? ` (${h.state})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
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
      {model !== null && (
        <label>
          Modell
          <div class="choice-row">
            <button
              type="button"
              class={`choice ${model === "sonnet" ? "active" : ""}`}
              onClick={() => setModel("sonnet")}
            >
              Sonnet 5
            </button>
            <button type="button" class={`choice ${model === "opus" ? "active" : ""}`} onClick={() => setModel("opus")}>
              Opus 5
            </button>
          </div>
        </label>
      )}
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
          onUseRecommendation={(item) => setSkill(item)}
        />
      </label>
      {error && <div style="color: var(--err)">{error}</div>}
      <SkillPicker project={project} adapter={adapter} selection={skill} onChange={setSkill} />
      <button class={busy ? "btn primary busy" : "btn primary"} aria-busy={busy} onClick={submit} disabled={busy || !project}>
        {busy ? "lädt…" : "Starten"}
      </button>
    </div>
    </ApiContext.Provider>
  );
}
