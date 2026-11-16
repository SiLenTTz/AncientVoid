import { WorkplaceChoice, type WorkplaceMode } from "./WorkplaceChoice.tsx";
import { CustomModelDialog } from "./CustomModelDialog.tsx";
import { takeHandOver } from "../../shared/media.ts";
import { takeShareInbox } from "../../app/share-inbox.ts";
import { sourcesBlock, sourcesOf, consumeSources, type SourceRef } from "../../shared/sources.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { LoopPicker } from "../loops/LoopPicker.tsx";
import type { LoopInfo, LoopSpec } from "@ancientvoid/contracts";
import { emptyOnboard, isOnboarding, loopBlocker, type OnboardDraft } from "../loops/loop-form.ts";
import { hubApi, hostApi, type AdapterInfo, type DiscoveredProject, type FleetHost, type ModelOption, type SessionRecord } from "../../shared/api.ts";
import type { AttachmentRecord } from "../../shared/api.ts";
import { ApiContext } from "../../shared/api-context.ts";
import { Composer } from "../composer/Composer.tsx";
import { SkillPicker, loadSelectedWorkflow, rememberedSkill, type SelectedSkill } from "../composer/SkillOverlay.tsx";

const LAST_KEY = "ancientvoid.newSession.last";
const PROMPT_KEY = "ancientvoid.newSession.prompt";

function readLast(): { host?: string | null; adapter?: string; project?: string; loop?: LoopSpec | null } {
  try {
    return (JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") ?? {}) as { host?: string | null; adapter?: string; project?: string; loop?: LoopSpec | null };
  } catch {
    return {};
  }
}

/** EPIC-P43 T43.6: die Schnellsuche springt mit einem Projekt in „Neue Session“ — über dieselbe Merkung. */
export function preselectProject(path: string): void {
  localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), project: path }));
}

/** BUG-0096: Die Merkung ist die stärkste Quelle für den Start-Adapter —
 * die Adapterliste kann beim Mount noch leer sein (async Abruf), und der
 * alte Fallback („dummy“/erster Eintrag) blieb dann für immer stehen, weil
 * der Nachlade-Effekt einen gültig erscheinenden Wert nie korrigierte. */
export function initialAdapter(last: { adapter?: string } | undefined, adapters: readonly { id: string }[]): string {
  return last?.adapter ?? adapters[0]?.id ?? "dummy";
}

export function CreateSession({
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
  // T8.4: start where you last started — host, harness, project — and
  // keep an unsent start prompt on this device.
  const last = useMemo(readLast, []);
  const [host, setHost] = useState<string | null>(last.host && hosts.some((h) => h.hostId === last.host) ? last.host : selfHost);
  const remote = host !== null && host !== selfHost;
  const api = useMemo(() => (remote ? hostApi(host) : hubApi), [host, remote]);
  const [remoteAdapters, setRemoteAdapters] = useState<AdapterInfo[]>([]);
  const adapters = remote ? remoteAdapters : localAdapters;
  useEffect(() => {
    if (!remote) return;
    api.adapters().then(setRemoteAdapters).catch(() => setRemoteAdapters([]));
  }, [api, remote]);
  const [adapter, setAdapterState] = useState(initialAdapter(last, adapters));
  // BUG-0105: die Wahl gilt ab dem Klick, nicht erst ab dem Start — ein Remount
  // darf sie nicht auf den zuletzt gestarteten Adapter zurückwerfen.
  const setAdapter = useCallback((id: string) => {
    setAdapterState(id);
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), adapter: id }));
    } catch {
      /* Speicher gesperrt/voll: Wahl bleibt Komponentenzustand (Merkung beim Submit). */
    }
  }, []);
  useEffect(() => {
    if (adapters.length > 0 && !adapters.some((a) => a.id === adapter)) setAdapter(adapters[0]!.id);
  }, [adapters]);
  const [project, setProject] = useState("");
  const [loop, setLoop] = useState<LoopSpec | null>(null);
  const [loopInfo, setLoopInfo] = useState<LoopInfo | null>(null);
  const [loopConfirmed, setLoopConfirmed] = useState(false);
  const [onboard, setOnboard] = useState<OnboardDraft>(emptyOnboard);
  const [loopReload, setLoopReload] = useState(0);
  const [onboardNote, setOnboardNote] = useState("");
  const loopBlock = loopBlocker(loopInfo, loop, loopConfirmed, onboard);
  // EPIC-P10.5: a video result handed over from the media page.
  const [attachments, setAttachments] = useState<AttachmentRecord[]>(() => takeHandOver("new"));
  const [prompt, setPromptState] = useState(() => localStorage.getItem(PROMPT_KEY) ?? "");
  const setPrompt = (p: string) => {
    setPromptState(p);
    if (p) localStorage.setItem(PROMPT_KEY, p);
    else localStorage.removeItem(PROMPT_KEY);
  };
  // AI-P9-2: ein Share aus einer anderen App füllt den Auftrag einmalig
  // vor — ungesendeter eigener Text bleibt, Geteiltes wird angehängt.
  useEffect(() => {
    const shared = takeShareInbox();
    if (!shared) return;
    setPromptState((p) => {
      const next = p ? `${p}\n\n${shared}` : shared;
      localStorage.setItem(PROMPT_KEY, next);
      return next;
    });
  }, []);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<DiscoveredProject[] | null>(null);
  // BUG-0173: ob Projekt-Wurzeln konfiguriert sind, ist eine eigene Tatsache —
  // die Anzahl der gefundenen Repos darf nicht als Stellvertreter herhalten.
  const [rootsInfo, setRootsInfo] = useState<{ configured: boolean; roots: string[] } | null>(null);
  // BUG-0009/0169: grindige Wurzeln und gekürzte Listen dürfen nicht verschwinden.
  const [projectWarnings, setProjectWarnings] = useState<string[]>([]);
  // T-PJ1: inline project creation (git init in first projectRoot)
  const [newProject, setNewProject] = useState("");
  const [creating, setCreating] = useState(false);
  const createNewProject = async () => {
    const name = newProject.trim();
    if (!name || creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await hubApi.createProject(name);
      if (res.created || res.project) {
        setNewProject("");
        const list = await hubApi.projects();
        setProjects(list.projects);
        setProject(res.project.path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };
  const [skill, setSkill] = useState<SelectedSkill | null>(null);
  // EPIC-P38: Arbeitsort — Standard eigener Worktree; „direkt“ nur bewusst gewählt.
  const [workplace, setWorkplace] = useState<WorkplaceMode>("worktree");
  const [confirmDirty, setConfirmDirty] = useState(false);
  const [workplaceBlocked, setWorkplaceBlocked] = useState(false);
  // ADR-0081: parallels Schreiben im Nicht-Git-Ordner ist eine eigene, bewusste Entscheidung.
  const [confirmShared, setConfirmShared] = useState(false);
  useEffect(() => { setConfirmDirty(false); setConfirmShared(false); }, [project, workplace]);
  // ADR-0018: a model picker only where the harness takes one at start,
  // filled from its catalog when it has one, else free text.
  const features = adapters.find((a) => a.id === adapter)?.capabilities.features;
  const modelChoice = features?.modelChoice === "start";
  const [model, setModel] = useState("");
  // ADR-0033: leer = Standard des Hubs (Auto, wo der Harness es kennt).
  const modes = features?.permissionModes ?? [];
  const [mode, setMode] = useState("");
  useEffect(() => setMode(""), [adapter]);
  const [catalog, setCatalog] = useState<ModelOption[] | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  // ADR-0060: eigene Modelle/Endpunkte; `catalogTick` lädt den Katalog nach dem Anlegen neu.
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [catalogTick, setCatalogTick] = useState(0);
  const pendingPick = useRef<string | null>(null);
  useEffect(() => {
    setModel("");
    setCatalog(null);
    setDefaultModel(null);
    setCustomIds([]);
    if (!modelChoice) return;
    let alive = true;
    api
      .adapterModels(adapter)
      .then((res) => {
        if (!alive) return;
        setCatalog(res.models);
        setDefaultModel(res.defaultModel);
        setCustomIds(res.customIds ?? []);
        // The registration's default is what "Standard des Harness" runs —
        // preselect it so the dropdown shows the actual model from the start.
        if (pendingPick.current) setModel(pendingPick.current);
        else if (typeof res.defaultModel === "string" && res.defaultModel) setModel(res.defaultModel);
        pendingPick.current = null;
      })
      .catch(() => alive && setCatalog(null));
    return () => {
      alive = false;
    };
  }, [adapter, modelChoice, api, catalogTick]);

  useEffect(() => {
    let alive = true;
    setProjects(null);
    setProject("");
    api
      .projects()
      .then((res) => {
        if (!alive) return;
        setProjects(res.projects);
        setRootsInfo({ configured: res.rootsConfigured ?? res.projects.length > 0, roots: res.roots ?? [] });
        setProjectWarnings(res.warnings ?? []);
        // Preselect the first discovered project so "Starten" works
        // without any typing when a picker is shown. BUG-0173: der gemerkte
        // Pfad gilt auch dann, wenn gar kein Git-Repo gefunden wurde — sonst
        // tippen Nutzer, die ohne Git arbeiten, jeden Tag alles neu.
        setProject((p) => p || last.project || res.projects[0]?.path || "");
      })
      .catch(() => {
        // T1.5-5: an unreachable /api/projects must not make the form
        // unusable — fall back to the free-text path exactly as if no
        // projectRoots were configured (BUG-0006 lesson: onboarding paths
        // must never become a dead end).
        if (alive) setProjects([]);
        if (alive) setRootsInfo(null);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  // T1.5-10: the last skill/agent chosen FOR THIS PROJECT is always the
  // default (user's own requirement — "so dass man nicht immer auswählen
  // muss aber kann") — reloaded whenever the selected project changes.
  // BUG-0078: only for adapters that support its kind, otherwise the hub
  // would refuse the whole start (the picker stays hidden there).
  useEffect(() => {
    setSkill(rememberedSkill(project, features));
  }, [project, features]);

  const withWorkflow = (text: string): string => {
    if (skill || !project) return text;
    const name = loadSelectedWorkflow(project);
    if (!name) return text;
    const line = `Workflow: ${name}\n\n`;
    return text.startsWith(line) ? text : `${line}${text}`;
  };

  // EPIC-P43.5 T43.5-1: Quellenchips der Neuanlage wandern beim Start in den
  // Prompt/Auftrag — dieselbe Blockform wie die Composer-Vorschau, danach verbraucht.
  const withSources = (text: string, sources: SourceRef[]): string => {
    if (sources.length === 0) return text;
    return `${text}${text.trim() ? "\n\n" : ""}${sourcesBlock(sources)}`;
  };

  // BUG-0105: nur claude/maki sind Factory-Treiber — eine ersetzte Wahl wird
  // gesagt (fail loud), nie still getauscht.
  const [replacedDriver, setReplacedDriver] = useState<string | null>(null);
  useEffect(() => {
    setReplacedDriver(null);
  }, [loop?.id]);
  useEffect(() => {
    if (loop?.id === "securesight-factory" && !["claude", "maki"].includes(adapter)) {
      setReplacedDriver(adapter);
      setAdapter("claude");
    }
  }, [loop?.id, adapter, setAdapter]);

  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      // T1.5-3: no budgetUsd input — the user works exclusively with
      // coding subscriptions, where a $ figure per session doesn't answer
      // anything real (see the Kontingent display instead). The contract
      // field itself is untouched (createSession still accepts it) for P2
      // to build on for API-key-billed adapters.
      let startLoop = loop;
      // Neues Repo: erst die Linie einrichten (factoryctl), dann die Session auf ihr starten.
      const ob = loopInfo?.capabilities?.onboarding;
      if (loop && ob && isOnboarding(loopInfo, loop)) {
        setOnboardNote("Linie wird angelegt … das kann eine Minute dauern.");
        const made = await api.onboardLoop(loop.id, { options: onboard.values, secret: onboard.secret });
        setOnboardNote("");
        if (!made.ok) throw new Error(made.detail);
        startLoop = { ...loop, options: { ...loop.options, [ob.optionKey]: made.options[ob.optionKey] ?? "" } };
        setLoop(startLoop);
        setOnboard(emptyOnboard);
        setLoopReload((n) => n + 1);
        // AC-P26-1 / Premortem 2: „bereit“ nur, wenn die Factory es meldet — sonst die Checkliste zeigen und nicht starten.
        if (made.ready === false) {
          setOnboardNote(`Projekt eingerichtet, aber noch nicht bereit: ${made.detail ?? "Checkliste der Factory prüfen"}. Es wurde kein Lauf gestartet — nach der Klärung erneut „Starten“.`);
          return;
        }
        if (made.detail) setOnboardNote(`Einrichtung: ${made.detail}`);
      }
      // EPIC-P26 T26.5 (ADR-0043): securesight „bestehend“ startet den
      // Factory-Lauf — Treiber (/factory mit dem Auftrag als Prompt) plus
      // verknüpfter Beobachter. Die Treiberwahl bleibt erhalten (ADR-0048).
      const factoryRun = startLoop?.id === "securesight-factory" && !isOnboarding(loopInfo, startLoop);
      const selectedSources = sourcesOf("new");
      const rec = factoryRun
        ? (await api.factoryStart({ project, adapter, ...(modelChoice && model.trim() ? { model: model.trim() } : {}), ...(prompt ? { goal: withSources(prompt, selectedSources) } : {}) })).driver
        : await api.createSession({
            ...(startLoop ? { loop: startLoop } : { adapter }),
            project,
            ...(prompt ? { prompt: withSources(withWorkflow(prompt), selectedSources) } : {}),
            ...(modelChoice && model.trim() ? { model: model.trim() } : {}),
            ...(skill || mode ? { args: { ...(skill ? { [skill.kind]: skill.name } : {}), ...(mode ? { permissionMode: mode } : {}) } } : {}),
            ...(attachments.length > 0 ? { attachmentIds: attachments.map((a) => a.id) } : {}),
            // Loops arbeiten immer im Projekt des Loop-Systems — dort gibt es keine Arbeitsort-Wahl.
            ...(startLoop ? {} : { workspaceMode: workplace, ...(workplace === "direct" && confirmDirty ? { confirmDirty: true } : {}), ...(workplace === "direct" && confirmShared ? { confirmSharedFolder: true } : {}) }),
          });
      localStorage.removeItem(PROMPT_KEY);
      localStorage.setItem(LAST_KEY, JSON.stringify({ host, adapter, project, loop: startLoop }));
      consumeSources("new", selectedSources);
      onCreated(rec);
    } catch (err) {
      setOnboardNote("");
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <ApiContext.Provider value={api}>
    <div class="card form-grid">
      {/* Projekt zuerst: jede weitere Angabe (Pfad, gemerkter Skill,
          Workflow) hängt an ihm — der Pfad wird aus der Auswahl vorbelegt
          und bleibt darunter überschreibbar. */}
      <label>
        Projekt
        {projects === null ? (
          <input disabled placeholder="lade…" />
        ) : projects.length > 0 ? (
          <select
            value={projects.some((p) => p.path === project) ? project : ""}
            onChange={(e) => setProject((e.target as HTMLSelectElement).value)}
          >
            {projects.every((p) => p.path !== project) && <option value="">eigener Pfad (siehe unten)</option>}
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
                {p.branch ? ` (${p.branch})` : ""}
              </option>
            ))}
          </select>
        ) : rootsInfo?.configured ? (
          <span class="dim" style="font-size: calc(11px * var(--font-scale, 1))">
            kein Git-Repo in den Wurzeln ({rootsInfo.roots.join(", ")}) — Pfad eintippen; ein noch fehlender Ordner wird beim Start angelegt
          </span>
        ) : (
          <span class="dim" style="font-size: calc(11px * var(--font-scale, 1))">
            keine Projekt-Wurzeln konfiguriert — siehe docs/configuration.md, oder Pfad direkt eintippen
          </span>
        )}
      </label>
      {projectWarnings.length > 0 && (
        <ul class="dim" style={{ margin: "2px 0", paddingLeft: 18, fontSize: "calc(11px * var(--font-scale, 1))" }}>
          {projectWarnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {projects !== null && (rootsInfo?.configured ?? projects.length > 0) && (
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={newProject}
            onInput={(e) => setNewProject((e.target as HTMLInputElement).value)}
            placeholder="neues Projekt (Name)"
            style={{ flex: 1 }}
          />
          <button type="button" disabled={!newProject.trim() || creating} onClick={createNewProject}>
            {creating ? "…" : "+ Anlegen"}
          </button>
        </div>
      )}
      <label>
        Pfad
        <input
          value={project}
          onInput={(e) => setProject((e.target as HTMLInputElement).value)}
          placeholder="/home/user/repo"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
        />
      </label>
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
      <LoopPicker api={api} value={loop} confirmed={loopConfirmed} onConfirmed={setLoopConfirmed} onChange={(next, info) => { setLoop(next); setLoopInfo(info); setOnboard(emptyOnboard); }} onboard={onboard} onOnboard={setOnboard} reload={loopReload} initial={last.loop ?? null} project={project} />
      {(!loop || loop.id === "securesight-factory") && (
        <>
      <label>
        {loop ? "Factory-Treiber" : "Adapter"}
        <select value={adapter} onChange={(e) => { setReplacedDriver(null); setAdapter((e.target as HTMLSelectElement).value); }}>
          {adapters.filter((a) => !loop || ["claude", "maki"].includes(a.id)).map((a) => (
            <option key={a.id} value={a.id}>
              {a.id}
              {a.capabilities.features && !a.capabilities.features.followUp ? " (nur beobachten)" : ""}
            </option>
          ))}
        </select>
      </label>
      {loop?.id === "securesight-factory" && replacedDriver && (
        <div class="tool-gate warn" role="status">
          Factory-Treiber läuft nur mit claude oder maki — „{replacedDriver}“ wurde ersetzt.
        </div>
      )}
      {features?.toolGate === "bypass" && (
        <div class="tool-gate warn">{adapter}: Tools laufen ungefragt, ohne Rückfrage an dich.</div>
      )}
      {!loop && modes.length > 0 && (
        <label>
          Modus
          <select aria-label="Modus" value={mode} onChange={(e) => setMode((e.target as HTMLSelectElement).value)}>
            <option value="">Standard des Hubs</option>
            {modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}
      {modelChoice && (
        <label>
          {loop ? "Treiber-Modell" : "Modell"}
          {catalog && catalog.length > 0 ? (
            <select value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)}>
              <option value="">Standard des Harness</option>
              {catalog.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label ?? m.id}
                  {m.id === defaultModel ? " (Standard)" : ""}
                  {customIds.includes(m.id) ? " · eigenes" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onInput={(e) => setModel((e.target as HTMLInputElement).value)}
              placeholder="Standard des Harness"
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
            />
          )}
        </label>
      )}
      {modelChoice && (
        <button class="btn" type="button" onClick={() => setCustomOpen(true)} style="justify-self: start">
          ＋ Eigenes Modell / Endpunkt
        </button>
      )}
      {customOpen && (
        <CustomModelDialog
          adapter={adapter}
          canEndpoint={adapter === "pi"}
          api={api}
          onClose={() => setCustomOpen(false)}
          onChanged={(pick) => {
            if (pick) pendingPick.current = pick;
            setCatalogTick((t) => t + 1);
          }}
        />
      )}
        </>
      )}
      <label>
        Prompt (optional)
        <Composer
          value={prompt}
          onChange={setPrompt}
          fieldId="new_prompt"
          placeholder="Refactore den Auth-Flow…"
          adapter={adapter}
          project={project}
          adapterEnhance={adapters.find((a) => a.id === adapter)?.enhance}
          commands={adapters.find((a) => a.id === adapter)?.capabilities.commands}
          commandScope="start"
          onUseRecommendation={(item) => setSkill(item)}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          sourceTarget="new"
          onSubmit={busy || !project || loopBlock ? undefined : () => void submit()}
        />
      </label>
      {!loop && project && (
        <WorkplaceChoice api={api} project={project} mode={workplace} onMode={setWorkplace} confirmDirty={confirmDirty} onConfirmDirty={setConfirmDirty} confirmShared={confirmShared} onConfirmShared={setConfirmShared} onBlockedChange={setWorkplaceBlocked} />
      )}
      {error && <div role="alert" style="color: var(--err)">{error}</div>}
      {!loop && <SkillPicker project={project} supported={Boolean(features?.skills || features?.agents)} selection={skill} onChange={setSkill} />}
      {loopBlock && loop && <div class="loop-block warn" role="alert">{loopBlock}</div>}
      {onboardNote && <div class="dim loop-note" role="status">{onboardNote}</div>}
      <button class={busy ? "btn primary busy" : "btn primary"} aria-busy={busy} onClick={submit} disabled={busy || !project || !!loopBlock || (!loop && workplaceBlocked)}>
        {busy ? "lädt…" : "Starten"}
      </button>
    </div>
    </ApiContext.Provider>
  );
}
