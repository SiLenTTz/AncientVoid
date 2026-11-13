/**
 * EPIC-P57 T57.9: Erststart-Fortschritt dieses Geräts. Reiner Gerätezustand im lokalen Speicher (K7): nie
 * Hub-Wahrheit, ohne Recovery-Pfad nötig — fehlt der Eintrag, ist es, als wäre das Gerät neu.
 *
 * Ablauf: der Einstieg im Leerzustand „schärft“ (`armed`), die erste entschiedene Freigabe setzt `signal`,
 * Schließen setzt `done`. Wer den Einstieg nie sah (bestehendes Gerät mit Sessions), bekommt kein Signal.
 */
const KEY = "ancientvoid.firstRun";
export const FIRST_APPROVAL_EVENT = "ancientvoid:first-approval";

type State = "armed" | "signal" | "done";

function read(): State | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "armed" || v === "signal" || v === "done" ? v : null;
  } catch {
    return null;
  }
}

function write(state: State): void {
  try {
    localStorage.setItem(KEY, state);
  } catch {
    // Speicher voll oder gesperrt: dann gibt es das Erfolgssignal eben nicht — nichts davon ist Hub-Wahrheit.
  }
}

/** Der Einstieg wurde gezeigt: ab jetzt zählt die erste Freigabe-Entscheidung als Erfolgssignal. */
export function armFirstRun(): void {
  if (read() === null) write("armed");
}

/** Eine Freigabe wurde entschieden (egal wo). Gibt zurück, ob das Erfolgssignal damit fällig wurde. */
export function noteApprovalDecided(): boolean {
  if (read() !== "armed") return false;
  write("signal");
  if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent(FIRST_APPROVAL_EVENT));
  return true;
}

export function firstSignalPending(): boolean {
  return read() === "signal";
}

export function dismissFirstSignal(): void {
  if (read() === "signal") write("done");
}
