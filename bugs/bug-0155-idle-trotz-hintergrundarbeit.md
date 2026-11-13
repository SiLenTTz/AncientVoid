---
id: BUG-0155
slug: idle-trotz-hintergrundarbeit
status: open
severity: S2
area: core
instance: local
commit: "f92263a"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/62"
epic: "P17/P27, PRD K7/K10"
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

`packages/core/src/modules/sessions/session-manager.ts:2616`:
`adapterTurn("idle")` setzt direkt `idle` und schreibt Zugende.
Der Contract hat keine gemeinsame Aktivitätsregistrierung für Provider-
Subagenten und externe Jobs. `activeWorkers` erfasst nur über die Hub-Naht
gestartete Zug-Prozesse; ein persistenter Provider ist ausdrücklich kein Zug.

## Tests und Handoff

Zuerst ADR für additive Activity-Verträge; JSONL-/Snapshot-Recovery (K7).
Tests: Hauptzug beendet bei laufendem Child/Job → aktiv; letzter Child/Job
endet → idle; Hub-Neustart während Hintergrundarbeit; verspätetes Ende aus
alter Worker-Generation; Fehler und offene Freigaben bleiben sichtbar.
Externe Jobs brauchen ausdrückliche Registrierung, kein Parsen von
Assistant-Text als Steuerinformation. Produktfix noch offen; Einzelheiten
im [Audit](../docs/2026-11-13_session-laufzeit-audit.md).
