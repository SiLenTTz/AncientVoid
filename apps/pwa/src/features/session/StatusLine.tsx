import { useCounted } from "../../shared/useCounted.ts";
import { ContextBar } from "./ContextBar.tsx";
import type { QuotaSummary } from "./run-progress.ts";

const fmt = new Intl.NumberFormat("de-DE");

/**
 * EPIC-P43 T43.4: die Statuszeile ersetzt das Metrikband — nur Gemessenes (Kleinkram-Regel 1:
 * Unbekanntes schweigt hier und steht im Bericht). Tokens zählen auf ihren neuen Wert zu; der
 * Kontext steht als Balken mit den Schwellen 80/95 %, sobald Füllung und Fenster gemeldet sind.
 */
export function StatusLine({
  tokens,
  fill,
  windowTokens,
  quota,
}: {
  /** Gemeldete Token-Summe der Session, null = niemand hat gezählt. */
  tokens: number | null;
  fill: number | null;
  windowTokens: number | null;
  quota: QuotaSummary;
}) {
  const shownTokens = useCounted(tokens ?? 0);
  const windowKnown = fill !== null && windowTokens !== null && windowTokens > 0;
  const parts: string[] = [];
  if (tokens !== null) parts.push(`Σ ${fmt.format(Math.round(shownTokens))} Tokens`);
  if (windowKnown) {
    const pct = Math.round((fill / windowTokens) * 100);
    parts.push(`Kontext ${pct} % · frei ${fmt.format(Math.max(0, windowTokens - fill))} von ${fmt.format(windowTokens)}`);
  } else if (fill !== null) parts.push(`Kontext ${fmt.format(fill)} Tokens`);
  const quotaKnown = quota.level !== "none";
  if (parts.length === 0 && !quotaKnown) return null;
  return (
    <div class="run-meta status-line num">
      {parts.length > 0 && <span class={`run-tokens ${windowKnown && fill / windowTokens >= 0.95 ? "err" : windowKnown && fill / windowTokens >= 0.8 ? "warn" : ""}`}>{parts.join(" · ")}</span>}
      {windowKnown && <ContextBar fill={fill} windowTokens={windowTokens} />}
      {quotaKnown && <span class={`run-quota ${quota.level}`}>{quota.text}</span>}
    </div>
  );
}
