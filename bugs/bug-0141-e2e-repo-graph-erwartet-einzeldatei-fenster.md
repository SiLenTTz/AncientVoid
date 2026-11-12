---
id: BUG-0141
slug: e2e-repo-graph-erwartet-einzeldatei-fenster
status: done
severity: S3
area: e2e
instance: dev
commit: "e8de9ce"
forge: ""
epic: "EPIC-P48 / BUG-0128"
created: 2026-11-12
reporter: "Claude — volle E2E-Suite auf main"
---

# BUG-0141 — Repo-Graph-Spec erwartet beim Herauslösen noch ein Einzeldatei-Fenster

## Gesehen

`repo-graph.spec.ts` „Datei-Tab … herauslösen“ rot (mobile + desktop): Fenster-URL ist `?window=1#/dateibaum`, erwartet `/sessions/<id>/datei/README.md`.

## Erwartet

Der Spec prüft das seit BUG-0128 gewollte gebündelte Dateibaum-Fenster — samt der offenen Datei darin.

## Eingrenzung

`FilesSidebar.tsx` `detachTree` öffnet seit `93fd1a6` (BUG-0128) bewusst ein Fenster mit Baum und allen offenen Dateien. Kein Produktfehler.

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| E2E | `repo-graph.spec.ts` | rot (×2) |
