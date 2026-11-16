/**
 * BUG-0186: Wenn das Gerät die installierte App nicht drehen will, kann die App es
 * selbst versuchen — und muss ehrlich sagen, wenn sie abgewiesen wird.
 *
 * `screen.orientation.lock()` ist für installierte PWAs da (Manifest-Ausrichtung „any“).
 * Ein ablehnendes Ergebnis ist eine Diagnose, kein Fehler, den man verschluckt: sie
 * unterscheidet „Gerät sperrt“ (Auto-Rotate aus / App-Sperre), „Browser kennt die API
 * nicht“ und „Moment nicht erlaubt“.
 */
export type OrientationTarget = "any" | "portrait" | "landscape" | "portrait-primary" | "landscape-primary";

export interface LockResult {
  ok: boolean;
  /** Für die Oberfläche: ein Satz, der die Lage erklärt — auch bei Erfolg. */
  detail: string;
  /** Wie die Antwort zustande kam: lock/unlock geschafft, abgewiesen, API fehlt. */
  how: "gelockt" | "entsperrt" | "abgewiesen" | "keine-api";
}

type OrientationLike = { lock?: (target: string) => Promise<void>; unlock?: () => void };

function orientationApi(): OrientationLike | undefined {
  if (typeof screen === "undefined") return undefined;
  return (screen as { orientation?: OrientationLike }).orientation;
}

/** Richtungswechsel erzwingen. `any` entsperrt wieder und folgt dem Gerät. */
export async function lockOrientation(target: OrientationTarget): Promise<LockResult> {
  const api = orientationApi();
  if (!api || typeof api.lock !== "function") {
    return { ok: false, detail: "Dieser Browser kennt screen.orientation.lock nicht — Drehen bleibt am Gerät eingestellt.", how: "keine-api" };
  }
  if (target === "any") {
    try {
      api.unlock?.();
      return { ok: true, detail: "Sperre gelöst — das Fenster folgt wieder dem Gerät.", how: "entsperrt" };
    } catch (err) {
      return { ok: false, detail: `Entsperren abgelehnt: ${errName(err)}`, how: "abgewiesen" };
    }
  }
  try {
    await api.lock(target);
    return {
      ok: true,
      detail: target.startsWith("landscape") ? "Querformat erzwungen — das Fenster liegt jetzt quer." : "Hochformat erzwungen.",
      how: "gelockt",
    };
  } catch (err) {
    return {
      ok: false,
      detail: `${errName(err)} — das Gerät oder Chrome hält die Ausrichtung fest. Auto-Rotate und die App-Ausrichtung des Geräts prüfen.`,
      how: "abgewiesen",
    };
  }
}

function errName(err: unknown): string {
  if (err instanceof Error) return err.name === "SecurityError" ? "SecurityError (Gerät sperrt)" : err.name || err.message;
  return String(err);
}
