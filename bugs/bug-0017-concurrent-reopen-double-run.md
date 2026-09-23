---
id: BUG-0017
slug: concurrent-reopen-double-run
status: fixed
severity: S1
area: core
instance: dev
commit: ""
forge: ""
epic: "EPIC-P5 T5.5 / AC-P5-4, Premortem 2"
created: 2026-09-23
reporter: "Claude Opus 5.5 (P5-Statusanalyse)"
---

# BUG-0017 — Handy und PC öffnen eine gestoppte Session gleichzeitig: zwei Läufe

## Gesehen

Zwei Clients (`clientId` `phone` und `desktop`) schicken gleichzeitig einen
Prompt an dieselbe gestoppte Session. Beide bekommen `{ ok: true }`, der
Provider startet zweimal.

Zusätzlich: die PWA schickte weder `inputId` noch `clientId` mit. Der
Lease-Schutz aus T5.5 war damit in der echten Oberfläche wirkungslos, auch
für einen normalen Doppeltipp auf „Senden“.

## Erwartet

Genau ein Lauf. Der zweite Client bekommt einen sichtbaren Konflikt
(`writer lease held`), die PWA erklärt ihn auf Deutsch.

## Repro

1. Session anlegen und stoppen.
2. `Promise.all` mit zwei `steer()`-Aufrufen, verschiedene `clientId`/`inputId`.

**Ergebnis:** beide `ok: true`, drei Provider-Starts statt zwei.

**Häufigkeit:** immer, sobald beide Anfragen vor dem Statuswechsel ankommen.

## Eingrenzung

`packages/core/src/sessionmanager.ts`, `steer()`: zwischen der Prüfung
„gestoppt?“ und `setStatus("working")` liegen mehrere `await`
(Replay, Skill-Kette, Worktree). Die zweite Anfrage prüfte in dieser Lücke.
Die Lease half nicht, weil sie wegen BUG-0016 auf diesem Pfad nie gesetzt
wurde. PWA: `packages/pwa/src/api.ts` `steer()` sendete nur `input`.

## Fix

- `steer()` reiht Aufrufe pro Session hintereinander (`steerQueue`). Die
  zweite Anfrage sieht Lease und Revision der ersten.
- PWA: `clientId()` pro Gerät in `localStorage`, `newInputId()` pro Senden.
  Ein erneutes Senden desselben Textes nach einem Fehler behält die ID.
  `steerRejectText()` übersetzt Lease- und Revisionskonflikte.

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| Unit | `packages/core/test/steer-reopen.test.ts` „BUG-0017“ | rot (beide `ok: true`) | grün |
| Unit | `packages/pwa/test/steer-meta.test.ts` | — (neu) | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
