---
id: BUG-0120
slug: parallele-playwright-laeufe-teilen-test-results
status: done
severity: S3
area: e2e
instance: dev
commit: "492999d"
forge: ""
epic: "EPIC-P43"
created: 2026-11-11
reporter: "Agent (EPIC-P43 T43.9)"
---

# BUG-0120 — Parallele Playwright-Läufe löschen sich gegenseitig die Artefakte

## Gesehen

Laufen `npm run gate` (E2E-Phase) und `npm run test:phone` gleichzeitig, scheitern Tests beider Läufe mit
`ENOENT … test-results/.playwright-artifacts-*/traces/*.trace` bzw. „Target page, context or browser has been closed“.

## Erwartet

Beide Läufe sind unabhängig; ein Lauf löscht nie die Artefakte eines anderen.

## Repro

Voraussetzung: Handy per adb verbunden (`scripts/phone-e2e.mjs`).

1. `npm run test:phone` starten.
2. Während er läuft, `npm run test:e2e` (oder `npm run gate`) starten.

**Ergebnis nach Schritt 2:** Der zweite Lauf leert beim Start `test-results/`; laufende Tests des ersten verlieren ihre
Trace-Dateien und scheitern beim Schließen des Kontexts.

**Häufigkeit:** immer, sobald sich die Läufe überlappen.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `492999d` |
| Node-Version | 26.7.0 |
| Adapter | Attrappen (E2E) |
| Repro-Weg | npm-Skripte |

## Logs

```text
Error: browserContext.close: ENOENT: no such file or directory, open '…/test-results/.playwright-artifacts-1/traces/…-recording16.trace'
Error: apiRequestContext._wrapApiCall: ENOENT: no such file or directory, copyfile '…/test-results/.playwright-artifacts-1/traces/…-recording53.network' -> '…'
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | beide Läufe gleichzeitig | rot (Artefakte fehlen) |

Ein Test ist hier ein Ablauf: Handy-Lauf und Gate überlappend starten, beide müssen ohne ENOENT enden.

## Eingrenzung

`playwright.config.ts` (kein eigener `outputDir` je Lauf), `scripts/phone-e2e.mjs`. Vorschlag: der Handy-Lauf setzt
`outputDir`/Reporter-Ordner auf `test-results-phone/`.

## Fix

`playwright.config.ts`: Ist `ANCIENTVOID_E2E_CDP` gesetzt (Handy-Lauf), schreibt Playwright nach `test-results-phone/` und `playwright-report-phone/` (beide git-ignored). Gate und CI bleiben bei `test-results/`/`playwright-report/`.

Nachweis am echten Handy (OnePlus, 12.11.2026): `npm run test:phone -- session.spec.ts` starten, nach 25 s `npx playwright test e2e/specs/kleinkram.spec.ts --project=mobile` dazu.

| | ENOENT im Handy-Lauf | paralleler Lauf |
|---|---|---|
| ohne Fix | 3 (`test-results/.playwright-artifacts-0/…`), danach Abbruchkaskade „context closed“ | 8/8 grün |
| mit Fix | 0, Artefakte in `test-results-phone/` | 8/8 grün |

Der Handy-Lauf selbst scheitert in beiden Fällen schon an `session.spec.ts:4` (weiße Seite, noch vor dem Start des zweiten Laufs) — das ist BUG-0121, nicht dieser Defekt.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [x] `bugfix`
