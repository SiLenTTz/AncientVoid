---
id: BUG-0155
slug: idle-trotz-hintergrundarbeit
status: done
severity: S2
area: core
instance: local
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/62"
epic: "P17/P27, PRD K7/K10, ADR-0074 + ADR-0076"
created: 2026-11-13
reporter: "Session-Audit im Nutzerauftrag"
---

# BUG-0155 — Session wird idle, obwohl zugehörige Hintergrundarbeit läuft

## Gesehen

P57-Session `a257b3d1-f9e3-429e-a445-b0e7088f4119` meldet um
2026-11-13T14:33:56Z laufenden Messlauf/Watcher und wird direkt `idle`.
Während des Audits läuft die zugehörige `ttfs-diag2.service` weiter.

## Erwartet

Solange zugehörige Hintergrundarbeit oder Subagenten laufen, bleibt die
Session aktiv. Das Ende einer Chatantwort ist kein Auftragsabschluss.
Ein lediglich zwischen Aufträgen bereitstehender Provider zählt nicht als Arbeit.

## Repro und Logs

**Produktionsjournal/SQLite und systemd lesend bestätigt; kein eigener
PWA-/hubctl-Repro gestartet**, um keine weiteren Produktiv-Jobs auszulösen.

1. Journal unter `data/sessions/a257b3d1-f9e3-429e-a445-b0e7088f4119/`
   lesen: letzte Antwort nennt Messlauf/Watcher und weitere offene Schritte.
2. `acp.turn_end(end_turn)` und `session.turn_end(code=0)` um 14:33:56Z lesen.
3. SQLite-Projektion: Session-Status `idle`.
4. `systemctl --user list-units --all --plain --no-legend` zeigt während
   desselben Audits `ttfs-diag2.service ... active running`.

**Häufigkeit:** ein live belegtes Gegenbeispiel. Weitere Provider-/Subagent-
Varianten sind zu testen, nicht aus diesem einen Fall als live bestätigt abzuleiten.

## Eingrenzung

`packages/core/src/modules/sessions/session-manager.ts`:
`adapterTurn("idle")` setzte direkt `idle` und schrieb Zugende.
Der Contract hatte keine gemeinsame Aktivitätsregistrierung für Provider-
Subagenten und externe Jobs. `activeWorkers` erfasste nur über die Hub-Naht
gestartete Zug-Prozesse; ein persistenter Provider ist ausdrücklich kein Zug.

## Fix (ADR-0074 T1 + ADR-0076 T2–T4)

Aktivitätsregister, idle nur bei leerem Register, Events
`session.activity_begin/end/pending`, K7-Recovery aus dem JSONL.

- **T1 (MR !452):** Kern — Register, Idle-Gates (`adapterTurn`,
  `trackTurn`-Settle, promptloses Resume), K7-Recovery (Faltung + kein
  Interrupt bei offenen Aktivitäten), Snapshot-Projektion, Contract additiv.
- **T2 (Abschluss-MR):** `AdapterContext.activity(ActivityReport)` — Codex
  meldet `collabAgentToolCall`/`subAgentActivity`-Kinder (auch solche, die
  das Zugende überleben), Claude Tasks; Quelle `provider`. Toter Provider:
  ends ins Journal, damit die Faltung nichts Offenes mehr erfindet.
- **T3 (Abschluss-MR):** Server-Route `/api/sessions/:id/activity` +
  `hubctl activity <session> <id> run --` registriert externe Jobs mit
  Herzschlag (20 s); ohne Meldung über die Frist (90 s) gilt die Arbeit als
  unklar/fehlgeschlagen (`session.recovery_blocked`) und stoppt die
  Wiederaufnahme — kein zweiter Job.
- **T4 (Abschluss-MR):** PWA zählt begin/end-Paare und zeigt
  „Hintergrundarbeit aktiv · N offene Aktivitäten".

## Tests

| Ring | Datei | Stand |
|---|---|---|
| Unit (T1) | `packages/core/test/modules/sessions/activity-register.test.ts` | grün |
| Unit (T2) | `packages/adapters/codex/test/app-server.test.ts` (Kind überlebt Hauptzug, endet selbstständig) | grün |
| Integration (T3) | `apps/hubctl/test/activity.integration.test.ts`, `interrupted-session.integration.test.ts` | grün |
| E2E (T3/T4) | `e2e/specs/session-robustheit.spec.ts` „Hintergrundarbeit bleibt bis zum letzten Job aktiv" | grün |

## Handoff

- [x] ADR-0074 (Register, MR !452) + ADR-0076 (Vertrag Wiederaufnahme/Queue)
- [x] T1–T4 umgesetzt und im Vollgate grün (Abschluss-MR Session-Robustheit)
- [x] GitLab-Issue [#62](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/62)
