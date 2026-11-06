---
id: BUG-0094
slug: resize-e2e-autogrow-misst-vor-render
status: done
severity: S3
area: e2e
instance: ci
commit: "6a2aeca9"
epic: "P28 T28.3"
created: 2026-11-06
reporter: "P28-Umsetzung"
---

# BUG-0094 — Resize-E2E misst Auto-Grow vor dem Re-Render

## Gesehen

`e2e/specs/resize.spec.ts` › „Maximieren-Button macht das Feld groß und
wieder klein“ (mobile) rot im Nachweislauf auf dem Projekt-Runner:
`Expected > 122.59, Received 62.59` — die Feldhöhe nach dem Einfüllen von
8 Zeilen entsprach exakt der Ruhehöhe. Job
[17789203120](https://gitlab.com/SiLenT_Tz/AncientVoid/-/jobs/17789203120)
(294 passed / 1 failed). Im Lauf davor (17788341685) und lokal grün.

## Erwartet

Nach 8 Zeilen Text ist das Feld messbar gewachsen (Auto-Grow, MR !257).

## Repro

CI-Timing-abhängig (2 Workers, 8-CPU-Limit): `boundingBox()` direkt nach
`fill()` liest die Höhe vor dem React-Re-Render. Lokal (schneller) liegt
der Re-Render innerhalb der Messung.

## Ursache

Momentaufnahme nach asynchroner UI-Reaktion: Der Auto-Grow-Effekt setzt die
Höhe erst nach dem Re-Render; der Test maß sofort.

## Fix

Die Höhe pollend abwarten (`expect.poll`, 5 s Timeout) statt sofort zu
messen — gleiche Schwelle (`idle + 60`), keine Assertion entschärft.

## Nachweis

Rot: Job 17789203120. Grün: Spec lokal 3/3 nach Fix; folgende CI-Läufe im
Epic-Abschluss P28.
