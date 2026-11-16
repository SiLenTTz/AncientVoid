---
id: BUG-0095
slug: fehler-exit-durch-folgeprompt-zu-interrupted
status: done
severity: S2
area: core
instance: ci
commit: "c82d2ff7"
epic: "P28 T28.3 (AC-P28-2)"
created: 2026-11-06
reporter: "P28-Umsetzung"
---

# BUG-0095 — Fehler-Exit wird durch sofortigen Folgeprompt zu „interrupted“

## Gesehen

E2E `notifications.spec.ts` › „nach einem Fehler geht es mit dem nächsten
Prompt weiter“ (mobile) rot im Kalt-Nachweislauf
[3034339525](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034339525)
(Job 17790320490): Die Session zeigte „unterbrochen (worker_exit)“ mit
deaktiviertem **Weitermachen**, der Prompt „Jetzt wieder“ blieb unbeantwortet
in der Queue — obwohl ein `provider.error` (Kontingent) vorlag und die
Session nach ADR-0015/P27 **error** bleiben muss (fail loud). Lokal und in
drei Runner-Läufen davor grün.

## Erwartet

Ein Worker-Exit mit vorliegendem Provider-Fehler klassifiziert die Session
als `error` — unabhängig davon, wie schnell ein Mensch danach einen
Folgeprompt sendet.

## Repro

Integrationstest „a follow-up prompt right after a failed exit stays error
(BUG-0095)“ in `interrupted-session.integration.test.ts` — vor dem Fix rot
(`expected 'interrupted' to be 'error'`), danach grün.

## Ursache

`SessionInterruption.record()` zog die Journal-Grenze über das **letzte**
`session.prompt`/`session.resumed`. Ein Prompt, der im 250-ms-Settle-Fenster
nach dem Exit einging, verschob die Grenze vor den `provider.error` des
abgeschnittenen Zugs — `failed` wurde falsch, der Fehler-Exit erschien als
glatte Unterbrechung. Unter CI-Timing (langsamerer Klick nach `provider.error`)
trifft das Rennen zuverlässig, lokal fast nie.

## Fix

Die Grenze liegt jetzt auf dem **offenen Zug**: erstes `session.prompt`/
`session.resumed` **nach** dem letzten `session.turn_end`. Folgeprompts im
offenen Zug verschieben sie nicht; ein vorheriger fehlgeschlagener Zug
bleibt hinter seinem `turn_end` unsichtbar (P27-Regel „alter Fehler vergiftet
kein späteres Resume“ bleibt erhalten — bestehende 21 Tests der Suite grün).

## Nachweis

Rot-dann-grün (Integrationstest); E2E-Nachweisläufe im Epic-Abschluss P28.
