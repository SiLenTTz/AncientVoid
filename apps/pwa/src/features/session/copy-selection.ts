/**
 * BUG-0107: Auto-Zwischenablage nach Textauswahl (Nutzer-Anforderung
 * 2026-10-30). Eine unter Last transient abgelehnte Clipboard-Schreibaktion
 * wurde still geschluckt — obwohl der Feature-Vertrag „Auswahl wird nie
 * still verloren" lautet und der Flash der Beleg fürs Kopieren ist.
 * Ein gebundener Einzel-Retry hebt die transienten Ablehnungen auf;
 * erst wenn er ausbleibt, gilt der Kopieren-Button-Weg (insecure context).
 */

export const COPY_RETRY_DELAY_MS = 150;

export async function copyWithRetry(
  text: string,
  writeText: (t: string) => Promise<void>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch {
    // transient (Renderer/Clipboard-Service unter Last): genau ein Retry
    await sleep(COPY_RETRY_DELAY_MS);
    try {
      await writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
