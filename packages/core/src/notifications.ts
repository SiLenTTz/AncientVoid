import type { NormalizedEvent, NotificationLevel } from "@uacc/contracts";

export interface NotificationDraft {
  level: NotificationLevel;
  title: string;
  detail: string | null;
  kind: string;
}

export interface NotificationContext {
  adapter: string;
  project: string;
  /** A provider.error was already reported for this turn — a following
   * "process exited" or adapter.down only repeats it. */
  recentProviderError: boolean;
}

function projectName(project: string): string {
  return project.split("/").filter(Boolean).pop() ?? project;
}

/**
 * ADR-0015: which events deserve the user's attention outside the open
 * session. Everything else stays in the session's own history.
 */
export function notificationFor(event: NormalizedEvent, ctx: NotificationContext): NotificationDraft | null {
  const payload = event.payload as Record<string, unknown>;
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const where = projectName(ctx.project);
  const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
  switch (kind) {
    case "provider.error":
      return { level: "error", title: `${where} · ${event.summary}`, detail: text(payload.detail), kind };
    case "session.start_failed":
      return { level: "error", title: `${where} · ${ctx.adapter}: Start fehlgeschlagen`, detail: text(payload.error), kind };
    case "session.recovery_failed":
      return { level: "error", title: `${where} · Wiederherstellung fehlgeschlagen`, detail: text(payload.reason), kind };
    case "adapter.down":
      return ctx.recentProviderError
        ? null
        : { level: "error", title: `${where} · ${ctx.adapter} antwortet nicht`, detail: text(payload.detail), kind };
    case "session.turn_end":
      return { level: "success", title: `${where} · Zug fertig`, detail: `${ctx.adapter} wartet auf den nächsten Prompt.`, kind };
    case "session.steer_pending_approval":
      return { level: "warning", title: `${where} · Freigabe nötig`, detail: "Eine Antwort wartet in den Freigaben.", kind };
    case "session.budget_exceeded":
    case "session.daily_cap_exceeded":
      return { level: "warning", title: `${where} · Budget erreicht, pausiert`, detail: null, kind };
    case "session.applied":
      return { level: "success", title: `${where} · ins Projekt übernommen`, detail: `${String(payload.files)} Datei(en) nach ${String(payload.into)} (${String(payload.commit)})`, kind };
    case "session.writer_takeover":
      return { level: "info", title: `${where} · Gerät übernommen`, detail: `Schreibt jetzt: ${String(payload.to)}`, kind };
    case "operation.uncertain":
      return {
        level: "warning",
        title: `${where} · Ausführung ungewiss`,
        detail: "Der Hub startete neu, während eine freigegebene Aktion lief. Ob sie ankam, ist unklar — bitte im Verlauf prüfen, sie wird nicht wiederholt.",
        kind,
      };
    case "operation.rejected_changed":
      return { level: "error", title: `${where} · Aktion nicht ausgeführt`, detail: "Die Argumente weichen von der Freigabe ab.", kind };
    case "session.recovered":
      return payload.controllable === false
        ? { level: "warning", title: `${where} · nach Neustart nicht steuerbar`, detail: "Die Session ist nur noch lesbar.", kind }
        : null;
  }
  const exited = /process exited with code (\d+)/.exec(event.summary);
  if (exited && !ctx.recentProviderError) {
    return { level: "error", title: `${where} · ${ctx.adapter} abgebrochen (Code ${exited[1]})`, detail: "Der Provider-Prozess endete mit einem Fehler. Details im Verlauf.", kind: "process.exit" };
  }
  return null;
}
