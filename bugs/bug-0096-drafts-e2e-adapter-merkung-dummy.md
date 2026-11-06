---
id: BUG-0096
slug: drafts-e2e-adapter-merkung-dummy
status: open
severity: S3
area: pwa
instance: ci
commit: "22f2998d4f02fcc2ace1e0544d6351de46f0fdff"
epic: "P28 T28.3 (Beobachtung, offengehalten)"
created: 2026-11-06
reporter: "P28-Umsetzung"
---

# BUG-0096 — Neue-Session-Formular zeigt gemerkten Adapter als „dummy“ (1× CI)

## Gesehen

`e2e/specs/drafts.spec.ts:79` › „Neue Session merkt sich Harness und Projekt
und hält den Start-Prompt als Entwurf“ (mobile) rot im Lauf
[3034417565](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034417565)
(Job 17790867393): Nach einer erfolgreich gestarteten opencode-Session
(topbar-Assert grün) zeigte das erneut geöffnete Neue-Session-Formular den
Adapter dauerhaft als „dummy“ (`toHaveValue` 23× „unexpected value dummy“
über 10 s) statt des gemerkten „opencode“.

## Erwartet

Das Formular belegt den Adapter mit dem zuletzt gestarteten (LAST_KEY in
`CreateSession.tsx`, gesetzt nach `api.createSession`).

## Repro

Einmaliges Auftreten in 5 Runner-Läufen; lokal nicht reproduziert. Artefakte
(Trace, Screencast, error-context) des Jobs sind 14 Tage verfügbar. Analyse
offen: Netzwerk-Recording im Trace leer, deshalb ungeklärt, ob
`LAST_KEY.adapter` falsch geschrieben (State-Race im Submit-Handler) oder
falsch gelesen wurde (Mount vor Write ist nach Code-Lektüre ausgeschlossen,
da `onCreated` erst nach `setItem` navigiert).

## Umgang

Kein Fix ohne Repro (evidence over assumption). Offen gehalten; bei
Reproduktion Trace via `npx playwright show-trace` auswerten und ggf. als
BUG-0096-Nachtrag fixen. Die CI-Worker-Anzahl (2 → 1) verringert allgemeine
Timing-Last, ist aber kein Fix für diesen Fall.
