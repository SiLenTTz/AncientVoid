---
id: BUG-0047
slug: pc-tippen-leert-text-vor-dem-ergebnis
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: ""
epic: "P11"
created: 2026-10-09
reporter: jan
---

# BUG-0047 — „Am PC eintippen“ leert den Text, bevor der PC getippt hat

## Gesehen

Das E2E-Gate schlug zweimal bei `desktop.spec.ts:36` fehl (jeweils nur im Volllauf, im
Einzellauf und bei 36 Wiederholungen nie): Am Ende blieb „Eintippen“ deaktiviert. Ursache:
`DesktopPage.send()` rief nach dem Anlegen der Aktion sofort `setText("")` auf. Lehnt der PC
die Aktion danach ab (Fokus hat gewechselt — genau dafür ist die Prüfung da), war der Text der
Person weg, obwohl nichts getippt wurde. Ob der Hub die Aktion schon vorher abwies (Text bleibt)
oder erst der Companion (Text weg), hing vom Timing der Fokus-Meldung ab.

## Erwartet

Der Text verschwindet erst, wenn die Aktion `done` ist. Bei `refused`, `failed`, `expired` o. ä.
bleibt er stehen, damit nichts neu getippt werden muss.

## Repro

1. „PC“ öffnen, Text eingeben, „Gezielt einfügen“ einschalten.
2. Am PC den Fokus wechseln, genau zwischen Anzeige und Tipp auf „Eintippen“.
3. Der Companion lehnt ab.

**Ergebnis nach Schritt 3:** das Textfeld ist leer, es wurde nichts getippt.

**Häufigkeit:** timingabhängig (zwei Fehlschläge in vier Volllaufen des Gates).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | E2E (Playwright, Pixel 7) |
| Commit | `ba404d2`-Linie |
| Repro-Weg | E2E, Volllauf |

## Logs

```text
Expect "toBeEnabled" getByRole('button', { name: 'Eintippen' }) — unexpected value "disabled"
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/desktop.spec.ts` (Fokuswechsel-Schritt: Text bleibt) | Fehlschlag nur im Volllauf beobachtet; **kein deterministischer Rot-Beweis** |

## Eingrenzung

`apps/pwa/src/features/desktop/DesktopPage.tsx`: `setText("")` im Erfolgspfad von `send()`.
Fix: `sent`-Ref merkt die Aktion; ein Effekt leert den Text erst bei Status `done` und nur,
wenn er noch dem gesendeten entspricht (zwischenzeitlich Weitergetipptes bleibt).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
