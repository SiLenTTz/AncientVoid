import { useEffect, useMemo, useState } from "preact/hooks";
import type { StatisticsDistribution, StatisticsReport, TurnStatistics, SessionStatistics, SessionAnomaly } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { Button, Card, EmptyState, Segmented, Select } from "../../shared/ui/index.ts";

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

function sinceOf(period: Period): string | undefined {
  if (period === "all") return undefined;
  const days = period === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function StatisticsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [project, setProject] = useState("");
  const [host, setHost] = useState("");
  const [harness, setHarness] = useState("");
  const [report, setReport] = useState<StatisticsReport | null>(null);
  const [error, setError] = useState("");

  const since = useMemo(() => sinceOf(period), [period]);

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
        <Button variant="subtle" onClick={() => exportCsv(report)}>
          CSV herunterladen
        </Button>
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
          <AnomalySection anomalies={report.anomalies} />
          <CompareSection report={report} project={project} host={host} harness={harness} periodA={period} />
        </>
      )}
    </div>
  );
}

/**
 * T56.4 (AC-P56-5): CSV-Export exakt der angezeigten Daten — clientseitig
 * aus dem geladenen Report, als Download (kein Netzwerk, keine Cloud).
 */
function exportCsv(report: StatisticsReport): void {
  const line = (cells: (string | number | null)[]) => cells.map(c => (typeof c === "string" && /[",\n]/.test(c) ? `"${c.replaceAll("\"", "\"\"")}"` : String(c ?? ""))).join(",");
  const rows: string[] = [];
  rows.push(`# EPIC-P56 Statistik-Export · Schnitt: projekt=${report.filter.project ?? "-"} host=${report.filter.hostId ?? "-"} harness=${report.filter.harness ?? "-"} seit=${report.filter.since ?? "-"} bis=${report.filter.until ?? "-"}`);
  rows.push(`# Rollup-Stand: ${report.updatedAt ?? "noch kein Lauf"}`);
  rows.push("# Sessions je Adapter/Modell");
  rows.push(line(["adapter", "modell", "sessions", "offen", "fertig", "fehler", "unterbrochen", "gestoppt", "wall_p50_ms", "wall_p90_ms", "wall_p95_ms", "wall_n", "wall_fehlend", "aktiv_p50_ms", "aktiv_p95_ms", "zuge_p50", "zuge_p95"]));
  for (const s of report.sessions) {
    rows.push(line([s.adapter, s.model, s.sessions, s.openSessions, s.endReasons.completed, s.endReasons.error, s.endReasons.interrupted, s.endReasons.stopped, s.wallMs.p50, s.wallMs.p90, s.wallMs.p95, s.wallMs.n, s.wallMs.missing, s.activeMs.p50, s.activeMs.p95, s.turnsPerSession.p50, s.turnsPerSession.p95]));
  }
  rows.push("# Züge und Tokens je Adapter/Modell");
  rows.push(line(["adapter", "modell", "zuge", "fehlgeschlagen", "dauer_p50_ms", "dauer_p95_ms", "tokens_p50", "tokens_p95", "tokens_n", "tokens_fehlend", "geschaetzte_token_zuge"]));
  for (const t of report.turns) {
    rows.push(line([t.adapter, t.model, t.turns, t.failedTurns, t.durationMs.p50, t.durationMs.p95, t.tokens.p50, t.tokens.p95, t.tokens.n, t.tokens.missing, t.estimatedTokenTurns]));
  }
  rows.push("# Gates");
  if (report.gateWait) {
    const g = report.gateWait;
    rows.push(line(["gates", "beantwortet", "abgelaufen", "offen", "sofort_erlaubt", "warte_p50_ms", "warte_p95_ms", "warte_n", "warte_fehlend"]));
    rows.push(line([g.gates, g.answered, g.timedOut, g.open, g.autoApproved, g.waitMs.p50, g.waitMs.p95, g.waitMs.n, g.waitMs.missing]));
  }
  rows.push("# Tools");
  rows.push(line(["tool", "calls", "fehler", "ok", "iserror_unbelegt", "ohne_ergebnis", "fehlerquote"]));
  for (const t of report.tools) {
    rows.push(line([t.tool, t.calls, t.failed, t.ok, t.errorStatusUnknown, t.unanswered, t.failureRate]));
  }
  rows.push("# Recovery");
  rows.push(line(["p50_ms", "p90_ms", "p95_ms", "n", "fehlend"]));
  rows.push(line([report.recovery.p50, report.recovery.p90, report.recovery.p95, report.recovery.n, report.recovery.missing]));
  if (report.team) {
    const t = report.team;
    rows.push("# Teams (nur Projekt-/Zeitraum-Schnitt)");
    rows.push(line(["teams", "aufgaben", "offen", "unbekannt", "done", "failed", "worker_ende_quote", "retry_rate"]));
    rows.push(line([t.teams, t.tasks, t.open, t.unknown, t.done, t.failed, t.workerEndRate, t.retryRate]));
  }
  rows.push("# Anomalien (über Gruppen-p95; Klein-n-Gruppen melden keine)");
  rows.push(line(["session", "adapter", "modell", "projekt", "wall_ms", "wall_p95", "zuge", "zuge_p95"]));
  for (const a of report.anomalies) {
    rows.push(line([a.sessionId, a.adapter, a.model, a.project, a.wallMs, a.wallP95, a.turns, a.turnsP95]));
  }
  const blob = new Blob([rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `statistik-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function AnomalySection({ anomalies }: { anomalies: SessionAnomaly[] }) {
  if (anomalies.length === 0) return null;
  return (
    <Card aria-label="Statistik Anomalien" role="region">
      <strong>Anomalien — Kandidaten für Runaway-Analyse</strong>
      <table>
        <thead>
          <tr>
            <th>Session</th>
            <th>Adapter · Modell</th>
            <th>Wall vs p95</th>
            <th>Züge vs p95</th>
          </tr>
        </thead>
        <tbody>
          {anomalies.map(a => (
            <tr key={a.sessionId}>
              <td><code>{a.sessionId.slice(0, 12)}…</code></td>
              <td>
                {a.adapter}
                {a.model !== null ? ` · ${a.model}` : ""}
              </td>
              <td>{a.wallMs === null || a.wallP95 === null ? "—" : `${formatMs(a.wallMs)} > ${formatMs(a.wallP95)}`}</td>
              <td>{formatCount(a.turns)} &gt; {formatCount(a.turnsP95)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Markiert ist, was über dem p95 der eigenen Adapter-/Modell-Gruppe liegt (Klein-n-Gruppen melden keine). Ein Hinweis, kein Urteil.</p>
    </Card>
  );
}

/**
 * T56.4 A/B: derselbe Schnitt (Projekt/Host/Harness) in zwei Zeiträumen
 * nebeneinander — für Plugin-An/aus- oder Modellwechsel-Betrachtung (P55).
 */
function CompareSection({ report, project, host, harness, periodA }: { report: StatisticsReport; project: string; host: string; harness: string; periodA: Period }) {
  const [periodB, setPeriodB] = useState<Period>(periodA === "all" ? "7d" : "all");
  const [other, setOther] = useState<StatisticsReport | null>(null);
  useEffect(() => {
    let alive = true;
    setOther(null);
    hubApi
      .statistics({
        ...(project ? { project } : {}),
        ...(host ? { host } : {}),
        ...(harness ? { harness } : {}),
        ...(sinceOf(periodB) ? { since: sinceOf(periodB) } : {}),
      })
      .then(r => {
        if (alive) setOther(r);
      })
      .catch(() => {
        if (alive) setOther(null);
      });
    return () => {
      alive = false;
    };
  }, [project, host, harness, periodB]);

  const byKey = (rs: SessionStatistics[]) => new Map(rs.map(s => [`${s.adapter}\u0000${s.model ?? ""}`, s]));
  const a = byKey(report.sessions);
  const b = other ? byKey(other.sessions) : new Map<string, SessionStatistics>();
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();

  return (
    <Card aria-label="Statistik Vergleich" role="region">
      <strong>Zeitraum-Vergleich (A/B)</strong>
      <Segmented label="Vergleichszeitraum B" value={periodB} options={PERIOD_OPTIONS} onChange={setPeriodB} />
      <table>
        <thead>
          <tr>
            <th>Adapter · Modell</th>
            <th>Sessions A/B</th>
            <th>Wall p50 A/B</th>
            <th>Züge/Session p50 A/B</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(key => {
            const sa = a.get(key);
            const sb = b.get(key);
            return (
              <tr key={key}>
                <td>
                  {sa?.adapter ?? sb?.adapter}
                  {(sa?.model ?? sb?.model) !== null ? ` · ${sa?.model ?? sb?.model}` : " · Modell unbelegt"}
                </td>
                <td>{formatCount(sa?.sessions ?? 0)} / {other ? formatCount(sb?.sessions ?? 0) : "…"}</td>
                <td>
                  {sa ? formatMs(sa.wallMs.p50) : "—"} / {sb ? formatMs(sb.wallMs.p50) : other ? "—" : "…"}
                </td>
                <td>
                  {sa && sa.turnsPerSession.p50 !== null ? Math.round(sa.turnsPerSession.p50).toLocaleString("de-DE") : "—"} /{" "}
                  {sb && sb.turnsPerSession.p50 !== null ? Math.round(sb.turnsPerSession.p50).toLocaleString("de-DE") : other ? "—" : "…"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>A ist der obige Zeitraum, B dieser Vergleichszeitraum — gleiche Projekt-/Host-/Harness-Wahl. Beschreibender Vergleich, kein Rang.</p>
    </Card>
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
