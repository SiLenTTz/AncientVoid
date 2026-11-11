import { useEffect, useState } from "preact/hooks";
import type { AutomationHistoryEntry, AutomationInfo, OrchestrationRunStart } from "@ancientvoid/contracts";
import { useApi } from "../../shared/api-context.ts";
import { sessionHash } from "../../app/route.ts";
import { remoteHost } from "../../shared/api.ts";
import { outcomeLabel, REASON_LABEL, scheduleText, STATE_LABEL } from "./automation-labels.ts";
import { readAutomationSnapshot, writeAutomationSnapshot } from "./automation-cache.ts";

export function AutomationDetail({ info, offline, cacheKey, host }: { info: AutomationInfo; offline: boolean; cacheKey: string; host: string | null }) {
  const api = useApi();
  const [history, setHistory] = useState<AutomationHistoryEntry[] | null>(null);
  const [error, setError] = useState("");
  const definition = info.definition;
  const [template, setTemplate] = useState<OrchestrationRunStart | null>(null);
  const [templateError, setTemplateError] = useState("");
  useEffect(() => {
    let alive = true; setTemplate(null); setTemplateError("");
    if (definition.target.kind === "run" && !offline) void api.automationTemplate(definition.id).then(value => { if (alive) setTemplate(value); }).catch(err => { if (alive) setTemplateError(String(err)); });
    return () => { alive = false; };
  }, [api, definition.id, definition.generation, offline]);
  useEffect(() => {
    let alive = true;
    const cached = cacheKey ? readAutomationSnapshot(cacheKey)?.histories.find(h => h.id === definition.id) : undefined;
    setHistory(cached?.entries ?? null); setError("");
    if (offline) { if (!cached) setError("Für diesen Plan ist kein Offline-Verlauf gespeichert."); return; }
    void api.automationHistory(definition.id).then(entries => {
      if (!alive) return;
      setHistory(entries);
      const snapshot = readAutomationSnapshot(cacheKey);
      if (snapshot) writeAutomationSnapshot(cacheKey, { ...snapshot, histories: [...snapshot.histories.filter(h => h.id !== definition.id), { id: definition.id, at: new Date().toISOString(), entries: entries.slice(0, 100) }] });
    }).catch(err => { if (alive) setError(err instanceof Error ? err.message : "Verlauf nicht lesbar"); });
    return () => { alive = false; };
  }, [api, definition.id, definition.generation, info.lastOccurrence?.utc, info.lastOccurrence?.state, info.lastOccurrence?.outcome, offline, cacheKey]);
  const target = definition.target;
  return <div class="run-detail" data-testid="automation-detail">
    <h3>{definition.label}</h3>
    <p class="run-meta">Zeitplan {scheduleText(info)} · Maximal parallel: {definition.grant.maxParallel} · Nachholfenster: {definition.grant.missedGraceMs / 60_000} Minuten · Freigabeversion: {definition.generation}</p>
    <p class="run-meta">Vorprüfung: {definition.precheckActionId ?? "keine"} (Frist {definition.precheckDeadlineMs / 1000} s)</p>
    <p class="run-meta">Ziel: {target.kind === "session" ? `${target.harness}${target.model ? ` · ${target.model}` : ""} · ${target.workdir} · ${target.project}` : `Run-Vorlage ${target.templateId}`}</p>
    {templateError && <p role="alert">{templateError}</p>}
    {template && <div><p>Eingefrorener Rahmen: {template.project} · Worker: {template.frame.adapters.join(", ")} · höchstens {template.frame.maxParallel} parallel</p>{template.plan?.tasks.map(task => <details key={task.id}><summary>{task.title} · {task.adapter}{task.model ? ` · ${task.model}` : ""}</summary><pre>{task.prompt}</pre></details>)}</div>}
    {offline && target.kind === "run" && <p>Der vollständige Run-Rahmen ist online über die eingefrorene Vorlage abrufbar.</p>}
    <h4>Nächste Termine</h4>
    <ul class="automation-occurrences" data-testid="automation-preview">{info.nextOccurrences.map(o => <li key={o.utc}>{o.local} ({o.utc})</li>)}</ul>
    {info.nextOccurrences.length === 0 && <p>Kein Termin im unterstützten Kalenderhorizont.</p>}
    <h4>Verlauf</h4>
    {error && <div class="files-error" role="alert">{error}</div>}
    {offline && history && <p>Gespeicherter Verlauf (höchstens 100 Einträge).</p>}
    {!history && !error && <div class="empty">lade…</div>}
    {history?.length === 0 && !error && <div class="empty">Noch keine Läufe.</div>}
    {!!history?.length && <ul class="run-tasks" data-testid="automation-history">{history.map(entry => <li key={entry.claimKey} class="run-task">
      <div class="run-task-head"><span class="run-pill">{STATE_LABEL[entry.state] ?? entry.state}</span><span>{entry.occurrenceUtc}</span></div>
      <div class="run-task-meta">
        {entry.reason && <>Grund: {REASON_LABEL[entry.reason] ?? entry.reason} · </>}
        {entry.outcome && <>Ergebnis: {outcomeLabel(entry.outcome)} · </>}
        {entry.detail && <p>{entry.detail}</p>}
        {entry.missedThroughUtc && <p>Verpasste Termine bis {entry.missedThroughUtc}</p>}
        {entry.sessionId && <a href={sessionHash(entry.sessionId, remoteHost(host))}>Session ↗</a>}
        {entry.runId && <a href={`#/runs?run=${encodeURIComponent(entry.runId)}${host ? `&host=${encodeURIComponent(host)}` : ""}`}>Run ↗</a>}
      </div>
    </li>)}</ul>}
  </div>;
}
