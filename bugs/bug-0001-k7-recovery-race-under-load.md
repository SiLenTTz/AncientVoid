---
id: BUG-0001
slug: k7-recovery-race-under-load
status: done
severity: S3
area: core
instance: dev
commit: "e25901f"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/1"
epic: EPIC-P0
created: 2026-09-14
reporter: "Claude Sonnet 5 (Session 012Ga2NDi683xR9E63StoN7T)"
---

# BUG-0001 — K7-Recovery-Test race unter CPU-Last

## Gesehen

`packages/core/test/sessionmanager.test.ts` — Test "K7: recovers sessions
with identical event count after hard restart" schlägt unter synthetischer
Volllast fehl: der Byte-Identitäts-Vergleich der Events vor dem
"Crash" (`eventsBefore`) stimmt nicht mit dem, was der zweite Manager nach
`recoverAll()` liest, überein. Beobachtet: erwartete Sequenz endete auf
`…,12`, tatsächlich `…,13`.

## Erwartet

`eventsAfter.slice(0, eventsBefore)` ist byte-identisch zu dem, was vor dem
harten Schnitt gelesen wurde — unabhängig von System-Last.

## Repro

Voraussetzung: keine (reiner Unit-Test, kein laufender Hub nötig).

1. Alle CPU-Kerne synthetisch auslasten: `for i in $(seq 1 $(nproc)); do yes > /dev/null & done`
2. Parallel dazu die volle Suite fahren: `npx vitest run`
3. Kerne wieder freigeben (`kill` der `yes`-Prozesse).

**Ergebnis nach Schritt 2:** `sessionmanager.test.ts` → K7-Test rot, Diff
zeigt eine zusätzliche Sequenznummer am Ende des erwarteten Präfix.

**Häufigkeit:** manchmal, nur unter künstlicher CPU-Last reproduziert (1×
gesehen). Ohne Last: 3/3 Läufe grün.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (kein Hub-Prozess, reiner vitest-Lauf) |
| Commit | `e25901f` |
| Node-Version | 26.7.0 |
| Adapter | dummy (`eventsPerSecond: 20, autoStopAfterEvents: 10`) |
| Repro-Weg | `npx vitest run` unter synthetischer CPU-Last (kein PWA/hubctl-Pfad — reiner Testcode-Defekt) |

## Logs

Kein Hub-Log — vitest-Diff ist die einzige Evidenz:

```text
FAIL packages/core/test/sessionmanager.test.ts > SessionManager > K7: recovers sessions with identical event count after hard restart
AssertionError: expected [ 1, 2, …, 12 ] to deeply equal [ 1, 2, …, 13 ]
  at packages/core/test/sessionmanager.test.ts:120:66
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/sessionmanager.test.ts:88-110` | vorhanden, aber selbst die Ursache (Timing-Snapshot ohne Quiesce) |
| Contract (`adapter-testkit`) | — | nicht betroffen |

Der bestehende K7-Test selbst ist die Testlücke: er nimmt `eventsBefore`
über einen zeitbasierten Snapshot (`setTimeout(900)` + `flush()`) statt über
eine deterministische Bedingung, genau wie BUG das schon beim
`eventsPerSecond`-Test tat (siehe Fix in `ef0138f`).

## Eingrenzung

`packages/core/test/sessionmanager.test.ts:88-96` — `eventsBefore` wird
unmittelbar nach einem festen Sleep gelesen, während der Dummy-Adapter unter
Last noch mitten in einem `setInterval`-Tick stecken kann. Der Timer läuft
nicht synchron mit `flush()`/`tail()` — kein Recovery-Bug in
`sessionmanager.ts` selbst (die K7-Mechanik — JSONL-Replay, Snapshot,
`adapter.recover()` — ist nicht betroffen), sondern ein zu knapper Cutoff im
Test.

## Fix

`eventsBefore` wartet jetzt (Poll statt festem `setTimeout(900)`) auf das
`system`-Event `"dummy: auto-stop reached"` — den Beweis, dass der
Dummy-Adapter seinen Timer bereits gestoppt hat, statt zu raten, wann genug
Zeit vergangen ist. Damit kann kein weiteres Event mehr eintreffen, nachdem
`eventsBefore` gelesen wurde. Verifiziert: 5/5 isolierte Läufe von
`sessionmanager.test.ts` grün. Bei der Gelegenheit auch den `waitFor`-Deckel
des ersten Tests (BUG davor, Commit `ef0138f`) von 5 s auf 12 s angehoben —
`vitest.config.ts` erlaubt ohnehin `testTimeout: 15_000`, der alte Deckel
war unnötig knapp dagegen.

**Bekannte Restunsicherheit, nicht Teil dieses Fixes:** In Kombination mit
bestimmten anderen Testdateien im selben `singleFork`-Prozess bleibt eine
Verzögerung möglich — siehe [BUG-0002](bug-0002-cross-file-timer-delay-singlefork.md).
Das ist eine andere Fehlerklasse (Cross-File-Interferenz statt
Sleep-vs-Snapshot-Race) und wird dort separat verfolgt.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` — behoben
