---
id: BUG-0083
slug: pwa-freeze-securesight-anbindungsformular
status: done
severity: S1
area: pwa
instance: dev
commit: "6a272af"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/287"
epic: ""
created: 2026-11-01
reporter: "Nutzer"
---

# BUG-0083 — securesight-Anbindungsformular friert die PWA ein („App abgestürzt" bei Provider-Wahl Z.ai)

- **Gemeldet:** 2026-11-01, Nutzer (Handy, echter Hub, Loop securesight-factory, Anbindung „+neu")
- **Status:** gefixt ([MR !287](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/287))
- **Komponente:** PWA `apps/pwa/src/features/loops/loop-form.ts` + `LoopPicker.tsx`

## Beobachtet

„Die App ist abgestürzt, als ich den Provider z.ai für die securesight-factory
ausgewählt habe." Die PWA reagierte nicht mehr; auf dem Handy wurde der Tab
beendet. Im Hub-Journal enden die Client-Polls exakt zu diesem Zeitpunkt
(10:24:06), der Hub-Prozess selbst lief weiter.

## Repro

1. Hub mit Loop `securesight-factory` (Modell-Auswahl vorhanden, Commit `6a272af`).
2. PWA: „Neue Session" → Loop `securesight-factory` → Anbindung `+neu`.
3. Formular ist sichtbar, Start-Knopf aktiv — aber der Hauptthread hängt
   bereits in einem endlosen Render-Loop (jede Interaktion tut nichts).
4. Provider „Z.ai" wählen → augenfälliger Freeze/Absturz.

**Häufigkeit:** immer (Formular „+neu" der securesight-factory).

E2E rot vor dem Fix: `e2e/specs/securesight-onboard.spec.ts` —
`selectOption("zai")` wird nie actionierbar, `waitForFunction` schlägt an.

## Root-cause

`apps/pwa/src/features/loops/loop-form.ts` (`onboardSelectDefaults`): Die
Funktion patcht Selects ohne Zustand mit ihrer ersten Wahl. Das Feld „Modell"
(securesight, Nutzerwunsch 2026-10-30) hat als erste Choice den Wert `""`
(„Standard-Routing der Factory"). Der Patch `modell: ""` ist inhaltlich leer,
erzeugt aber ein **neues Objekt** → der Effect in `LoopPicker.tsx` setzt bei
jedem Render neuen Zustand → Render → Effect → … endlos. Keine Ausnahme, kein
`pageerror` — nur ein eingefrorener Hauptthread; daher fiel es im E2E nicht
als Exception, sondern als Actionability-Timeout auf.

Der Fake-Loop des Testkits hat keine leere erste Choice, deshalb deckten die
bestehenden Specs (`loops.spec.ts`, 2026-10-30) den Fall nicht.

## Fix

`onboardSelectDefaults` überspringt erste Wahlen ohne Inhalt
(`first?.trim()`): Eine leere Vorgabe trägt nichts bei — das Select zeigt sie
per `?? f.choices?.[0]?.value` ohnehin an, der Zustand bleibt leer, und der
Effect findet einen Fixpunkt (gleiches Objekt → kein setState).

## Tests

| Ring | Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/loops/loop-form.test.ts` („leere erste Wahl … Fixpunkt") | rot (neues Objekt + `modell: ""` im Zustand) |
| E2E | `e2e/specs/securesight-onboard.spec.ts` (Freeze + Provider/Modell wählbar) | rot (Timeout bei Provider-Wahl) |

## Verwandt

- BUG-0081 (Select-Vorgaben gelten als gewählt) — der dort eingeführte Effect
  ist der Verstärker; die leere erste Wahl kam mit dem Modell-Feld dazu.
