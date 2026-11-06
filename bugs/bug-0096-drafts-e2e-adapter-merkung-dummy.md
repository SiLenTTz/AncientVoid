---
id: BUG-0096
slug: drafts-e2e-adapter-merkung-dummy
status: done
severity: S3
area: pwa
instance: ci
commit: "b73ead88"
epic: "P28 T28.3 (Nachtrag fix 2026-11-06)"
created: 2026-11-06
reporter: "P28-Umsetzung"
---

# BUG-0096 — Neue-Session-Formular zeigt gemerkten Adapter als „dummy“

## Gesehen

`e2e/specs/drafts.spec.ts:79` › „Neue Session merkt sich Harness und Projekt
und hält den Start-Prompt als Entwurf“ (mobile) rot im Lauf
[3034417565](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034417565)
(Job 17790867393): Nach einer erfolgreich gestarteten opencode-Session
(topbar-Assert grün) zeigte das erneut geöffnete Neue-Session-Formular den
Adapter dauerhaft als „dummy“ statt der Merkung „opencode“ (23× über 10 s).
Einmaliges Auftreten in 5 Runner-Läufen.

## Erwartet

Das Formular belegt den Adapter mit dem zuletzt gestarteten
(`ancientvoid.newSession.last`), sobald die Informationen vorliegen.

## Repro

Unit-Test `initial-adapter.test.ts`: Merkung gesetzt, Adapterliste beim
Mount leer (async Abrif läuft noch). Die alte Initial-Logik
`last.adapter && adapters.some(...) ? last.adapter : "dummy"` liefert hier
„dummy“; der Nachlade-Effekt korrigierte nie, weil „dummy“ ein gültiger
Eintrag der später ankommenden Liste ist.

## Ursache (root cause)

`apps/pwa/src/features/new-session/CreateSession.tsx` — der Initial-State
des Adapters verlangte, dass die Adapterliste die Merkung schon beim Mount
enthält. Bei leerer Liste (langsamer /api-…-Abruf unter CI-Last) fiel der
Start auf den Fallback, und der `useEffect([adapters])` hielt ihn für
korrekt, weil der Fallback selbst in der Liste steht. Die Aktionen im
Playwright-Trace (2× selectOption „opencode“, Starten, Navigation, erneutes
Öffnen) schließen die übrigen Verdachtspfade ein.

## Fix

`initialAdapter(last, adapters)`: Die Merkung ist die stärkste Quelle —
`last?.adapter ?? adapters[0]?.id ?? "dummy"`. Fällt die Liste später mit
einem anderen Angebot ein (anderer Host), korrigiert der bestehende
Nachlade-Effekt wie bisher. Kein Verhalten für geladene Listen geändert.

## Nachweis

Unit-Test rot ohne Fix (Funktion/Fall existierte nicht bzw. lieferte
„dummy“), grün mit Fix; drafts-E2E und voller Satz im MR.
