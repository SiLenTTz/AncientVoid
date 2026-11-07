import { takeHandOver } from "../../shared/media.ts";
import { takeShareInbox } from "../../app/share-inbox.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
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
  const [adapter, setAdapter] = useState(initialAdapter(last, adapters));
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
  useEffect(() => {
    setModel("");
    setCatalog(null);
    setDefaultModel(null);
    if (!modelChoice) return;
    let alive = true;
    api
      .adapterModels(adapter)
      .then((res) => {
        if (!alive) return;
        setCatalog(res.models);
        setDefaultModel(res.defaultModel);
        // The registration's default is what "Standard des Harness" runs —
        // preselect it so the dropdown shows the actual model from the start.
        if (typeof res.defaultModel === "string" && res.defaultModel) setModel(res.defaultModel);
      })
      .catch(() => alive && setCatalog(null));
    return () => {
      alive = false;
    };
  }, [adapter, modelChoice, api]);

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
        if (res.projects.length > 0) setProject((p) => p || (res.projects.some((x) => x.path === last.project) ? last.project! : res.projects[0]!.path));
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

  useEffect(() => {
    if (loop?.id === "securesight-factory" && !["claude", "maki"].includes(adapter)) setAdapter("claude");
  }, [loop?.id, adapter]);

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
      }
      // EPIC-P26 T26.5 (ADR-0043): securesight „bestehend“ startet den
      // Factory-Lauf — Treiber (/factory mit dem Auftrag als Prompt) plus
      // verknüpfter Beobachter. Die Treiberwahl bleibt erhalten (ADR-0048).
      const factoryRun = startLoop?.id === "securesight-factory" && !isOnboarding(loopInfo, startLoop);
      const rec = factoryRun
        ? (await api.factoryStart({ project, adapter, ...(modelChoice && model.trim() ? { model: model.trim() } : {}), ...(prompt ? { goal: prompt } : {}) })).driver
        : await api.createSession({
            ...(startLoop ? { loop: startLoop } : { adapter }),
            project,
            ...(prompt ? { prompt: withWorkflow(prompt) } : {}),
            ...(modelChoice && model.trim() ? { model: model.trim() } : {}),
            ...(skill || mode ? { args: { ...(skill ? { [skill.kind]: skill.name } : {}), ...(mode ? { permissionMode: mode } : {}) } } : {}),
            ...(attachments.length > 0 ? { attachmentIds: attachments.map((a) => a.id) } : {}),
          });
      localStorage.removeItem(PROMPT_KEY);
      localStorage.setItem(LAST_KEY, JSON.stringify({ host, adapter, project, loop: startLoop }));
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
        ) : (
          <span class="dim" style="font-size: calc(11px * var(--font-scale, 1))">
            keine Projekt-Wurzeln konfiguriert — siehe docs/configuration.md
          </span>
        )}
      </label>
      {projects !== null && projects.length > 0 && (
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
        <select value={adapter} onChange={(e) => setAdapter((e.target as HTMLSelectElement).value)}>
          {adapters.filter((a) => !loop || ["claude", "maki"].includes(a.id)).map((a) => (
            <option key={a.id} value={a.id}>
              {a.id}
              {a.capabilities.features && !a.capabilities.features.followUp ? " (nur beobachten)" : ""}
            </option>
          ))}
        </select>
      </label>
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
          onSubmit={busy || !project || loopBlock ? undefined : () => void submit()}
        />
      </label>
      {error && <div style="color: var(--err)">{error}</div>}
      {!loop && <SkillPicker project={project} supported={Boolean(features?.skills || features?.agents)} selection={skill} onChange={setSkill} />}
      {loopBlock && loop && <div class="loop-block warn" role="alert">{loopBlock}</div>}
      {onboardNote && <div class="dim loop-note" role="status">{onboardNote}</div>}
      <button class={busy ? "btn primary busy" : "btn primary"} aria-busy={busy} onClick={submit} disabled={busy || !project || !!loopBlock}>
        {busy ? "lädt…" : "Starten"}
      </button>
    </div>
    </ApiContext.Provider>
  );
}
