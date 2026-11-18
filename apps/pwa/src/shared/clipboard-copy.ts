/**
 * ADR-0090: EIN Weg für alles, was die App kopiert. Vorher schrieb jede Stelle einzeln
 * in `navigator.clipboard` — der Text war nach dem nächsten Kopieren weg. Jetzt liegt er
 * zusätzlich in der mehrstufigen Ablage (`shared/clipboard-shelf.ts`).
 *
 * Ehrlich dabei: schlägt das System-Clipboard fehl (unsicherer Kontext), bleibt die Stufe
 * trotzdem in der Ablage — „Auswahl wird nie still verloren“ gilt auch ohne Clipboard-API.
 */
import { copyWithRetry } from "../features/session/copy-selection.ts";
import { pushShelf, type ShelfOrigin } from "./clipboard-shelf.ts";

export interface CopyOptions {
  /** Token, Kennwörter: die Ablage bekommt davon nichts ab (ADR-0090). */
  secret?: boolean;
}

/** In die System-Zwischenablage und eine Stufe tiefer in die Ablage. */
export async function copyIntoShelf(text: string, origin: ShelfOrigin, opts: CopyOptions = {}): Promise<boolean> {
  const ok = navigator.clipboard ? await copyWithRetry(text, (t) => navigator.clipboard!.writeText(t)) : false;
  pushShelf(text, origin, opts);
  return ok;
}
