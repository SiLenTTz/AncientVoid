---
id: BUG-0140
slug: e2e-kartenmenue-ohne-uebergeben
status: done
severity: S3
area: e2e
instance: dev
commit: "342a89a"
forge: ""
epic: "EPIC-P43 T43.5"
created: 2026-11-12
reporter: "Claude — volle E2E-Suite auf main"
---

# BUG-0140 — Kleinkram-Regel 3 kennt den Menüpunkt „Übergeben…“ der Sessionkarte nicht

## Gesehen

`kleinkram.spec.ts` Regel 3 rot: Menü der Karte hat vier Einträge, der Spec erwartet drei.

## Erwartet

Der Spec prüft das aktuelle Kartenmenü.

## Eingrenzung

`ce19ab6` (Session aus der Karte übergeben, ADR-0039) fügt „Übergeben…“ in `Dashboard.tsx` `actions` ein; der Spec wurde nicht nachgezogen. Kein Produktfehler.

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| E2E | `kleinkram.spec.ts` Regel 3 | rot |
