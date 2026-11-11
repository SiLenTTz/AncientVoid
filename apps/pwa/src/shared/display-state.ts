import { statusLabel } from "./status.ts";

/**
 * EPIC-P43 T43.2 (§3.3): der Anzeigezustand einer Session — was ein Mensch auf einen Blick wissen
 * muss. Er ist aus dem `SessionStatus` des Hubs und zwei Gerätebeobachtungen abgeleitet; der
 * Contract bleibt unverändert, der rohe Status steht weiter in `data-status`.
 *
 *   working   arbeitet                  --ok     Punkt        Atmen
 *   approval  blockiert, braucht dich   --call   Punkt + Hof  Ruf
 *   question  Frage des Agenten         --info   Punkt + Hof  Ruf
 *   done      fertig, dein Zug          --call   Ring         Einrasten
 *   error     Fehler / unterbrochen     --err    Quadrat      kurzes Rütteln
 *   quiet     ruhig                     --fg-faint Punkt      keine
 */
export type DisplayState = "working" | "approval" | "question" | "done" | "error" | "quiet";

export interface DisplayInput {
  status: string;
  /** Die offene Anfrage dieser Session ist eine Rückfrage des Agenten (`tool.questions`). */
  question?: boolean;
  /** Es gibt Ereignisse, die dieses Gerät noch nicht gesehen hat. */
  unseen?: boolean;
}

export function displayState({ status, question = false, unseen = false }: DisplayInput): DisplayState {
  switch (status) {
    case "starting":
    case "working":
    case "stopping":
      return "working";
    case "waiting_approval":
      return question ? "question" : "approval";
    case "error":
    case "interrupted":
      return "error";
    // Ein beendeter Zug ruft nur, solange sein Ergebnis hier noch niemand angesehen hat.
    case "idle":
      return unseen ? "done" : "quiet";
    case "parked":
    case "stopped":
      return "quiet";
    // Fail loud: ein unbekannter Status ist kein ruhiger Zustand.
    default:
      return "error";
  }
}

/** Das Wort zum Zustand. Der Hub-Status bleibt der Text, außer wo der Anzeigezustand mehr weiß. */
export function displayLabel(input: DisplayInput): string {
  const state = displayState(input);
  if (state === "question") return "Frage";
  if (state === "done") return "fertig";
  return statusLabel(input.status);
}

/** „Du bist dran“: Freigabe, Frage, fertiger Zug, Fehler und Unterbrechung. */
export function needsYou(state: DisplayState): boolean {
  return state === "approval" || state === "question" || state === "done" || state === "error";
}

/**
 * Gesamtzustand über mehrere Sessions, Priorität wie VoidWarden `spec.md` §5.1:
 * Freigabe > Frage > Fehler > arbeitet > fertig > ruhig. (Offline steht darüber und kommt von der Verbindung.)
 */
const PRIORITY: readonly DisplayState[] = ["approval", "question", "error", "working", "done", "quiet"];

export function overallState(states: readonly DisplayState[]): DisplayState {
  return PRIORITY.find((p) => states.includes(p)) ?? "quiet";
}
