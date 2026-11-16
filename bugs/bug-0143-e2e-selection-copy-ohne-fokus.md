---
id: BUG-0143
slug: e2e-selection-copy-ohne-fokus
status: done
severity: S3
area: e2e
instance: dev
commit: "b1ab170"
forge: ""
epic: ""
created: 2026-11-12
reporter: "Claude — volle E2E-Suite auf main"
---

# BUG-0143 — Markieren-kopiert-Spec unter voller Suite ohne Kopier-Bestätigung

## Gesehen

`selection-copy.spec.ts` „fertige Auswahl … im Clipboard“ (mobile) rot in der vollen Suite: `.copy-flash` erscheint nie. Einzeln und unter 12 Workern 32/32 grün — nicht isoliert reproduzierbar.

## Erwartet

Der Test markiert erst, wenn der Verlauf gerendert ist und die Seite den Fokus hat — wie ein Mensch, der markiert.

## Eingrenzung

Hypothese (nicht bewiesen): `navigator.clipboard.writeText` lehnt ohne fokussiertes Dokument ab; `SessionTail` zeigt den Flash dann bewusst nicht (`copyWithRetry` → `ok=false`). Zweite Lücke: der Test wählte direkt nach `.session-live` aus, ohne auf die gerenderte Antwort zu warten.

## Fix

Spec wartet auf den Marker im Verlauf und holt die Seite vor dem Markieren nach vorn (`bringToFront`). Produktverhalten unverändert.

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| E2E | `selection-copy.spec.ts` (`--repeat-each=6 --workers=8`) | 1× rot in voller Suite |

Bleibt es in der vollen Suite rot, ist die Fokus-Hypothese falsch — dann neu öffnen.
