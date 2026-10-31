---
id: BUG-0054
slug: token-gate-bleibt-trotz-token
status: done
severity: S3
area: pwa
instance: dev
commit: "8661491"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/12"
epic: "P16"
created: 2026-10-09
reporter: jan
---

# BUG-0054 — Die Übersicht öffnet nicht, obwohl das Token schon im Feld steht

## Gesehen

Auf dem Pixel 9 Pro XL bleibt die Seite auf „AncientVoid Hub“ / „Verbinden“ stehen. Im
Token-Feld steht bereits ein Wert, es gibt keine Fehlermeldung, die Übersicht
(Überschrift „AncientVoid“) erscheint nicht. Der Test bricht in der Anmeldung ab,
bevor der eigentliche Ablauf beginnt.

## Erwartet

Liegt ein gültiges Geräte-Token schon vor, öffnet die Übersicht ohne weiteren
Tipp. Schlägt die Prüfung fehl, steht da, warum — nicht nur ein gefülltes Feld
und „Verbinden“.

## Repro

Voraussetzung: `npm run test:phone` (Chrome auf dem Pixel 9 Pro XL, Test-Hub
auf dem PC, Port per `adb reverse`). Die Specs sind die des Projekts `phone`.

1. Suite starten (`npm run test:phone`).
2. Warten, bis ein Test die Übersicht öffnen will.

**Ergebnis:** in Lauf 9 (2026-10-09, 8,5 min, 60 Tests) fünf Abbrüche, alle an
derselben Stelle (`e2e/support/fixtures.ts`, Überschrift „AncientVoid“ nicht sichtbar),
der Accessibility-Baum zeigte die Token-Seite mit bereits gefülltem Feld und
ohne Fehlertext. Dieselben Abläufe sind im selben Lauf sonst grün (51 bestanden).
Lauf 6: zwei solche Abbrüche, direkt danach einzeln grün. Lauf 8: ein solcher
Abbruch, danach war die DevTools-Verbindung weg (BUG-0055).

**Häufigkeit:** manchmal (5 von 60 im sauberen Volllauf, zuvor 2 von 60).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Test-Hub, vom Handy als `http://127.0.0.1:<port>` |
| Commit | `8661491` (plus uncommitteter Handy-Lauf) |
| Node-Version | v26.7.0 |
| Adapter | dummy / claude / opencode (je Spec) |
| Repro-Weg | PWA (Chrome auf dem Pixel 9 Pro XL, adb/CDP) |

## Logs

Quelle: `/tmp/phone-run9.log`, erster Fehlschlag. Hub-Start
`2026-10-09T12:38:22.859Z` (`adapters loaded`). Kein Token im Auszug.

```text
Error: expect(locator).toBeVisible() failed
Locator: getByRole('heading', { name: 'AncientVoid', exact: true })
Timeout: 10000ms
Error: element(s) not found
```

Accessibility-Baum zum selben Zeitpunkt: Überschrift „AncientVoid Hub“, Textfeld
„Device-Token“ mit Inhalt, Knopf „Verbinden“, kein Fehlertext.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/auth.spec.ts` (gültiges Token öffnet die Übersicht) | am Desktop grün, auf dem Handy nicht in der Phone-Liste; der Abbruch sitzt in der Fixture, nicht in der Spec |
| Vorschlag | `e2e/specs/auth.spec.ts` oder `e2e/support/fixtures.ts`: gespeichertes Token, erster Abruf antwortet 401, die Seite nennt den Grund und bleibt nicht stumm | nicht vorhanden |

## Eingrenzung

`apps/pwa/src/app/main.tsx` (Auto-Prüfung über `adapters()`, bei 401/403 bleibt
`ready` falsch, ohne `setError`). Ob der Abruf wirklich 401 war oder das Handy
ein Token eines früheren Test-Hubs auf demselben `127.0.0.1`-Port noch liegen
hatte (`signIn` überschreibt ein vorhandenes Token nicht), ist offen — das
Hub-Log des Fehlschlags enthält nur „adapters loaded“.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] behoben (2026-10-09)

## Behoben

Zwei Pfade, beide nötig. `e2e/support/fixtures.ts` `signIn` hat ein schon
liegendes `localStorage`-Token gelassen; auf dem Handy bleibt das Token pro
`127.0.0.1`-Port, und ein wiedervergebener Port gehört dem nächsten Test-Hub.
`apps/pwa/src/app/main.tsx` hat bei 401/403 `ready` auf falsch gesetzt, ohne
den Grund in die Token-Seite zu schreiben.

Nach dem Fix: `e2e/specs/auth.spec.ts` „BUG-0054“ grün (Mobile-Projekt).
Kernliste auf dem Pixel 9 Pro XL, Hochformat, 2026-10-09: 56 bestanden,
4 übersprungen, kein Abbruch an der Überschrift „AncientVoid“.
