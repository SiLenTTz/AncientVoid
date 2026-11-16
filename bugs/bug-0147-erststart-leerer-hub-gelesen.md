---
id: BUG-0147
slug: erststart-leerer-hub-gelesen
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: ""
epic: "EPIC-P8"
created: 2026-11-12
reporter: "Claude — messlauf-p8 unter Last"
---

# BUG-0147 — Erststart mit leerem Hub: die ersten Sessions gelten als gelesen

## Gesehen

`messlauf-p8.spec.ts:19` (AC-P8-1) unter Last (`--repeat-each=6 --workers=4`) rot: die Übersicht zeigt 13–17 statt 20 Karten. Überschriften „Du bist dran 15“ und „Ruhig 5“ — fünf fertige Sessions liegen als gelesen im eingeklappten „Ruhig“, obwohl dieses Gerät sie nie gesehen hat.

## Ursache

`Dashboard.tsx` legt den Lesezeiger des Erststarts (T8.6: was existiert, gilt als gelesen) erst an, wenn die Liste nicht leer ist. Öffnet man die App bei leerem Hub — der Normalfall direkt nach dem Setup — und startet dann Sessions, nimmt die erste nicht leere Abfrage alles mit, was darin schon fertig ist, und markiert es als gelesen. Die erste Darstellung rechnet noch ohne Zeiger, erst das nächste Rendern bzw. Neuladen sortiert die Karten nach „Ruhig“.

## Fix

`initSeen` einmal beim Einhängen der Übersicht — die App hängt sie erst nach der ersten geladenen Liste ein, ein leerer Hub hinterlegt also einen leeren Zeiger.

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| E2E | `start-warteschlange.spec.ts` „BUG-0147: Erststart mit leerem Hub — die ersten Sessions sind neu, nicht schon gelesen“ (Abfragen per `page.route` angehalten, bis die Session fertig ist) | rot, 3/3 deterministisch |
| E2E | `messlauf-p8.spec.ts:19` AC-P8-1, `--repeat-each=6 --workers=4` | rot unter Last, nach dem Fix 6/6 |

Vier Specs (`session.spec.ts:97`, `commands.spec.ts:11`, `kleinkram.spec.ts:62`, `schnellsuche.spec.ts:8`) legten Sessions bei offener App an und erwarteten fertige Sessions unter „Ruhig“ — das ging nur über genau diesen Fehler. Sie stellen „schon gesehen“ jetzt ausdrücklich her (`seeAll` in `e2e/support/fixtures.ts`).
