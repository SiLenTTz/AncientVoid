---
id: BUG-0049
slug: meldung-flackert-beim-tippen
status: done
severity: S3
area: pwa, core
instance: prod
commit: ""
forge: ""
epic: "P8"
created: 2026-10-09
reporter: jan
---

# BUG-0049 — Eine Meldung flackert auf (Entwurf-Zeile, Hub-Hinweise, „Am PC offen“)

## Gesehen

„Das Flackern ist wieder da.“ Gemessen am Beispiel *Antwort tippen* (Playwright, Pixel 7): Die Zeile
„Entwurf gespeichert — auch auf deinen anderen Geräten“ **verschwand beim Tippen fünfmal und kam
wieder**, weil der Entwurf-Status bei jeder Pause `saving` → `saved` wechselt und die Zeile bei
`saving` ausgeblendet wurde; jedes Mal schob sie das Dock mit. Dasselbe Muster an drei weiteren
Stellen, die BUG-0045 nicht erfasst hatte:

- Die Hinweise „Hub nicht erreichbar“ / „Verbindung wieder da“ kamen schon nach zwei verpassten
  Abrufen (8 s) — ein kurzer Aussetzer oder ein Hub-Neustart reichte.
- „Am PC offen“ (neu in EPIC-P15) verschwand bei einem einzelnen leeren Abruf; `ClaudeLive` gab bei
  einem langsamen oder fehlgeschlagenen `claude agents --json` eine leere Liste statt der letzten
  guten.
- Die Modell-Auswahl wurde bei einem fehlgeschlagenen Abruf zu bloßem Text und zurück.

## Erwartet

Ein einzelner kurzer Fehlschlag oder ein Zwischenzustand ändert nichts Sichtbares (Prinzip aus BUG-0045).

## Repro

1. Session öffnen, in das Antwortfeld mit Pausen tippen.
2. Die Zeile „Entwurf gespeichert …“ beobachten.

**Ergebnis nach Schritt 2:** sie klappt bei jeder Pause weg und wieder auf (5 Mal in 6 Pausen).

**Häufigkeit:** bei jedem Tippen mit Pausen.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub, Handy-PWA |
| Commit | `e5a7130` + BUG-0048 |
| Repro-Weg | E2E (Playwright, Pixel 7) |

## Logs

```text
Expected: 0   Received: 5   (Entwurf-Zeile verschwunden)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/ruhe-beim-tippen.spec.ts` | rot ohne Fix (5 Mal verschwunden) |
| E2E | `e2e/specs/pc-offen.spec.ts` „BUG-0049“ (leerer PC-Abruf, jeder zweite Meldungs-Abruf scheitert, Modelle scheitern) | rot ohne die Härtung (Mutationstest: Hinweis verschwand) |
| Unit | `packages/core/test/modules/discovery/claude-live.test.ts` (letzte gute Liste bleibt) | rot ohne Fix |

## Eingrenzung

`SessionTail.tsx` (`draftShown`: zuletzt gesetzten Zustand weiter zeigen), `Notifications.tsx`
(`HUB_DOWN_AFTER = 3`), `PcOpenNotice.tsx` (drei „geschlossen“-Lesungen in Folge), `SessionConfigure.tsx`
(Modellliste bei Fehler behalten), `claude-live.ts` (letzte gute Liste bei Fehler).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
