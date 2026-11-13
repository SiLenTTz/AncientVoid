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
reporter: "Session-Audit im Nutzerauftrag (GitLab #62, Datei hier materialisiert)"
---

# BUG-0155 — Session wird idle, obwohl zugehörige Hintergrundarbeit läuft

## Gesehen

P57-Session `a257b3d1-f9e3-429e-a445-b0e7088f4119` meldete am 13.11.2026 um
14:33:56Z nach `acp.turn_end`/`session.turn_end` direkt `idle`, während
`ttfs-diag2.service` (Messlauf-Diagnose) weiterlief. Aus Nutzersicht: eine
„steckengebliebene" Session, obwohl Arbeit lief.

## Erwartet

Solange zugehörige Hintergrundarbeit oder Subagenten laufen, bleibt die
Session aktiv. Das Ende einer Chatantwort ist kein Auftragsabschluss. Ein
lediglich zwischen Aufträgen bereitstehender Provider zählt nicht als Arbeit.

## Repro

1. Journal unter `data/sessions/a257b3d1-…/` lesen: letzte Antwort nennt
   Messlauf/Watcher, danach `session.turn_end` um 14:33:56Z.
2. SQLite-Projektion: Status `idle`.
3. `systemctl --user list-units` zeigt `ttfs-diag2.service … active running`.

**Häufigkeit:** ein live belegtes Gegenbeispiel (Audit); kernseitig jetzt
durch Tests belegt (`activity-register.test.ts`).

## Root-cause

`packages/core/src/modules/sessions/session-manager.ts` (`adapterTurn`):
`adapterTurn("idle")` setzte `idle`, sobald der Adapter das Zugende meldet;
`activeWorkers` erfasste nur Zug-Prozesse über die Hub-Naht. Der Contract
hatte keine Aktivitätsregistrierung für Subagenten/externe Jobs.

## Fix (ADR-0074, gestuft)

[ADR-0074](../docs/adr/0074-session-aktivitaetsregister.md) —
Aktivitätsregister, idle nur bei leerem Register, Events
`session.activity_begin/end/pending`, K7-Recovery aus dem JSONL.

- **T1 (geliefert):** Kern — Register, Idle-Gates (`adapterTurn`,
  `trackTurn`-Settle, promptloses Resume), K7-Recovery (Faltung + kein
  Interrupt bei offenen Aktivitäten), Snapshot-Projektion, Contract additiv.
  Tests: `packages/core/test/modules/sessions/activity-register.test.ts`
  (Zugende bei laufender Aktivität → working; letzte endet → idle+turn_end;
  Hub-Neustart → Register zurück, spätes Ende; unbekannte/alte end-Ids
  ignoriert; Registrierung an idle Session → working).
- **T2 (offen):** `AdapterContext.registerActivity` + opencode-ACP-Anbindung
  (Hintergrund-Shells des Harness).
- **T3 (offen):** Server-Route + `hubctl session activity` für explizite
  Agent-Registrierung (Auth: Device-Token, `agent:` bleibt lesend).
- **T4 (offen):** PWA zeigt offene Aktivitäten (Label je Aktivität).

## Tests

| Ring | Datei | Stand |
|---|---|---|
| Unit (neu) | `packages/core/test/modules/sessions/activity-register.test.ts` | 4/4 grün |
| Regression | `packages/core/test/modules/sessions/turn-state.test.ts` | grün (Semantik ohne Aktivität unverändert) |

## Handoff

- [x] ADR-0074 angelegt
- [x] T1 Kernimplementierung + Tests (MR folgt)
- [ ] T2–T4 (Nahtstellen) als Folgeaufträge — Issue bleibt offen bis T3
