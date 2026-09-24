import { useEffect, useMemo, useState } from "preact/hooks";
import { hubApi, hostApi, type AdapterInfo, type DiscoveredProject, type FleetHost, type ModelOption, type SessionRecord } from "../../shared/api.ts";
import type { AttachmentRecord } from "../../shared/api.ts";
import { ApiContext } from "../../shared/api-context.ts";
import { Composer } from "../composer/Composer.tsx";
import { SkillPicker, loadSelectedSkill, loadSelectedWorkflow, type SelectedSkill } from "../composer/SkillOverlay.tsx";

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
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<DiscoveredProject[] | null>(null);
  const [skill, setSkill] = useState<SelectedSkill | null>(null);
  // ADR-0018: a model picker only where the harness takes one at start,
  // filled from its catalog when it has one, else free text.
  const features = adapters.find((a) => a.id === adapter)?.capabilities.features;
  const modelChoice = features?.modelChoice === "start";
  const [model, setModel] = useState("");
  const [catalog, setCatalog] = useState<ModelOption[] | null>(null);
  useEffect(() => {
    setModel("");
    setCatalog(null);
    if (!modelChoice) return;
    let alive = true;
    api
      .adapterModels(adapter)
      .then((res) => alive && setCatalog(res.models))
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
        ...(modelChoice && model.trim() ? { model: model.trim() } : {}),
        ...(skill ? { args: { [skill.kind]: skill.name } } : {}),
        ...(attachments.length > 0 ? { attachmentIds: attachments.map((a) => a.id) } : {}),
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
              {a.id}
              {a.capabilities.features && !a.capabilities.features.followUp ? " (nur beobachten)" : ""}
            </option>
          ))}
        </select>
      </label>
      {features?.toolGate === "bypass" && (
        <div class="tool-gate warn">{adapter}: Tools laufen ungefragt, ohne Rückfrage an dich.</div>
      )}
      {modelChoice && (
        <label>
          Modell
          {catalog && catalog.length > 0 ? (
            <select value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)}>
              <option value="">Standard des Harness</option>
              {catalog.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label ?? m.id}
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
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
      </label>
      {error && <div style="color: var(--err)">{error}</div>}
      <SkillPicker project={project} supported={Boolean(features?.skills || features?.agents)} selection={skill} onChange={setSkill} />
      <button class={busy ? "btn primary busy" : "btn primary"} aria-busy={busy} onClick={submit} disabled={busy || !project}>
        {busy ? "lädt…" : "Starten"}
      </button>
    </div>
    </ApiContext.Provider>
  );
}
