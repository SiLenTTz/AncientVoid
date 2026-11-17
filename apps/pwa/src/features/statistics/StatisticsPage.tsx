import { useEffect, useMemo, useState } from "preact/hooks";
import type { StatisticsDistribution, StatisticsReport, TurnStatistics, SessionStatistics } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { Card, EmptyState, Segmented, Select } from "../../shared/ui/index.ts";

/**
 * EPIC-P56 T56.3: Statistik-Seite — konsolidierte Kennzahlen aus dem
 * Rollup-Cache (ADR-0079). Beschreibend, kein Modell-Ranking: „Korrelation
 * ist nicht Kausalität" steht bewusst daneben. Jede Verteilung zeigt
 * p50/p90/p95 + n; Klein-n ist gekennzeichnet, Fehlendes bleibt sichtbar
 * (nie 0). Input-/Output-Token und EUR fehlen bis auf weiteres als
 * unbelegt (docs/statistik-metriken.md).
 */

type Period = "all" | "7d" | "30d";

function formatMs(ms: number | null): string {
  if (ms === null) return "unbekannt";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}:${String(sec).padStart(2, "0")} min`;
}

function formatCount(n: number): string {
  return n.toLocaleString("de-DE");
}

/** p50/p90/p95 mit n und fehlenden Werten — Klein-n immer dazuschreiben (AC-P56-3). */
function Distribution({ d, unit }: { d: StatisticsDistribution; unit: string }) {
  const parts = [
    `p50 ${d.p50 === null ? "—" : formatMs(d.p50)}`,
    `p90 ${d.p90 === null ? "—" : formatMs(d.p90)}`,
    `p95 ${d.p95 === null ? "—" : formatMs(d.p95)}`,
  ].join(" · ");
  return (
    <span class="stat-dist">
      {unit === "ms" ? parts : `${d.p50 === null ? "—" : formatCount(d.p50)} (p50)`}
      <small>
        {" "}n {formatCount(d.n)}
        {d.missing > 0 ? `, ${formatCount(d.missing)} fehlend` : ""}
        {d.smallSample ? ", wenige Daten" : ""}
      </small>
    </span>
  );
}

function ratio(part: number, total: number): string {
  return total === 0 ? "—" : `${Math.round((part / total) * 100)} %`;
}

const PERIOD_OPTIONS: readonly { value: Period; label: string }[] = [
  { value: "all", label: "Alles" },
  { value: "7d", label: "Woche" },
  { value: "30d", label: "Monat" },
];

export function StatisticsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [project, setProject] = useState("");
  const [host, setHost] = useState("");
  const [harness, setHarness] = useState("");
  const [report, setReport] = useState<StatisticsReport | null>(null);
  const [error, setError] = useState("");

  const since = useMemo(() => {
    if (period === "all") return undefined;
    const days = period === "7d" ? 7 : 30;
    return new Date(Date.now() - days * 86_400_000).toISOString();
  }, [period]);

  useEffect(() => {
    let alive = true;
    setReport(null);
    hubApi
      .statistics({
        ...(project ? { project } : {}),
        ...(host ? { host } : {}),
        ...(harness ? { harness } : {}),
        ...(since ? { since } : {}),
      })
      .then(r => {
        if (alive) {
          setReport(r);
          setError("");
        }
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : "Statistik nicht erreichbar");
      });
    return () => {
      alive = false;
    };
  }, [project, host, harness, since]);

  if (error) return <EmptyState text={`Statistik nicht erreichbar — ${error}`} />;
  if (!report) return <EmptyState text="lädt …" />;
  const filtered = project !== "" || host !== "" || harness !== "" || period !== "all";

  return (
    <div class="status-page" aria-label="Statistik">
      <Card aria-label="Statistik Schnitt" role="region">
        <Segmented label="Zeitraum" value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
        <div class="stat-filters">
          <Select
            label="Projekt"
            value={project}
            onChange={setProject}
            disabled={report.slices.projects.length === 0}
            options={[{ value: "", label: "alle Projekte" }, ...report.slices.projects.map(p => ({ value: p, label: p.split("/").filter(Boolean).pop() ?? p }))]}
          />
          <Select
            label="Host"
            value={host}
            onChange={setHost}
            disabled={report.slices.hosts.length === 0}
            options={[{ value: "", label: "alle Hosts" }, ...report.slices.hosts.map(h => ({ value: h, label: h }))]}
          />
          <Select
            label="Harness"
            value={harness}
            onChange={setHarness}
            disabled={report.slices.harnesses.length === 0}
            options={[{ value: "", label: "alle Harness" }, ...report.slices.harnesses.map(h => ({ value: h, label: h }))]}
          />
        </div>
        <p>
          Rollup-Stand: {report.updatedAt === null ? "noch kein Lauf" : new Date(report.updatedAt).toLocaleString("de-DE")} · Zahlen beschreiben, sie empfehlen kein Modell.
        </p>
      </Card>

      {report.sessions.length === 0 && report.team === null ? (
        <EmptyState text={filtered ? "Keine Session in diesem Schnitt — der Schnitt ist echt leer, nicht kaputt." : "Noch keine Session ausgewertet — der Rollup läuft mit dem ersten Abruf."} />
      ) : (
        <>
          <SessionSection sessions={report.sessions} />
          <TurnSection turns={report.turns} />
          <GateSection report={report} />
          <ToolSection report={report} />
          <TeamSection report={report} filtered={filtered} />
        </>
      )}
    </div>
  );
}

function SessionSection({ sessions }: { sessions: SessionStatistics[] }) {
  if (sessions.length === 0) return null;
  return (
    <Card aria-label="Statistik Sessions" role="region">
      <strong>Sessions je Adapter und Modell</strong>
      <table>
        <thead>
          <tr>
            <th>Adapter · Modell</th>
            <th>Sessions</th>
            <th>Ende</th>
            <th>Wallzeit</th>
            <th>Aktiv</th>
            <th>Züge/Session</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map(s => (
            <tr key={`${s.adapter}\u0000${s.model ?? ""}`}>
              <td>
                {s.adapter}
                {s.model !== null ? ` · ${s.model}` : " · Modell unbelegt"}
              </td>
              <td>{formatCount(s.sessions)}{s.openSessions > 0 ? ` (${formatCount(s.openSessions)} offen)` : ""}</td>
              <td>
                {s.endReasons.completed > 0 && `fertig ${formatCount(s.endReasons.completed)}`}
                {s.endReasons.error > 0 && `, Fehler ${formatCount(s.endReasons.error)}`}
                {s.endReasons.interrupted > 0 && `, unterbrochen ${formatCount(s.endReasons.interrupted)}`}
                {s.endReasons.stopped > 0 && `, gestoppt ${formatCount(s.endReasons.stopped)}`}
                {s.openSessions > 0 && `, Grund offen ${formatCount(s.openSessions)}`}
              </td>
              <td><Distribution d={s.wallMs} unit="ms" /></td>
              <td><Distribution d={s.activeMs} unit="ms" /></td>
              <td><Distribution d={s.turnsPerSession} unit="ms" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function TurnSection({ turns }: { turns: TurnStatistics[] }) {
  if (turns.length === 0) return null;
  return (
    <Card aria-label="Statistik Züge und Tokens" role="region">
      <strong>Züge und Tokens je Adapter und Modell</strong>
      <table>
        <thead>
          <tr>
            <th>Adapter · Modell</th>
            <th>Züge</th>
            <th>Zugdauer</th>
            <th>Tokens/Zug</th>
          </tr>
        </thead>
        <tbody>
          {turns.map(t => (
            <tr key={`${t.adapter}\u0000${t.model ?? ""}`}>
              <td>
                {t.adapter}
                {t.model !== null ? ` · ${t.model}` : " · Modell unbelegt"}
              </td>
              <td>
                {formatCount(t.turns)}
                {t.failedTurns > 0 ? `, ${formatCount(t.failedTurns)} fehlgeschlagen` : ""}
                {t.estimatedTokenTurns > 0 ? `, ${formatCount(t.estimatedTokenTurns)} geschätzt` : ""}
              </td>
              <td><Distribution d={t.durationMs} unit="ms" /></td>
              <td><Distribution d={t.tokens} unit="tokens" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Input-/Output- und Cache-Token sind über die Provider nicht kanonisch belegt — sie bleiben unbekannt, statt geraten.</p>
    </Card>
  );
}

function GateSection({ report }: { report: StatisticsReport }) {
  const g = report.gateWait;
  if (g === null) return null;
  return (
    <Card aria-label="Statistik Freigaben" role="region">
      <strong>Freigabe-Wartezeiten</strong>
      <table>
        <tbody>
          <tr><th scope="row">Gates</th><td>{formatCount(g.gates)}</td></tr>
          <tr><th scope="row">Antworten</th><td>{formatCount(g.answered)} ({ratio(g.answered, g.gates)})</td></tr>
          <tr><th scope="row">Abgelaufen</th><td>{formatCount(g.timedOut)}</td></tr>
          <tr><th scope="row">Offen ohne Antwort</th><td>{formatCount(g.open)}</td></tr>
          <tr><th scope="row">Sofort erlaubt</th><td>{formatCount(g.autoApproved)}</td></tr>
          <tr><th scope="row">Wartezeit</th><td><Distribution d={g.waitMs} unit="ms" /></td></tr>
        </tbody>
      </table>
      <p>Wartezeit trennt „Agent langsam" von „Mensch langsam" (nur beantwortete und abgelaufene Gates).</p>
    </Card>
  );
}

function ToolSection({ report }: { report: StatisticsReport }) {
  if (report.tools.length === 0) return null;
  return (
    <Card aria-label="Statistik Tools" role="region">
      <strong>Tool-Aufrufe</strong>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Calls</th>
            <th>Fehler / belegte Ergebnisse</th>
            <th>Ohne Ergebnis</th>
          </tr>
        </thead>
        <tbody>
          {report.tools.map(t => (
            <tr key={t.tool ?? ""}>
              <td>{t.tool ?? "Name unbelegt"}</td>
              <td>{formatCount(t.calls)}</td>
              <td>
                {t.failureRate === null ? "—" : `${Math.round(t.failureRate * 100)} %`}
                <small> ({formatCount(t.failed + t.ok)} belegt, {formatCount(t.errorStatusUnknown)} unbekannt)</small>
              </td>
              <td>{formatCount(t.unanswered)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Hohe Quote je Modell heißt nicht kaputtes Tool — beide Schnitte zusammen lesen.</p>
    </Card>
  );
}

function TeamSection({ report, filtered }: { report: StatisticsReport; filtered: boolean }) {
  const t = report.team;
  if (t === null) return null;
  return (
    <Card aria-label="Statistik Teams" role="region">
      <strong>Team-Aufgaben</strong>
      <table>
        <tbody>
          <tr><th scope="row">Teams · Aufgaben</th><td>{formatCount(t.teams)} · {formatCount(t.tasks)}</td></tr>
          <tr><th scope="row">Enden</th><td>done {formatCount(t.done)}, failed {formatCount(t.failed)}, offen {formatCount(t.open)}, unbekannt {formatCount(t.unknown)}</td></tr>
          <tr><th scope="row">Worker-Ende-Quote</th><td>{t.workerEndRate === null ? "—" : `${Math.round(t.workerEndRate * 100)} %`}</td></tr>
          <tr><th scope="row">Retry-Rate</th><td>{t.retryRate === null ? "—" : `${Math.round(t.retryRate * 100)} %`}</td></tr>
        </tbody>
      </table>
      <p>done ist worker_done, kein bestandenes Gate (P40). Team-Zahlen folgen dem Projekt- und Zeitschnitt{filtered ? "" : " (hier ungeschnitten)"}, aber keinem Host- oder Harness-Schnitt.</p>
    </Card>
  );
}
