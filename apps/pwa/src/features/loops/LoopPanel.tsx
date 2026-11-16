import { useEffect, useState } from "preact/hooks";
import type { LoopInfo } from "@ancientvoid/contracts";
import type { hubApi } from "../../shared/api.ts";
import type { LoopView } from "./loop-view.ts";
import { loopBadge } from "./loop-view.ts";

const GATE_STATE: Record<string, string> = { running: "läuft", passed: "bestanden", pass: "bestanden", failed: "fehlgeschlagen", fail: "fehlgeschlagen" };

/** Kopf-Abzeichen der Session: Loop, Name, Betriebsart — Störung und Halt fallen sofort auf. */
export function LoopBadge({ adapter, view }: { adapter: string; view: LoopView }) {
  const badge = loopBadge(adapter, view);
  return <span class={`loop-badge ${badge.tone}`}>{badge.text}</span>;
}

/**
 * EPIC-P19 T19.6: das Loop-Panel einer Session. Zeigt nur, was der Loop gemeldet hat (Fortschritt, Gate, Halt,
 * Störungen, Bericht), und bietet nur die Befehle an, die der Connector kann. Eine Betriebsart mit Außenwirkung
 * wird vor dem Wechsel bestätigt.
 */
export function LoopPanel({
  sessionId,
  adapter,
  view,
  disabled,
  api,
  onError,
  factory,
  hostId,
}: {
  sessionId: string;
  adapter: string;
  view: LoopView;
  disabled: boolean;
  api: Pick<typeof hubApi, "loops" | "steer" | "session" | "factoryCommand">;
  onError: (message: string) => void;
  /** EPIC-P26: Verknüpfung dieser Session mit dem Factory-Treiber, aus `factory.linkage` gelesen. */
  factory?: { role: string; partner: string } | null;
  hostId?: string | null;
}) {
  const loopId = adapter.replace(/^loop:/, "");
  const [info, setInfo] = useState<LoopInfo | null>(null);
  useEffect(() => {
    let live = true;
    api
      .loops()
      .then((all) => live && setInfo(all.find((l) => l.id === loopId) ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, loopId]);

  const caps = info?.capabilities ?? null;
  // Treiber-Status wird gelesen, nicht geraten: endet nur der Treiber, darf der Beobachter nicht „läuft“ zeigen.
  const driverId = factory?.role === "observer" ? factory.partner : null;
  const [driverStatus, setDriverStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!driverId) return;
    let live = true;
    const read = () => api.session(driverId).then((r) => live && setDriverStatus(r.status)).catch(() => live && setDriverStatus(null));
    void read();
    const timer = setInterval(() => void read(), 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, driverId]);
  const driverEnded = driverStatus !== null && ["stopped", "error", "interrupted"].includes(driverStatus);
  const [modus, setModus] = useState<"a" | "b">("b");
  const [provider, setProvider] = useState<"anthropic" | "zai">("anthropic");
  const [busy, setBusy] = useState(false);
  const command = async (body: Parameters<typeof api.factoryCommand>[1], question?: string) => {
    if (question && !confirm(question)) return;
    setBusy(true);
    const ack = await api.factoryCommand(sessionId, body);
    setBusy(false);
    if (!ack.ok) onError(ack.detail ?? "Der Befehl wurde abgelehnt.");
  };
  const send = async (input: Parameters<typeof api.steer>[1]) => {
    try {
      const ack = await api.steer(sessionId, input);
      if (!ack.ok) onError(ack.detail ?? "Der Loop hat den Befehl abgelehnt.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Befehl fehlgeschlagen.");
    }
  };
  const changeMode = (mode: string) => {
    if (caps?.riskyModes.includes(mode) && !confirm(`Betriebsart „${mode}“ hat Außenwirkung (z. B. Merge ohne Mensch). Wirklich wechseln?`)) return;
    void send({ kind: "configure", permissionMode: mode });
  };

  const p = view.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <section class="loop-panel" aria-label="Loop">
      <div class="loop-head">
        <LoopBadge adapter={adapter} view={view} />
        {view.line && <span class="dim">Linie {view.line}</span>}
        {view.activity && <span class="dim">{view.activity}</span>}
      </div>
      {view.broken.length > 0 && (
        <div class="loop-alert bad" role="alert">
          Loop gestört: {view.broken.join(" · ")}
        </div>
      )}
      {view.hold && (
        <div class="loop-alert warn" role="status">
          Der Loop wartet auf eine Person: {view.hold}
        </div>
      )}
      {factory && (
        <div class="loop-factory" aria-label="Factory-Projekt">
          <div>
            Verknüpfung:{" "}
            {driverId ? (
              <>
                Treiber{" "}
                <a href={`#/${hostId ? `hosts/${encodeURIComponent(hostId)}/` : ""}sessions/${encodeURIComponent(driverId)}`}>öffnen</a>
                {" · "}
                <span class={driverEnded ? "gate-failed" : "gate-passed"}>{driverStatus === null ? "Status unbekannt" : driverEnded ? "Treiber beendet" : "Treiber läuft"}</span>
              </>
            ) : (
              "Treiber-Session"
            )}
          </div>
          {driverEnded && (
            <div class="loop-alert warn" role="status">
              Der Treiber ist beendet — der Lauf geht nicht weiter. Der Fortschritt unten ist der letzte gemeldete Stand, kein „fertig“.
            </div>
          )}
          <div>
            Intake:{" "}
            {view.intake ? (
              <>
                {view.intake.status ?? "unbekannt"} · {view.intake.ready ? "ausführungsbereit" : "noch nicht ausführungsbereit"}
                {view.intake.next ? ` · nächste Aktion: ${view.intake.next}` : ""}
              </>
            ) : (
              "noch nicht gemeldet"
            )}
          </div>
          {view.lauf && (
            <div>
              Lauf: {view.lauf.task ?? "?"} · Phase {view.lauf.phase ?? "?"}
            </div>
          )}
          <div class="loop-controls">
            <button class="btn" type="button" disabled={busy} onClick={() => void command({ command: "resume" })}>
              Fortsetzen
            </button>
            <button class="btn" type="button" disabled={busy} onClick={() => void command({ command: "end_run" }, "Lauf beenden? Treiber und Beobachter werden gestoppt.")}>
              Lauf beenden
            </button>
            <label>
              Betriebsart
              <select aria-label="Betriebsart der Factory" value={modus} onChange={(e) => setModus((e.target as HTMLSelectElement).value as "a" | "b")}>
                <option value="b">b</option>
                <option value="a">a — merged automatisch (Außenwirkung)</option>
              </select>
            </label>
            <label>
              Provider
              <select aria-label="Provider der Factory" value={provider} onChange={(e) => setProvider((e.target as HTMLSelectElement).value as "anthropic" | "zai")}>
                <option value="anthropic">Anthropic</option>
                <option value="zai">Z.ai</option>
              </select>
            </label>
            <button
              class="btn"
              type="button"
              disabled={busy}
              onClick={() =>
                void command(
                  { command: "set_mode", modus, provider, ...(modus === "a" ? { confirm: true } : {}) },
                  modus === "a" ? "Betriebsart „a“ merged automatisch, ohne dass ein Mensch freigibt. Wirklich wechseln?" : undefined,
                )
              }
            >
              Betriebsart setzen
            </button>
          </div>
        </div>
      )}
      {p && (
        <div class="loop-progress">
          <div class="loop-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Fortschritt des Loops">
            <div style={`width: ${pct}%`} />
          </div>
          <span>
            {p.done} von {p.total} Aufgaben
            {p.phase ? ` · ${p.phase}` : ""}
            {p.step ? ` · ${p.step}` : ""}
            {p.source === "hermes" ? " (Hermes)" : ""}
          </span>
        </div>
      )}
      {view.gate && (
        <div class="loop-gate">
          Gate <strong>{view.gate.name}</strong>: <span class={`gate-${view.gate.state === "pass" ? "passed" : view.gate.state === "fail" ? "failed" : view.gate.state}`}>{GATE_STATE[view.gate.state] ?? view.gate.state}</span>
        </div>
      )}
      {view.orchestrator && Object.keys(view.orchestrator.userGates).length > 0 && (
        <div class="loop-gate">
          Freigaben des Orchestrators:{" "}
          {Object.entries(view.orchestrator.userGates).map(([k, ok]) => `${k} ${ok ? "ja" : "nein"}`).join(" · ")}
          {view.orchestrator.note && <div class="dim">{view.orchestrator.note}</div>}
        </div>
      )}
      {view.stats && (
        <div class="dim">
          {view.stats.completed} Features fertig · {view.stats.inProgress} in Arbeit
        </div>
      )}
      {view.notices.length > 0 && (
        <ul class="loop-notices">
          {view.notices.map((n, i) => (
            <li key={i}>
              Eskalation {n.level}: {n.reason}
              {n.fundstelle ? ` (${n.fundstelle})` : ""}
            </li>
          ))}
        </ul>
      )}
      {view.report && (
        <details class="loop-report">
          <summary>
            Tagesbericht
            {Object.keys(view.report.counts).length > 0 ? ` (${Object.entries(view.report.counts).map(([k, n]) => `${k} ${n}`).join(", ")})` : ""}
          </summary>
          {view.report.text ? <pre>{view.report.text}</pre> : <p class="dim">Der volle Text liegt als Blob im Verlauf.</p>}
        </details>
      )}
      {caps && caps.controls.length > 0 && (
        <div class="loop-controls">
          {caps.controls.includes("pause") && caps.controls.includes("resume") && (
            <button class="btn" type="button" disabled={disabled} onClick={() => void send({ kind: view.paused ? "resume" : "park" })}>
              {view.paused ? "Weiter" : "Pausieren"}
            </button>
          )}
          {caps.controls.includes("setMode") && caps.modes.length > 0 && (
            <label>
              Betriebsart
              <select aria-label="Betriebsart des Loops" disabled={disabled} value={view.mode ?? ""} onChange={(e) => changeMode((e.target as HTMLSelectElement).value)}>
                {view.mode === null && <option value="">unbekannt</option>}
                {caps.modes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                    {caps.riskyModes.includes(m) ? " (Außenwirkung)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </section>
  );
}
