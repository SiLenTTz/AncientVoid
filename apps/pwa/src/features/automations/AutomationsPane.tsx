import { useEffect, useMemo, useState } from "preact/hooks";
import type { AutomationInfo, Team } from "@ancientvoid/contracts";
import { getToken, hostApi, type AdapterInfo, type DiscoveredProject } from "../../shared/api.ts";
import { ApiContext, useApi } from "../../shared/api-context.ts";
import { useHubStatus } from "../shell/hub-status.ts";
import { AutomationForm } from "./AutomationForm.tsx";
import { AutomationDetail } from "./AutomationDetail.tsx";
import { automationCacheKey, readAutomationSnapshot, writeAutomationSnapshot } from "./automation-cache.ts";
import { outcomeLabel, REASON_LABEL, scheduleText, STATE_LABEL } from "./automation-labels.ts";

export function AutomationsPane() {
  const [host, setHost] = useState<string | null>(null);
  const { hosts } = useHubStatus();
  const api = useMemo(() => hostApi(host), [host]);
  return <div>
    <label>Ausführungshost<select value={host ?? ""} onChange={e => setHost(e.currentTarget.value || null)}>
      <option value="">Dieser Host</option>{hosts.filter(h => !h.self).map(h => <option key={h.hostId} value={h.hostId}>{h.label ?? h.hostId} · {h.state}</option>)}
    </select></label>
    <ApiContext.Provider value={api}><AutomationsHostPane key={host ?? "self"} host={host} /></ApiContext.Provider>
  </div>;
}

function AutomationsHostPane({ host }: { host: string | null }) {
  const api = useApi();
  const [automations, setAutomations] = useState<AutomationInfo[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<AutomationInfo | null>(null);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [at, setAt] = useState("");
  const [cacheKey, setCacheKey] = useState("");
  const [networkAvailable, setNetworkAvailable] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setNetworkAvailable(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    void automationCacheKey(api.automationsScope, getToken()).then(key => {
      if (!alive) return;
      setCacheKey(key);
      const cached = readAutomationSnapshot(key);
      if (cached) { setAutomations(cached.list); setAt(cached.at); }
      let pending = false;
      const tick = async () => {
        if (pending || !alive) return;
        pending = true;
        try {
          const list = await api.automations();
          if (!alive) return;
          const fetchedAt = new Date().toISOString();
          setAutomations(list); setAt(fetchedAt); setOnline(true); setReadError("");
          writeAutomationSnapshot(key, { at: fetchedAt, list, histories: readAutomationSnapshot(key)?.histories ?? [] });
        } catch (err) {
          if (alive) { setOnline(false); setReadError(err instanceof Error ? err.message : "Abruf fehlgeschlagen"); }
        } finally { pending = false; }
      };
      void tick(); timer = setInterval(tick, 3000);
    }).catch(err => { if (alive) setReadError(String(err)); });
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [api]);

  useEffect(() => {
    let alive = true;
    void Promise.all([api.adapters(), api.projects(), api.teamList()]).then(([a, p, r]) => {
      if (alive) { setAdapters(a); setProjects(p.projects); setTeams(r); }
    }).catch(err => { if (alive) setError(err instanceof Error ? err.message : "Ziele nicht lesbar"); });
    return () => { alive = false; };
  }, [api]);

  const offline = !online || !networkAvailable;
  const refresh = async () => { const list = await api.automations(); setAutomations(list); };
  const selected = automations?.find(a => a.definition.id === selectedId) ?? null;
  const perform = async (info: AutomationInfo, action: "run" | "enable") => {
    if (offline || !navigator.onLine) return;
    setBusy(true); setError("");
    try {
      if (action === "enable") await api.automationSetEnabled(info.definition.id, !info.definition.enabled, info.definition.generation);
      else {
        const claim = await api.automationRunNow(info.definition.id, info.definition.generation);
        setSelectedId(info.definition.id);
        if (claim.state === "skipped" || claim.state === "unknown") setError(`${STATE_LABEL[claim.state]}: ${claim.reason ? REASON_LABEL[claim.reason] : claim.detail ?? "Start unklar"}`);
      }
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Operation fehlgeschlagen"); }
    finally { setBusy(false); }
  };

  return <div class="teams-pane automations-pane" data-testid="automations-pane">
    <div class="teams-list">
      <div class="teams-list-head"><h3>Automationen</h3><button type="button" class="btn" disabled={offline || busy} onClick={() => { setShowNew(value => !value); setEditing(null); }}>{showNew ? "Abbrechen" : "Neue Automation"}</button></div>
      {at && <p>Daten vom <time data-testid="automations-asof" dateTime={at}>{new Date(at).toLocaleString("de-DE")}</time></p>}
      {offline && <p role="status" data-testid="automations-offline">Offline / Host nicht erreichbar — gespeicherter Stand, Änderungen gesperrt.</p>}
      {readError && <div class="files-error" role="alert">{readError}</div>}
      {error && <div class="files-error" role="alert" data-testid="automations-error">{error}</div>}
      {(showNew || editing) && <AutomationForm key={editing?.definition.id ?? "new"} adapters={adapters.map(a => a.id)} projects={projects.map(p => p.path)} teams={teams} editing={editing} disabled={offline}
        onSaved={() => { setShowNew(false); setEditing(null); void refresh().catch(err => setError(String(err))); }} onCancel={() => { setShowNew(false); setEditing(null); }} />}
      {automations === null ? <div class="empty">{offline && readError ? "Keine gespeicherte Projektion vorhanden." : "lade…"}</div>
        : automations.length === 0 ? <div class="empty">Noch keine Automationen.</div>
        : <ul>{automations.map(info => <li key={info.definition.id}><div class={`team-row ${info.definition.id === selectedId ? "active" : ""}`}>
          <button type="button" class="automation-row-main" onClick={() => setSelectedId(info.definition.id)}>
            <span class="team-row-title">{info.definition.label}</span><span class="team-pill" data-testid="automation-state">{info.definition.enabled ? "aktiv" : "aus"}</span>
            <span class="team-row-meta">{scheduleText(info)} · Host {info.definition.hostId}</span>
            <span class="team-row-meta">nächster Termin: {info.nextOccurrences[0]?.local ?? "—"}</span>
            {info.lastOccurrence && <span class="team-row-meta">zuletzt {STATE_LABEL[info.lastOccurrence.state]} {info.lastOccurrence.reason ? REASON_LABEL[info.lastOccurrence.reason] : ""} {info.lastOccurrence.outcome ? outcomeLabel(info.lastOccurrence.outcome) : ""}</span>}
          </button>
          <div class="automation-row-actions">
            <button type="button" class="btn" disabled={busy || offline} onClick={() => void perform(info, "run")}>Jetzt starten</button>
            <button type="button" class="btn" disabled={busy || offline} onClick={() => void perform(info, "enable")}>{info.definition.enabled ? "Deaktivieren" : "Aktivieren"}</button>
            <button type="button" class="btn" disabled={busy || offline} onClick={() => { setEditing(info); setShowNew(false); }}>Bearbeiten</button>
          </div>
        </div></li>)}</ul>}
    </div>
    {selected && <AutomationDetail info={selected} offline={offline} cacheKey={cacheKey} host={host} />}
  </div>;
}
