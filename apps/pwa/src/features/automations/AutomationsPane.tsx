import { useEffect, useState } from "preact/hooks";
import type { AutomationInfo, AutomationSchedule, AutomationTarget } from "@ancientvoid/contracts";
import { hubApi, type AdapterInfo, type AutomationHistoryEntry, type DiscoveredProject } from "../../shared/api.ts";
import { sessionHash } from "../../app/route.ts";

/**
 * EPIC-P41 T41.5 (ADR-0064): Liste/Editor/Vorschau/Run-now/Disable/Verlauf.
 * Neue Definitionen beginnen deaktiviert — die Aktivierung ist die menschliche
 * Freigabe; eine wesentliche Änderung liefert der Hub deaktiviert zurück
 * (Generation++). Runs der Orchestrierung und Sessions sind verlinkt.
 */

const STATE_LABEL: Record<string, string> = {
  claimed: "beansprucht",
  dispatched: "gestartet",
  settled: "abgerechnet",
  skipped: "übersprungen",
};

const REASON_LABEL: Record<string, string> = {
  dst_invalid: "DST-Lücke",
  missed: "verpasst",
  overlap: "Überschneidung",
  lease: "Lease belegt",
  precheck: "Precheck",
  precheck_exit: "Precheck Exit ≠ 0",
  precheck_timeout: "Precheck-Timeout",
  auth: "keine Befugnis",
  quota: "Kontingent",
  host_down: "Host nicht verfügbar",
};

function outcomeLabel(outcome: string): string {
  if (outcome === "succeeded") return "erfolgt";
  if (outcome === "failed") return "fehlgeschlagen";
  return outcome === "timeout" ? "Zeitüberschreitung" : outcome;
}

function scheduleText(info: AutomationInfo): string {
  const s = info.definition.schedule;
  if (s.kind === "preset") {
    const days = s.weekdays && s.weekdays.length > 0 ? ` Mo-So-Filter ${s.weekdays.join(",")}` : "";
    return `${s.preset}${s.localTime ? ` ${s.localTime}` : ""} (${s.timezone})${days}`;
  }
  return `${s.cron} (${s.timezone})`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function AutomationsPane() {
  const [automations, setAutomations] = useState<AutomationInfo[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<AutomationInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const list = await hubApi.automations();
        if (!alive) return;
        setAutomations(list);
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
    void hubApi.adapters().then((a) => alive && setAdapters(a)).catch(() => {});
    void hubApi.projects().then((p) => alive && setProjects(p.projects)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const selected = automations?.find((a) => a.definition.id === selectedId) ?? null;

  const refresh = async () => {
    try {
      setAutomations(await hubApi.automations());
    } catch {
      // Der nächste Poll-Tick übernimmt es.
    }
  };

  const setEnabled = async (info: AutomationInfo, enabled: boolean) => {
    setBusy(true);
    try {
      await hubApi.automationSetEnabled(info.definition.id, enabled);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Umschalten fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (info: AutomationInfo) => {
    setBusy(true);
    try {
      const claim = await hubApi.automationRunNow(info.definition.id);
      setError("");
      await refresh();
      setSelectedId(info.definition.id);
      // `dispatched` ist ein Startauftrag, kein Erfolg (ADR-0064) — der Verlauf zeigt das Ergebnis.
      if (claim.state === "skipped") setError(`Run-now übersprungen: ${REASON_LABEL[claim.reason ?? ""] ?? claim.reason ?? "unbekannt"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run-now fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="runs-pane automations-pane" data-testid="automations-pane">
      <div class="runs-list">
        <div class="runs-list-head">
          <h3>Automationen</h3>
          <button type="button" class="btn" onClick={() => { setShowNew((v) => !v); setEditing(null); }}>
            {showNew ? "Abbrechen" : "Neue Automation"}
          </button>
        </div>
        {error && <div class="files-error" role="alert" data-testid="automations-error">{error}</div>}
        {(showNew || editing) && (
          <AutomationForm
            adapters={adapters.map((a) => a.id)}
            projects={projects.map((p) => p.path)}
            editing={editing}
            onSaved={() => {
              setShowNew(false);
              setEditing(null);
              void refresh();
            }}
            onCancel={() => {
              setShowNew(false);
              setEditing(null);
            }}
          />
        )}
        {automations === null ? (
          <div class="empty">lade…</div>
        ) : automations.length === 0 ? (
          <div class="empty">Noch keine Automationen.</div>
        ) : (
          <ul>
            {automations.map((info) => (
              <li key={info.definition.id}>
                <div class={`run-row ${info.definition.id === selectedId ? "active" : ""}`}>
                  <button type="button" class="automation-row-main" onClick={() => setSelectedId(info.definition.id)}>
                    <span class="run-row-title">{info.definition.label}</span>
                    <span class={`run-pill ${info.definition.enabled ? "run-pill--ok" : ""}`} data-testid="automation-state">{info.definition.enabled ? "aktiv" : "aus"}</span>
                    <span class="run-row-meta">{scheduleText(info)} · Host {info.definition.hostId}</span>
                    <span class="run-row-meta">nächster Termin: {info.nextOccurrences[0] ? `${info.nextOccurrences[0].local} (${info.nextOccurrences[0].utc})` : "—"}</span>
                    {info.lastOccurrence && (
                      <span class="run-row-meta">
                        zuletzt {STATE_LABEL[info.lastOccurrence.state] ?? info.lastOccurrence.state}
                        {info.lastOccurrence.reason ? ` · ${REASON_LABEL[info.lastOccurrence.reason] ?? info.lastOccurrence.reason}` : ""}
                        {info.lastOccurrence.outcome ? ` · ${outcomeLabel(info.lastOccurrence.outcome)}` : ""}
                      </span>
                    )}
                  </button>
                  <div class="automation-row-actions">
                    <button type="button" class="btn" disabled={busy} onClick={() => void runNow(info)}>Jetzt starten</button>
                    <button type="button" class="btn" disabled={busy} onClick={() => void setEnabled(info, !info.definition.enabled)}>
                      {info.definition.enabled ? "Deaktivieren" : "Aktivieren"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected && <AutomationDetail info={selected} />}
    </div>
  );
}

function AutomationDetail({ info }: { info: AutomationInfo }) {
  const [history, setHistory] = useState<AutomationHistoryEntry[] | null>(null);
  const definition = info.definition;

  useEffect(() => {
    let alive = true;
    setHistory(null);
    void hubApi.automationHistory(definition.id).then((h) => alive && setHistory(h)).catch(() => alive && setHistory([]));
    return () => {
      alive = false;
    };
  }, [definition.id, definition.generation, info.lastOccurrence?.utc]);

  const target = definition.target;
  return (
    <div class="run-detail" data-testid="automation-detail">
      <div class="run-detail-head">
        <h3>{definition.label}</h3>
      </div>
      <p class="run-meta">
        Zeitplan {scheduleText(info)} · Grant maxParallel {definition.grant.maxParallel}, Nachholen {definition.grant.missedGraceMs === 0 ? "aus" : `${definition.grant.missedGraceMs} ms`} ·
        Precheck {definition.precheckActionId ?? "keiner"} (Frist {definition.precheckDeadlineMs / 1000} s) · Generation {definition.generation}
      </p>
      <p class="run-meta">
        Ziel: {target.kind === "session" ? `${target.harness}${target.model ? ` · ${target.model}` : ""} · ${target.workdir} · ${target.project}` : `Run-Vorlage ${target.templateId}`}
      </p>
      <h4>Nächste Termine</h4>
      <ul class="automation-occurrences" data-testid="automation-preview">
        {info.nextOccurrences.length === 0 ? <li class="empty">keine offenen Termine</li> : info.nextOccurrences.map((o) => (
          <li key={o.utc}>{o.local} <span class="run-blob">({o.utc})</span></li>
        ))}
      </ul>
      <h4>Verlauf</h4>
      {history === null ? (
        <div class="empty">lade…</div>
      ) : history.length === 0 ? (
        <div class="empty">Noch keine Läufe.</div>
      ) : (
        <ul class="run-tasks" data-testid="automation-history">
          {history.map((entry) => (
            <li key={entry.claimKey} class="run-task">
              <div class="run-task-head">
                <span class={`run-pill ${entry.state === "dispatched" ? "run-pill--ok" : entry.state === "skipped" ? "run-pill--warn" : ""}`}>{STATE_LABEL[entry.state] ?? entry.state}</span>
                <span class="run-task-id">{entry.occurrenceUtc}</span>
              </div>
              <div class="run-task-meta">
                {entry.reason ? `Grund: ${REASON_LABEL[entry.reason] ?? entry.reason} · ` : ""}
                {entry.outcome ? `Ergebnis: ${outcomeLabel(entry.outcome)} · ` : ""}
                {entry.sessionId && <a href={sessionHash(entry.sessionId)}>Session ↗</a>}
                {entry.runId && <> · <a href="#/runs">Run ↗</a></>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TZ_SUGGESTIONS = ["Europe/Berlin", "Europe/London", "UTC", "America/New_York"];

function AutomationForm({ adapters, projects, editing, onSaved, onCancel }: {
  adapters: string[];
  projects: string[];
  editing: AutomationInfo | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const existing = editing?.definition ?? null;
  const target = existing?.target;
  const [label, setLabel] = useState(existing?.label ?? "");
  const [harness, setHarness] = useState(target?.kind === "session" ? target.harness : "");
  const [model, setModel] = useState(target?.kind === "session" && target.model ? target.model : "");
  const [project, setProject] = useState(target?.kind === "session" ? target.project : "");
  const [workdir, setWorkdir] = useState<"worktree" | "direct">(target?.kind === "session" ? target.workdir : "worktree");
  const [scheduleKind, setScheduleKind] = useState<"preset" | "cron">(existing?.schedule.kind === "cron" ? "cron" : "preset");
  const [preset, setPreset] = useState<"hourly" | "daily" | "weekly" | "weekday">(existing?.schedule.kind === "preset" ? existing.schedule.preset : "daily");
  const [localTime, setLocalTime] = useState(existing?.schedule.kind === "preset" && existing.schedule.localTime ? existing.schedule.localTime : "09:00");
  const [cron, setCron] = useState(existing?.schedule.kind === "cron" ? existing.schedule.cron : "* * * * *");
  const [timezone, setTimezone] = useState(existing?.schedule.timezone ?? "Europe/Berlin");
  const [precheckActionId, setPrecheckActionId] = useState(existing?.precheckActionId ?? "");
  const [maxParallel, setMaxParallel] = useState(existing?.grant.maxParallel ?? 1);
  const [missedGraceMinutes, setMissedGraceMinutes] = useState(Math.round((existing?.grant.missedGraceMs ?? 0) / 60_000));
  const [promptText, setPromptText] = useState("");
  const [hostId, setHostId] = useState(existing?.hostId ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hostId) return;
    let alive = true;
    // Der Scheduler feuert nur auf dem Eigentümer-Host — deshalb den echten hostId ablesen, nicht raten.
    void hubApi.fleetHello().then((h) => alive && setHostId(h.hostId)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [hostId]);

  const submit = async () => {
    setError("");
    if (!label.trim() || !harness || !project.trim() || !promptText.trim()) {
      setError("Label, Harness, Projekt und Prompt sind Pflicht.");
      return;
    }
    if (!hostId) {
      setError("Host-ID des Hubs konnte nicht abgelesen werden — erneut versuchen.");
      return;
    }
    setBusy(true);
    try {
      const promptBlobSha256 = await sha256Hex(promptText);
      const schedule: AutomationSchedule = scheduleKind === "cron"
        ? { kind: "cron", cron: cron.trim(), timezone }
        : { kind: "preset", preset, ...(preset === "hourly" ? {} : { localTime }), timezone };
      const definition = {
        id: existing?.id ?? crypto.randomUUID(),
        label: label.trim(),
        generation: existing?.generation ?? 1,
        enabled: false, // Neuanfang/Zurücksetzung: die Aktivierung ist die separate Freigabe.
        hostId,
        schedule,
        target: { kind: "session", harness, ...(model.trim() ? { model: model.trim() } : {}), workdir, project: project.trim(), promptBlobSha256 } satisfies AutomationTarget,
        ...(precheckActionId.trim() ? { precheckActionId: precheckActionId.trim() } : {}),
        precheckDeadlineMs: 60_000,
        grant: { maxParallel, missedGraceMs: missedGraceMinutes * 60_000 },
        createdAtUtc: existing?.createdAtUtc ?? new Date().toISOString(),
      };
      if (existing) {
        await hubApi.automationUpdate(existing.id, definition, promptText);
      } else {
        await hubApi.automationCreate(definition, promptText);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="automation-form" data-testid="automation-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h4>{existing ? `„${existing.label}" bearbeiten` : "Neue Automation"}</h4>
      {error && <div class="files-error" role="alert">{error}</div>}
      <label>Label
        <input value={label} onInput={(e) => setLabel(e.currentTarget.value)} maxlength={80} placeholder="Morgen-Briefing" required />
      </label>
      <div class="form-grid">
        <label>Harness
          <input list="automation-adapters" value={harness} onInput={(e) => setHarness(e.currentTarget.value)} placeholder="dummy" required />
        </label>
        <datalist id="automation-adapters">{adapters.map((a) => <option key={a} value={a} />)}</datalist>
        <label>Modell (optional)
          <input value={model} onInput={(e) => setModel(e.currentTarget.value)} />
        </label>
      </div>
      <label>Projekt
        <input list="automation-projects" value={project} onInput={(e) => setProject(e.currentTarget.value)} placeholder="/pfad/zum/repo" required />
      </label>
      <datalist id="automation-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
      <div class="form-grid">
        <label>Arbeitsort
          <select value={workdir} onChange={(e) => setWorkdir(e.currentTarget.value as "worktree" | "direct")}>
            <option value="worktree">Worktree (Standard)</option>
            <option value="direct">direct-Checkout (P38-Lease)</option>
          </select>
        </label>
        <label>Zeitzone
          <input list="automation-timezones" value={timezone} onInput={(e) => setTimezone(e.currentTarget.value)} />
        </label>
        <datalist id="automation-timezones">{TZ_SUGGESTIONS.map((tz) => <option key={tz} value={tz} />)}</datalist>
      </div>
      <fieldset>
        <legend>Zeitplan</legend>
        <div class="form-grid">
          <label>Art
            <select value={scheduleKind} onChange={(e) => setScheduleKind(e.currentTarget.value as "preset" | "cron")}>
              <option value="preset">Preset</option>
              <option value="cron">Cron (5 Felder)</option>
            </select>
          </label>
          {scheduleKind === "preset" ? (
            <>
              <label>Preset
                <select value={preset} onChange={(e) => setPreset(e.currentTarget.value as "hourly" | "daily" | "weekly" | "weekday")}>
                  <option value="hourly">stündlich</option>
                  <option value="daily">täglich</option>
                  <option value="weekly">wöchentlich</option>
                  <option value="weekday">werktags</option>
                </select>
              </label>
              {preset !== "hourly" && (
                <label>Uhrzeit (Ortszeit)
                  <input type="time" value={localTime} onInput={(e) => setLocalTime(e.currentTarget.value)} />
                </label>
              )}
            </>
          ) : (
            <label>Cron (min Std Tag Monat WT)
              <input value={cron} onInput={(e) => setCron(e.currentTarget.value)} placeholder="*/15 9-17 * * 1-5" />
            </label>
          )}
        </div>
      </fieldset>
      <div class="form-grid">
        <label>Precheck-Aktion (optional, registriert)
          <input value={precheckActionId} onInput={(e) => setPrecheckActionId(e.currentTarget.value)} placeholder="git-status" />
        </label>
        <label>max. parallel
          <input type="number" min={1} max={4} value={maxParallel} onInput={(e) => setMaxParallel(Number(e.currentTarget.value) || 1)} />
        </label>
        <label>Nachholfenster (Minuten)
          <input type="number" min={0} max={1440} value={missedGraceMinutes} onInput={(e) => setMissedGraceMinutes(Number(e.currentTarget.value) || 0)} />
        </label>
      </div>
      <label>Prompt (wird als Blob gespeichert; Änderung erzeugt neue Generation)
        <textarea rows={4} value={promptText} onInput={(e) => setPromptText(e.currentTarget.value)} placeholder="Was der Lauf tun soll…" required />
      </label>
      <p class="run-meta">Neue und geänderte Automationen beginnen deaktiviert — die Aktivierung ist die Freigabe.</p>
      <div class="automation-form-actions">
        <button type="submit" class="btn" disabled={busy}>{existing ? "Speichern" : "Anlegen"}</button>
        <button type="button" class="btn" onClick={onCancel}>Abbrechen</button>
      </div>
    </form>
  );
}
