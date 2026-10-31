---
id: BUG-0056
slug: code-suche-nicht-im-viewport
status: done
severity: S3
area: pwa
instance: dev
commit: "8661491"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/14"
epic: "P16"
created: 2026-10-09
reporter: jan
---

# BUG-0056 — „Code durchsuchen“ liegt nach einer Aktion nicht mehr im Bild

## Gesehen

Auf dem Pixel 9 Pro XL ist das Suchfeld „Code durchsuchen“ nach dem Ausführen
einer Aktion noch im Dokument, aber nicht mehr im sichtbaren Bereich
(Viewport-Anteil 0). Die Suche davor (Treffer, Datei, Reload) war auf dem
Handy durchgelaufen.

## Erwartet

Neue Ereignisse schieben die Suche nicht aus dem Bild. Das Feld bleibt
sichtbar, ohne dass man erst zurückscrollt.

## Repro

Voraussetzung: `npm run test:phone`, Chrome, Test-Hub. Spec
`e2e/specs/code.spec.ts` (in diesem Lauf vorübergehend in der Phone-Liste;
die Liste selbst ist danach wieder die Kernspecs).

1. Session öffnen, Tab „Code“.
2. `parseToken` suchen, Treffer öffnen, Zeile wechseln, neu laden.
3. `parse_token` suchen.
4. Aktion „Letzte Commits“ ausführen.

**Ergebnis nach Schritt 4:** `.action-status` ist „erfolgreich“, das Feld
„Code durchsuchen“ hat den Viewport-Anteil 0.

**Häufigkeit:** einmal in diesem Lauf (zweiter Test der Zusatzsuite, Gerät
zu Beginn im Hochformat; gegen Ende des 21-Minuten-Laufs lag es im
Querformat — dieser Fehlschlag liegt am Anfang).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Test-Hub, vom Handy als `http://127.0.0.1:<port>` |
| Commit | `8661491` |
| Node-Version | v26.7.0 |
| Adapter | dummy |
| Repro-Weg | PWA (Chrome, Pixel 9 Pro XL) |

## Logs

Quelle: `/tmp/phone-run10.log`. Kein Token.

```text
Error: expect(locator).toBeInViewport() failed
Locator: getByLabel('Code durchsuchen')
Expected: in viewport
Received: viewport ratio 0
```

Das Feld war aufgelöst (`<input type="search" aria-label="Code durchsuchen">`),
nur ohne Schnittmenge mit dem Viewport.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/code.spec.ts` (Zeile mit `toBeInViewport`) | auf dem Handy rot; im Pixel-7-Projekt des Gates nicht erneut geprüft |

## Eingrenzung

`e2e/specs/code.spec.ts:34`. Ob das Feld aus dem Scrollbereich geschoben
wurde oder die Höhe 0 hat, ist offen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] behoben (2026-10-09)

## Behoben

`SessionTail` hat bei jeder Höhenänderung den Scrollbereich nach unten
gesetzt, auch auf dem Code-Reiter. Zusätzlich klebt `.code-search` am
oberen Rand des Scrollbereichs, damit „Ausführen“ das Feld nicht aus dem
Bild schiebt. `e2e/specs/code.spec.ts` setzt dafür 390×480.

Nach dem Fix grün: Mobile-Projekt und Pixel 9 Pro XL im Hochformat
(`npm run test:phone -- e2e/specs/code.spec.ts`, 2 bestanden).
