---
id: BUG-0149
slug: cursor-kontingent-unsichtbar
status: done
severity: S2
area: adapter-cursor
instance: lokal
commit: ""
forge: ""
epic: ""
created: 2026-11-13
reporter: "Nutzer (Session 47c9ece3)"
---

# BUG-0149 — Cursor-Kontingent lässt die Session auf „arbeitet“ hängen

## Gesehen

Session `47c9ece3` (cursor, Opus) stand auf `working`, ohne laufenden Prozess
und ohne erkennbare Ursache. Im Journal lag `cursor.usage_limit`
(„You've hit your usage limit for Opus … ends on 12/5/2026“), danach
`session.interrupted` und ein promptloses `session.resumed` (Akteur `pc`).
Die Lesen-Ansicht und die Übergabe-Leiste haben das nicht gezeigt.

## Erwartet

Das Kontingent ist ein `provider.error` der Kategorie `quota`: der Zug endet
auf `error`, der Text steht in der Lesen-Ansicht, die Leiste bietet die
Übergabe. Ein promptloses Weitermachen setzt keine Session dauerhaft auf
`working`, wenn kein Worker startet. `error` und `interrupted` lassen sich
parken, damit die Quelle bei der Übergabe stillsteht.

## Repro

Voraussetzung: Hub, Cursor-Session, Opus-Kontingent erschöpft.

1. Prompt senden.
2. Die CLI schreibt `ActionRequiredError: You've hit your usage limit` und
   endet mit Code 1.
3. In der PWA „Weitermachen“.

**Ergebnis vor dem Fix:** Status bleibt `working`, keine Leiste.

**Häufigkeit:** immer, sobald das Konto-Limit die Zeile schreibt.

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| Unit | `contracts/test/harness/provider-error.test.ts` | Text blieb `unknown` |
| Unit | `adapter-cursor/test/adapter.test.ts` | nur `cursor.usage_limit` |
| Unit | `core/test/modules/handover/handover.test.ts` | Park von `error` unzulässig, Grund leer |
| Unit | `core/test/modules/sessions/interrupted-session.integration.test.ts` | promptloses Resume bleibt `working` |
| Unit | `pwa/test/features/session/handover.test.ts` | Leiste leer nach `session.resumed` |
