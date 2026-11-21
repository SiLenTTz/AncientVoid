// EPIC-P61 T61.7 (ADR-0101): Benachrichtigungs-Titel des Hubs (Deutsch) —
// Werte identisch zu den deutschen Titeln, die der Hub als Fallback mitsendet.
export const de = {
  "notification.start_failed": "{project} · {adapter}: Start fehlgeschlagen",
  "notification.recovery_failed": "{project} · Wiederherstellung fehlgeschlagen",
  "notification.adapter_down": "{project} · {adapter} antwortet nicht",
  "notification.session_interrupted": "{project} · Session unterbrochen",
  "notification.turn_failed": "{project} · Zug fehlgeschlagen",
  "notification.turn_done": "{project} · Zug fertig",
  "notification.question": "{project} · Rückfrage",
  "notification.approval_needed": "{project} · Freigabe nötig",
  "notification.loop_hold": "{project} · Loop wartet auf dich",
  "notification.loop_broken": "{project} · Loop gestört",
  "notification.loop_escalated": "{project} · Loop eskaliert (Stufe {level})",
  "notification.budget_paused": "{project} · Budget erreicht, pausiert",
  "notification.applied": "{project} · ins Projekt übernommen",
  "notification.writer_takeover": "{project} · Gerät übernommen",
  "notification.operation_uncertain": "{project} · Ausführung ungewiss",
  "notification.operation_rejected": "{project} · Aktion nicht ausgeführt",
  "notification.recovery_blocked": "{project} · Hintergrundarbeit fehlgeschlagen",
  "notification.recovered_uncontrollable": "{project} · nach Neustart nicht steuerbar",
  "notification.process_exit": "{project} · {adapter} abgebrochen (Code {code})",
} as const;
