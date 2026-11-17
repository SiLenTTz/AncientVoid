/**
 * EPIC-P59 / ADR-0078 Nachtrag: Prefill-/Decode-Raten aus dem Halogen-Log,
 * Logik angelehnt an Kais `halogen-livelog.py` (serve_api-Zeilen + Proxy-Raten).
 * Nur Zahlen — keine Nachrichteninhalte (Prompt-Injection-Grenze).
 */

/** serve_api: decode|… N tok in Xs = R t/s | … prompt P (C cached), prefill Ss */
const RE_SERVE = /serve_api:\s+\w+\s+(\d+)\s+tok in ([\d.]+)s = ([\d.]+|n\/a)(?: t\/s)?[\s\S]*?prompt (\d+)(?: \((\d+) cached\))?, prefill ([\d.]+)s/;

/** Live-Proxy: n_gen ~N  R t/s  Phase … */
const RE_PROXY_RATE = /n_gen\s+~(\d+)\s+([\d.]+)\s+t\/s/;

export interface HalogenLogRates {
  /** Letzte Decode-Rate (t/s) aus serve_api oder Proxy. */
  decodeTokensPerS: number | null;
  /** Prefill-Rate (neue Tokens / Prefill-Sekunden) aus serve_api. */
  prefillTokensPerS: number | null;
  /** Bytes gelesen seit offset (für Tests). */
  bytesRead: number;
}

/**
 * Liest neue Log-Zeilen ab `offset` und extrahiert die letzten bekannten Raten.
 * `offset` ist Byte-Position; bei Truncate (size < offset) wird von 0 neu gelesen.
 */
export function parseHalogenLogChunk(chunk: string, previous: { decodeTokensPerS: number | null; prefillTokensPerS: number | null } = { decodeTokensPerS: null, prefillTokensPerS: null }): HalogenLogRates {
  let decodeTokensPerS = previous.decodeTokensPerS;
  let prefillTokensPerS = previous.prefillTokensPerS;
  for (const line of chunk.split(/\r?\n/)) {
    const serve = RE_SERVE.exec(line);
    if (serve) {
      const gen = Number(serve[1]);
      const rate = serve[3] === "n/a" ? null : Number(serve[3]);
      const prompt = Number(serve[4]);
      const cached = Number(serve[5] || 0);
      const pf = Number(serve[6]);
      if (rate !== null && Number.isFinite(rate)) decodeTokensPerS = rate;
      else if (Number.isFinite(gen) && Number(serve[2]) > 0) decodeTokensPerS = gen / Number(serve[2]);
      const neu = prompt - cached;
      if (pf > 0 && neu > 0) prefillTokensPerS = neu / pf;
      continue;
    }
    const proxy = RE_PROXY_RATE.exec(line);
    if (proxy) {
      const rate = Number(proxy[2]);
      if (Number.isFinite(rate)) decodeTokensPerS = rate;
    }
  }
  return { decodeTokensPerS, prefillTokensPerS, bytesRead: chunk.length };
}
