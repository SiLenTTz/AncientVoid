import { win32 } from "node:path";
import type { NormalizedEvent, NotificationAction, NotificationLevel } from "@ancientvoid/contracts";

export interface NotificationDraft {
  level: NotificationLevel;
  title: string;
  detail: string | null;
  kind: string;
}

export interface NotificationContext {
  adapter: string;
  project: string;
}

/** Anzeigename eines Projektpfads. Ein Windows-Hub meldet `C:\…`; win32.basename trennt an / und \ (BUG-0196). */
export function projectName(project: string): string {
  return win32.basename(project) || project;
}

/** EPIC-P67 T67.6: gespeicherten Aktionsknopf lesen — kaputter JSON-Stand gilt als "keine Aktion", nie als Absturz. */
export function parseNotificationAction(raw: string | null | undefined): NotificationAction | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { label?: unknown; method?: unknown; path?: unknown };
    if (typeof parsed.label === "string" && parsed.label !== "" && parsed.method === "POST" && typeof parsed.path === "string" && parsed.path.startsWith("/api/")) {
      return { label: parsed.label, method: "POST", path: parsed.path };
    }
    return null;
  } catch {
    return null;
  }
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
      return { level: "error", title: `${where} · ${ctx.adapter} antwortet nicht`, detail: text(payload.detail), kind };
    case "session.interrupted":
      return { level: "warning", title: `${where} · Session unterbrochen`, detail: text(payload.reason), kind };
    case "session.turn_end":
      if (payload.reason === "interrupted") return null;
      // Nutzerfund 2026-11-15: ein abgebrochener Lauf ist eine Fehler-Meldung
      // wert — aber nur eine pro Lauf, mit den Worten des Provider-Fehlers,
      // wenn es einen gab (siehe recordNotifications).
      if (payload.reason === "error") {
        return { level: "error", title: `${where} · Zug fehlgeschlagen`, detail: text(payload.detail) ?? "Der Zug endete mit einem Fehler — Details im Verlauf.", kind: "session.turn_failed" };
      }
      return { level: "success", title: `${where} · Zug fertig`, detail: `${ctx.adapter} wartet auf den nächsten Prompt.`, kind };
    case "tool.permission_requested":
      return {
        level: "warning",
        title: `${where} · ${payload.question === true ? "Rückfrage" : "Freigabe nötig"}`,
        detail: event.summary,
        kind,
      };
    case "session.steer_pending_approval":
      return { level: "warning", title: `${where} · Freigabe nötig`, detail: "Eine Antwort wartet in den Freigaben.", kind };
    // EPIC-P19: ein Loop meldet selbst, wann er eine Person braucht oder gestört ist (AC-P19-2, K9).
    case "loop.hold":
      return { level: "warning", title: `${where} · Loop wartet auf dich`, detail: text(payload.reason), kind };
    case "loop.broken":
      return { level: "error", title: `${where} · Loop gestört`, detail: text(payload.reason), kind };
    case "loop.notify":
      return { level: "warning", title: `${where} · Loop eskaliert (Stufe ${text(payload.level) ?? "?"})`, detail: text(payload.reason), kind };
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
    // ADR-0076: gescheiterte Hintergrundarbeit blockiert die Wiederaufnahme —
    // das bleibt hängen und gehört auf den Bildschirm, nicht nur in den Verlauf.
    case "session.recovery_blocked":
      return { level: "error", title: `${where} · Hintergrundarbeit fehlgeschlagen`, detail: text(payload.detail), kind };
    case "session.recovered":
      // 2026-10-25: only warn when the session was ACTIVELY working — an idle
      // session between turns loses nothing by falling back to observed mode.
      // Repeated false "nur noch lesbar" warnings after every hub restart
      // trained users to ignore the bell (observed 2026-10-24).
      return payload.controllable === false && payload.wasWorking === true
        ? { level: "warning", title: `${where} · nach Neustart nicht steuerbar`, detail: "Die Session lief mitten im Zug und ist jetzt nur noch lesbar.", kind }
        : null;
  }
  // BUG-0162: Nur System-Events sind Prozesswahrheit — thinking/assistant
  // Inhalte, die den String wörtlich enthalten (Agent debuggt Prozesse),
  // sind keine Absturzmeldung.
  if (event.type !== "system") return null;
  const exited = /process exited with code (\d+)/.exec(event.summary);
  if (exited) {
    return { level: "error", title: `${where} · ${ctx.adapter} abgebrochen (Code ${exited[1]})`, detail: "Der Provider-Prozess endete mit einem Fehler. Details im Verlauf.", kind: "process.exit" };
  }
  return null;
}
