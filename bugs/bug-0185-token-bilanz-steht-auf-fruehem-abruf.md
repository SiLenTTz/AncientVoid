---
id: BUG-0185
slug: token-bilanz-steht-auf-fruehem-abruf
status: done
severity: S2
area: pwa
instance: e2e
commit: ""
forge: ""
epic: ""
created: 2026-11-16
reporter: nightly (Issues #54–#57)
---

# BUG-0185 — Die Token-Bilanz der Statuszeile bleibt auf ihrem frühesten Abruf stehen

## Gesehen

Nightly-Lauf 43953373012 auf main `fc4f513c` (16.11.2026, nach den Merges
#48/#40/#52): drei E2E-Shards rot, automatisch als Issues #54–#57 erfasst.

- `harness.spec.ts:289` (ACP-Freigabe): erwartet
  `12 Tokens erzeugt · 42 Tokens verarbeitet · Kontext 15 % · frei 170 von 200`,
  gesehen nur `Kontext 15 % · frei 170 von 200`.
- `progress.spec.ts:85` (Kontingent): `.status-line .run-tokens` existierte
  nicht (Element fehlte komplett).

## Ursache (gemessen, nicht geraten)

Debug-Mitschnitt im laufenden E2E (Daten-Attribut am run-strip):

```json
{"totals":{"generated":null,"processed":null,"usageEvents":0,"lastSeq":10},
 "tokensKnown":true,"recordTokensEst":42,"metricsTokens":"native"}
```

Die Route selbst war korrekt (`hub.api` direkt: `generated:12, processed:42`,
`lastSeq:18`), aber der Browser-Abruf lief bei `lastSeq:10` — **vor dem
Zug-Ende**, als der Store noch keine Usage hatte. Geholt wurde:

1. einmal beim Mount der Session-Ansicht,
2. alle 10 s, aber **nur solange `status === "working"`** (SessionTail.tsx).

Der Ablauf „Session öffnen (waiting_approval) → Erlauben → Zug endet in <10 s →
idle“ überquert nie ein Intervall-Tick. Der letzte Abruf bleibt der von
vor dem Zug — `totals` ist nicht null (also greift der `processedFallback`
nicht, er wird nur bei `totals === null` benutzt), sondern ein Objekt mit
zwei null-Zahlen. `tokenParts()` liefert leer, bei fehlender Kontextzeile
rendert die Statuszeile gar nicht (`progress.spec`).

Der Cursor-Fall (harness.spec.ts:34) ging grün durch, weil sein Zug vor dem
Mount der Ansicht fertig war — der erste Abruf sah also schon die finalen
Zahlen. Deshalb fiel es im PR-Gate nicht auf: Der fährt kein E2E, und der
lokale Volllauf der letzten Session lief auf dem Fold-Branch **ohne** die
Token-Änderungen.

Dasselbe gilt für BUG-0184s Dokumentzeile S20: das Funktionsinventar verlangt
genau einen Nachweis pro Zeile, der Token-PR schrieb `inventar, spec:harness.spec.ts`
— der Inventar-Abgleich (`funktionsinventar.spec.ts:248`) wurde dadurch rot
(Shards 1 und 4).

## Reproduktion

```bash
npx playwright test e2e/specs/harness.spec.ts:289 --project=mobile   # rot auf fc4f513c
```

## Fix

- `SessionTail.tsx`: `status` in die Deps des Token-Bilanz-Abrufs — jede
  Status-Transition (insbesondere working → idle) holt die finale Bilanz
  nach. Pro Zug ~2 Abrufe statt pro Ereignis (K2 bleibt gewahrt).
- `docs/funktionsinventar.md`: S20-Nachweis zurück auf `inventar` (die Zeile
  ist Teil des Inventar-Specs selbst; ein zweiter Nachweis ist laut Validator
  nicht vorgesehen).

## Bewiesen

- rot auf `fc4f513c`, grün nach Fix:
  `harness.spec.ts:289` + `progress.spec.ts:85` (mobile) und
  `funktionsinventar.spec.ts:248` (desktop).
- `npm run lint` 0, `npm run typecheck` 0, `npm run check:context` OK.
