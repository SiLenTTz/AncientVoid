---
id: BUG-0167
slug: fastify-update-macht-zughistorie-flaky
status: open
severity: S3
area: server
instance: dev
commit: ""
forge: "https://github.com/SiLenTTz/AncientVoid/issues/5"
epic: ""
created: 2026-11-15
reporter: "Veröffentlichungs-Audit (docs/2026-11-15_public-release-audit.md)"
---

# BUG-0167 — fastify ≥ 5.12.6 macht „ohne Plan, mit Zughistorie“ flaky

## Gesehen

Nach `npm audit fix` (fastify 5.12.5 → 5.12.8, find-my-way 9.9.0 → 9.10.1,
@fastify/static 10.1.5 → 10.1.11) zeigt die PWA im dritten Zug einer Session
gelegentlich „Schätzung ab 5 Läufen (bisher 2)“ statt „Zug hier meist …
(2 gelaufen)“ — die PWA kennt dann weniger als zwei abgeschlossene Zugdauern,
obwohl der Hub zwei Läufe zählt.

## Erwartet

Wie mit fastify 5.12.5: die typische Zugdauer erscheint, sobald zwei Züge
abgeschlossen sind.

## Repro

1. `npm audit fix` auf `main` (oder `overrides.fastify` in `package.json` entfernen, `npm install`).
2. `npx playwright test e2e/specs/progress.spec.ts -g "Zughistorie" --repeat-each=30`

**Ergebnis nach Schritt 2:** 2–3 von 30 rot. Mit fastify 5.12.5: 0 von 104
(main 74/74, Branch mit Pin 30/30).

**Häufigkeit:** manchmal (~7–10 %)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | E2E-Hub (`e2e/support/hub.ts`) |
| Node-Version | 24.22.3, macOS |
| Adapter | opencode (Fake-Binary) |
| Repro-Weg | Playwright |

## Logs

Playwright: `expect(locator('.run-progress')).toContainText(/Zug hier meist .+ \(2 gelaufen\)/)`
— erhalten: „läuft seit < 1 min · ohne Plan kein Fortschritt messbar · Schätzung ab 5 Läufen (bisher 2)“.

## Testlücke

Kein Unit-/Integrationstest prüft, dass die PWA nach einem Reload mitten im
dritten Zug alle abgeschlossenen Züge aus der Event-Historie kennt.

## Notlösung

Root-`package.json` pinnt `"overrides": { "fastify": "5.12.5" }`. Die dadurch
offene Advisory GHSA-389g-gv7q-r4x8 (Header-Validierung über
`propertyNames`) trifft den Hub nicht: keine Route definiert ein
Header-Schema (`git grep -n "headers:" apps packages`, 15.11.2026). Den Pin
entfernen, sobald die Ursache (vermutlich Antwort-/Event-Reihenfolge der
Historie beim Reload) gefixt ist.
