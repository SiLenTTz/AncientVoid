---
id: BUG-0046
slug: thinking-block-leer-und-aufklappbar
status: done
severity: S3
area: adapters, pwa
instance: prod
commit: ""
forge: ""
epic: "P1"
created: 2026-10-09
reporter: jan
---

# BUG-0046 — Aufgeklappte „thinking“-Blöcke sind immer leer

## Gesehen

In der Mobile-Hub-App zeigt jeder aufgeklappte `thinking`-Eintrag nur
`{ "text": "" }` (Beispiel: `#2387 · thinking`, 08:00:16, mit „Kopieren“). Die
Zusammenfassung der Zeile ist ebenfalls leer.

## Erwartet

Wenn der Anbieter den Denk-Text nicht liefert, sagt die Oberfläche das in einer
Zeile — kein aufklappbarer leerer Block, kein Kopieren-Knopf, kein leeres JSON.

## Repro

1. Claude-Session (Sonnet 5.5) starten, eine Aufgabe, die Nachdenken auslöst.
2. Verlauf öffnen, den `thinking`-Eintrag antippen.

**Ergebnis nach Schritt 2:** `{ "text": "" }`.

**Häufigkeit:** immer, wenn die API den Block redigiert liefert.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub, Handy-PWA |
| Commit | `2d1b5a3`-Linie (main nach P15 T15.3) |
| Adapter | claude (2.1.288), claude-clip |
| Repro-Weg | PWA, direkter CLI-Test |

## Logs

Direkter Test mit der echten CLI (`--model sonnet --effort high`, auch mit
`--settings '{"showThinkingSummaries":true}'`): der Block kommt als
`thinking: ""` mit `signature` — die Anthropic-API gibt den Text nicht heraus.
Es gibt keine CLI-Option, die ihn liefert.

```text
THINKING len= 0 sig= True text= ''
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/claude/test/normalize.test.ts` „BUG-0046“ | rot ohne Fix |
| Unit | `packages/adapters/claude-clip/test/normalize.test.ts` „BUG-0046“ | rot ohne Fix |
| Unit | `apps/pwa/test/features/session/event-filter.test.ts` „BUG-0046“ | rot ohne Fix |
| E2E | `e2e/specs/thinking-leer.spec.ts` | — |

## Eingrenzung

Der Adapter bildete den leeren Block 1:1 ab: `summary` war `""` (der Fallback
`"(thinking)"` griff nicht, weil `""` kein `undefined` ist) und `payload.text` leer.
`EventRow.tsx` machte daraus einen aufklappbaren Eintrag mit Kopieren-Knopf.
Fix: der Adapter setzt eine erklärende Zusammenfassung und `redacted: true`;
`isEmptyThinking` (auch für schon gespeicherte Events) macht die Zeile in der App
ruhig und nimmt sie aus dem Chat.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
