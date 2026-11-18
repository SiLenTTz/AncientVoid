/**
 * BUG-0107: Auto-Zwischenablage nach Textauswahl. Die Retry-Logik liegt in
 * `shared/clipboard-copy.ts` (Architektur: shared darf features nicht importieren);
 * dieser Pfad bleibt der bisherige Import-Ort für Session-Tests und Call-Sites.
 */
export { COPY_RETRY_DELAY_MS, copyWithRetry } from "../../shared/clipboard-copy.ts";
