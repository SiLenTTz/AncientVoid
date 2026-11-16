import { useCounted } from "../../shared/useCounted.ts";
import { ContextBar } from "./ContextBar.tsx";
import type { QuotaSummary } from "./run-progress.ts";
import type { SessionTokenTotals } from "../../shared/api.ts";
import { tokenParts } from "./run-stats.ts";

const fmt = new Intl.NumberFormat("de-DE");

/**
 * EPIC-P43 T43.4: die Statuszeile ersetzt das Metrikband — nur Gemessenes (Kleinkram-Regel 1:
 * Unbekanntes schweigt hier und steht im Bericht). Tokens zählen auf ihren neuen Wert zu; der
 * Kontext steht als Balken mit den Schwellen 80/95 %, sobald Füllung und Fenster gemeldet sind.
 *
 * BUG-0184 / ADR-0084: die zwei Token-Zahlen stehen beschriftet nebeneinander — „erzeugt“, was
 * das Modell geschrieben hat, und „verarbeitet“, was seine Aufrufe bekommen haben. Ein nacktes
 * „Σ Tokens“ war die Quadratur des Kontexts und ist verboten.
 */
export function StatusLine({
  totals,
  processedFallback,
  fill,
  windowTokens,
  quota,
}: {
  /** Die Bilanz aus `GET /api/sessions/:id/tokens`, null solange sie lädt. */
  totals: SessionTokenTotals | null;
  /** `record.tokensEst` — damit „verarbeitet“ nicht fehlt, während die Bilanz lädt. */
  processedFallback: number | null;
  fill: number | null;
  windowTokens: number | null;
  quota: QuotaSummary;
}) {
  const shown = totals ?? { generated: null, processed: processedFallback, contextFill: null, cacheRead: null, usageEvents: 0, estimated: false };
  // Gezaehlt animiert nur die aussagekraeftigste vorhandene Zahl: erst „erzeugt“,
  // sonst „verarbeitet“. Die andere bleibt exakt (ADR-0084: zwei Zahlen, keine Mixtur).
  const animateGenerated = shown.generated !== null;
  const counted = useCounted(animateGenerated ? (shown.generated ?? 0) : (shown.processed ?? 0));
  const parts = tokenParts({
    generated: shown.generated === null ? null : animateGenerated ? Math.round(counted) : shown.generated,
    processed: shown.processed === null ? null : animateGenerated ? shown.processed : Math.round(counted),
    estimated: shown.estimated,
  });
  const windowKnown = fill !== null && windowTokens !== null && windowTokens > 0;
  if (windowKnown) {
    const pct = Math.round((fill / windowTokens) * 100);
    parts.push(`Kontext ${pct} % · frei ${fmt.format(Math.max(0, windowTokens - fill))} von ${fmt.format(windowTokens)}`);
  } else if (fill !== null) parts.push(`Kontext ${fmt.format(fill)} Tokens`);
  const quotaKnown = quota.level !== "none";
  if (parts.length === 0 && !quotaKnown) return null;
  const text = parts.join(" · ");
  return (
    <div class="run-meta status-line num">
      {parts.length > 0 && (
        <span class={`run-tokens ${windowKnown && fill / windowTokens >= 0.95 ? "err" : windowKnown && fill / windowTokens >= 0.8 ? "warn" : ""}`} title={text}>
          {text}
        </span>
      )}
      {windowKnown && <ContextBar fill={fill} windowTokens={windowTokens} />}
      {quotaKnown && <span class={`run-quota ${quota.level}`}>{quota.text}</span>}
    </div>
  );
}
