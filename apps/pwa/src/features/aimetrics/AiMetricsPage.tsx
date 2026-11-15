import { useEffect, useState } from "preact/hooks";
import type { AiMetricsReport, AiMetricsSourceReport } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";

/**
 * EPIC-P59 (ADR-0078): Metrik-Seite — Auslastung des lokalen KI-Servers.
 * Zeigt nur was der Hub gemessen meldet; jede Zahl trägt Quelle und Alter
 * (ADR-0023). Offline bleiben die letzten Daten plus Zeitstempel stehen,
 * kein Whiteout (K10). Der Poll folgt dem Intervall des Reports.
 */

const REFRESH_FALLBACK_MS = 10_000;

export function formatMetric(value: number | null, unit: string): string {
  if (value === null) return "nicht gemeldet";
  const rounded = Math.abs(value) >= 1000 || Number.isInteger(value) ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("de-DE")} ${unit}`;
}

export function formatAge(ts: string | null, nowMs: number = Date.now()): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.round((nowMs - Date.parse(ts)) / 1000));
  if (sec < 60) return `vor ${sec} s`;
  if (sec < 3600) return `vor ${Math.floor(sec / 60)} min`;
  return `vor ${Math.floor(sec / 3600)} h`;
}

export function AiMetricsPage() {
  const [report, setReport] = useState<AiMetricsReport | null>(null);
  const [stale, setStale] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      timer = setTimeout(poll, ms);
    };
    const poll = async () => {
      try {
        const res = await hubApi.aimetrics();
        if (!alive) return;
        setReport(res);
        setStale(false);
        schedule(Math.max(2, res.intervalSec) * 1000);
      } catch {
        if (!alive) return;
        setStale(true);
        schedule(REFRESH_FALLBACK_MS);
      }
      if (alive) setTick((t) => t + 1);
    };
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!report) return <div class="empty">{stale ? "keine Daten — der Hub meldet nicht" : "lädt …"}</div>;
  if (report.sources.length === 0) return <div class="empty">Keine Quellen konfiguriert — der Hub beprobt nur Konfiguriertes (aiMetrics).</div>;
  return (
    <div class="status-page aimetrics-page">
      {stale && <p class="aimetrics-stale" role="status">Keine frischen Daten — letzte bekannte Werte.</p>}
      {report.sources.map((source) => (
        <SourceCard key={source.id} source={source} />
      ))}
    </div>
  );
}

function SourceCard({ source }: { source: AiMetricsSourceReport }) {
  return (
    <section class="card" aria-label={`Metrik-Quelle ${source.label}`}>
      <strong>{source.label}</strong>
      {source.url && <> · <code>{source.url}</code></>}
      {!source.status.ok && <p class="aimetrics-error" role="status">Probe fehlgeschlagen: {source.status.error}</p>}
      <table>
        <thead>
          <tr><th>Feld</th><th>Wert</th><th>p50 / p95</th><th>Quelle</th><th>Alter</th></tr>
        </thead>
        <tbody>
          {source.fields.map((field) => (
            <tr key={field.key}>
              <td>{field.label}</td>
              <td>{formatMetric(field.value, field.unit)}</td>
              <td>{field.window ? `${formatMetric(field.window.p50, field.unit)} / ${formatMetric(field.window.p95, field.unit)} (${field.window.samples})` : "—"}</td>
              <td>{field.source}</td>
              <td>{formatAge(field.ts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
