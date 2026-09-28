---
id: BUG-0035
slug: entdecken-zeigt-aelteste-zuerst
status: open
severity: S2
area: core
instance: dev
commit: "8ac403a"
forge: ""
epic: "P5"
created: 2026-09-28
reporter: jan
---

# BUG-0035 — Entdecken paginiert unsortiert: älteste zuerst, aktuelle erst auf Seite 3

## Gesehen

Im Tab „Entdecken" stehen alte Sessions oben; die aktuell laufenden
(z. B. eine opencode-TUI-Session von heute) erscheinen nicht — sie liegen
erst auf einer späteren Seite.

## Erwartet

Die Liste führt die zuletzt beobachteten Sessions zuerst auf; Seite 1
zeigt, was gerade läuft.

## Repro

1. Hub mit Discovery-Quellen (opencode-DB: 128 Einträge, Ältester von
   Sep 24; Neuester von heute) über `/api/discovery` abfragen
   (`limit`-Default 50).
2. Tab „Entdecken" in der PWA öffnen.

**Ergebnis nach Schritt 2:** Seite 1 = 9 Hub-Sessions + die ~41 ältesten
externen (Scan-Reihenfolge der DB), die heutige Session fehlt. Der Scan
selbst ist aktuell und korrekt (`scanOpencodeSessions`: neuester Eintrag
„mobile-hub", beobachtet zur Laufzeit der Abfrage).

**Häufigkeit:** immer (reine Sortier-/Paging-Logik)

## Eingrenzung

`packages/core/src/modules/sessions/session-manager.ts:220` —
`discover()` merged Hub-Zeilen und externe Quellen und reicht an
`pageDiscovered` weiter, **ohne nach `observedAt` zu sortieren**;
`pageDiscovered` (modules/discovery/dedupe.ts:17) slicet in
Eingabereihenfolge. Quelle der Beobachtung: direkter Scan-Vergleich
gegen die API-Antwort am 28.09.

## Tests

Ohne Fix rot müsste: ein Core-Test, dessen Quelle zwei externe Sessions
(alte + neue) liefert und eine Hub-Session — `discover(…, 0, 2)` muss
die zwei jüngsten liefern, nicht die zwei ersten der Eingabereihenfolge.

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen
