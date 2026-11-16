---
id: BUG-0045
slug: einzelner-abruffehler-laesst-ui-flackern
status: done
severity: S3
area: pwa
instance: prod
commit: ""
forge: ""
epic: "P8"
created: 2026-10-09
reporter: jan
---

# BUG-0045 — Ein einzelner fehlgeschlagener Abruf lässt Meldungen aufflackern

## Gesehen

„Ab und zu flackert eine Meldung auf“ und die Ansicht springt. Ursache im Code:
`App.tsx` zeigt nach **einem** fehlgeschlagenen 3-s-Abruf sofort die rote
Fehlerkarte (`.load-error`) oberhalb der Liste und blendet sie nach dem nächsten
Erfolg wieder aus — die ganze Seite rutscht dabei nach unten und zurück. Ebenso
setzte ein fehlgeschlagener Freigaben-Abruf den Zähler auf 0 (Banner weg) und
`SessionApprovals` leerte seine Karten und baute sie alle 2 s neu auf.

## Erwartet

Ein einzelner Abruffehler ändert nichts Sichtbares. Erst der zweite in Folge
zeigt die Fehlerkarte; der letzte bekannte Stand (Banner, Karten) bleibt stehen.

## Repro

1. PWA öffnen, jeden zweiten Abruf von `/api/adapters` (bzw. der Freigaben) abbrechen.
2. 6 Abrufe lang beobachten.

**Ergebnis nach Schritt 2:** Fehlerkarte erscheint 2-mal, Banner verschwindet 3-mal.

**Häufigkeit:** bei jedem kurzen Netzaussetzer (Handy, Tailscale-Wechsel).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub, Handy-PWA |
| Commit | `a1ebc9d` + BUG-0043/0044 |
| Repro-Weg | E2E (Playwright, `route.abort`) |

## Logs

```text
Expected: 0   Received: 2   (Fehlerkarte erschienen)
Expected: 0   Received: 3   (Banner verschwunden)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/flackern.spec.ts` (2 Tests) | beide rot ohne Fix |

## Eingrenzung

`apps/pwa/src/app/App.tsx` (`tick`: `setError` bei jedem Fehler,
`setPendingApprovals(0)` im catch), `apps/pwa/src/features/session/SessionApprovals.tsx`
(`setItems([])` im catch, neuer State bei jeder Antwort). Fix: `failedPolls`-Zähler
(Fehlerkarte ab dem zweiten Fehler in Folge), letzter Stand bleibt bei Fehlern
(nur 501 „nicht konfiguriert“ ist ein echtes Null), unveränderte Listen setzen
keinen neuen State.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
