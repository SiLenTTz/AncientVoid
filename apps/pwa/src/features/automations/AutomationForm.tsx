import { useEffect, useState } from "preact/hooks";
import type { AutomationInfo, AutomationSchedule, AutomationTarget, Team } from "@ancientvoid/contracts";
import { useApi } from "../../shared/api-context.ts";
import { sha256Hex } from "./automation-labels.ts";

const TZ_SUGGESTIONS = ["Europe/Berlin", "Europe/London", "UTC", "America/New_York"];

export function AutomationForm({ adapters, projects, teams, editing, disabled, onSaved, onCancel }: {
  adapters: string[];
  projects: string[];
  teams: Team[];
  editing: AutomationInfo | null;
  disabled: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const existing = editing?.definition ?? null;
  const target = existing?.target;
  const [targetKind, setTargetKind] = useState<"session" | "team">(target?.kind ?? "session");
  const [templateId, setTemplateId] = useState(target?.kind === "team" ? target.templateId : "");
  const [weekdays, setWeekdays] = useState<number[]>(existing?.schedule.kind === "preset" ? existing.schedule.weekdays ?? [1] : [1]);
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
    void api.fleetHello().then((h) => alive && setHostId(h.hostId)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [hostId]);

  const submit = async () => {
    setError("");
    if (disabled || !navigator.onLine) { setError("Offline — Speichern ist gesperrt."); return; }
    if (!label.trim() || (targetKind === "session" && (!harness || !project.trim() || ((!existing || target?.kind !== "session") && !promptText.trim()))) || (targetKind === "team" && !templateId)) {
      setError("Label und vollständiges Ziel sind Pflicht. Neue Sessions brauchen einen Prompt.");
      return;
    }
    if (!hostId) {
      setError("Host-ID des Hubs konnte nicht abgelesen werden — erneut versuchen.");
      return;
    }
    setBusy(true);
    try {
      const promptBlobSha256 = promptText.trim() ? await sha256Hex(promptText) : target?.kind === "session" ? target.promptBlobSha256 : "";
      const schedule: AutomationSchedule = scheduleKind === "cron"
        ? { kind: "cron", cron: cron.trim(), timezone }
        : { kind: "preset", preset, ...(preset === "hourly" ? {} : { localTime }), ...(preset === "weekly" ? { weekdays } : {}), timezone };
      const definition = {
        id: existing?.id ?? crypto.randomUUID(),
        label: label.trim(),
        generation: existing?.generation ?? 1,
        enabled: false, // Neuanfang/Zurücksetzung: die Aktivierung ist die separate Freigabe.
        hostId,
        schedule,
        target: (targetKind === "team" ? { kind: "team", templateId } : { kind: "session", harness, ...(model.trim() ? { model: model.trim() } : {}), workdir, project: project.trim(), promptBlobSha256 }) satisfies AutomationTarget,
        ...(precheckActionId.trim() ? { precheckActionId: precheckActionId.trim() } : {}),
        precheckDeadlineMs: 60_000,
        grant: { maxParallel, missedGraceMs: missedGraceMinutes * 60_000 },
        createdAtUtc: existing?.createdAtUtc ?? new Date().toISOString(),
      };
      if (existing) {
        await api.automationUpdate(existing.id, definition, targetKind === "session" && promptText.trim() ? promptText : undefined);
      } else {
        await api.automationCreate(definition, targetKind === "session" ? promptText : undefined);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form key={existing?.id ?? "new"} class="automation-form" data-testid="automation-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h4>{existing ? `„${existing.label}" bearbeiten` : "Neue Automation"}</h4>
      {error && <div class="files-error" role="alert">{error}</div>}
      <label>Label
        <input value={label} onInput={(e) => setLabel(e.currentTarget.value)} maxlength={80} placeholder="Morgen-Briefing" required />
      </label>
      <label>Zielart<select value={targetKind} onChange={e => setTargetKind(e.currentTarget.value as "session" | "team")}><option value="session">Session</option><option value="team">Agenten-Team</option></select></label>
      {targetKind === "team" ? <label>Team-Vorlage<select value={templateId} onChange={e => setTemplateId(e.currentTarget.value)} required><option value="">Vorhandenes Team wählen</option>{teams.filter(team => team.tasks.length > 0).map(team => <option key={team.id} value={team.id}>{team.title}</option>)}</select></label> : <>
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

      </div>
      </>}
        <label>Zeitzone
          <input list="automation-timezones" value={timezone} onInput={(e) => setTimezone(e.currentTarget.value)} />
        </label>
        <datalist id="automation-timezones">{TZ_SUGGESTIONS.map((tz) => <option key={tz} value={tz} />)}</datalist>
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
      {scheduleKind === "preset" && preset === "weekly" && <fieldset><legend>Wochentage</legend>{["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"].map((day, index) => <label key={day}><input type="checkbox" checked={weekdays.includes(index)} onChange={() => setWeekdays(days => days.includes(index) ? days.filter(d => d !== index) : [...days, index].sort())} />{day}</label>)}</fieldset>}
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
      {targetKind === "session" && <label>Prompt (leer lassen behält den bisherigen Auftrag)
        <textarea rows={4} value={promptText} onInput={(e) => setPromptText(e.currentTarget.value)} placeholder="Was der Lauf tun soll…" required={!existing} />
      </label>}
      <p class="team-meta">Neue und geänderte Automationen beginnen deaktiviert — die Aktivierung ist die Freigabe.</p>
      <div class="automation-form-actions">
        <button type="submit" class="btn" disabled={busy || disabled}>{existing ? "Speichern" : "Anlegen"}</button>
        <button type="button" class="btn" onClick={onCancel}>Abbrechen</button>
      </div>
    </form>
  );
}
