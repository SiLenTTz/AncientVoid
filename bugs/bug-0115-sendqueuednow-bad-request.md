---
id: BUG-0115
slug: sendqueuednow-bad-request
status: in-progress
severity: S3
area: pwa
instance: dev
commit: "e806f1b"
forge: ""
epic: ""
created: 2026-11-11
reporter: Gate-Lauf (Agent)
fixed: ""
---

# BUG-0115 — „Jetzt senden" der Vormerkung schlägt in der PWA immer mit „Bad Request" fehl

## Gesehen

Klick auf ➤ („Jetzt senden") einer vorgemerkten Nachricht während eines
laufenden Zugs: Die Nachricht bleibt vorgemerkt, die Fehlerzeile zeigt
„Bad Request — die Nachricht bleibt vorgemerkt." Der POST erreicht die
Hub-Route nicht.

## Erwartet

Der Prompt wird sofort in den laufenden Zug gesteuert (BUG-0114) oder wird
mit echtem Ablehnungsgrund zurückgestellt.

## Repro

Voraussetzung: E2E-Hub, Session mit laufendem Zug (`LANGSAM`), claude.

1. Vormerken einer Nachricht („Vorgemerkt (1) …").
2. ➤ „Jetzt senden" klicken.

**Ergebnis nach Schritt 2:** Fehlerzeile „Bad Request — die Nachricht
bleibt vorgemerkt."; Queue-Liste bleibt stehen.

**Häufigkeit:** immer (nur über die PWA; `app.inject`-Integrationstests
sind grün, weil sie keinen `content-type`-Header mitschicken)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E-Hub, Playwright Chromium) |
| Commit | `e806f1b` (main; Fix aus MR !367 enthalten) |
| Adapter | claude (jeder) |
| Repro-Weg | E2E `e2e/specs/pause-queue.spec.ts:43` (Gate-Lauf 11.11.2026, 454 ✓ / 1 ✗) |

## Logs

Auszug aus dem Page-Snapshot des fehlgeschlagenen Tests:

```text
- generic "Vorgemerkt" [ref=e68]:
  - generic [ref=e69]: Vorgemerkt (1) — geht raus, sobald der Zug endet
  - alert [ref=e70]: Bad Request — die Nachricht bleibt vorgemerkt.
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/pause-queue.spec.ts` (BUG-0114-Test, Zeile 43) | **rot** (Sauberer Gate-Nachlauf auf main, 11.11.2026) |
| Route | `apps/hub/test/modules/sessions/queue.test.ts` | grün (inject ohne content-type — deckt den Fehler nicht) |
| Unit | `packages/core/test/modules/sessions/session-queue.test.ts` | grün |

## Eingrenzung

`apps/pwa/src/shared/api.ts`: Der generische `api()`-Helfer setzt bei jedem
Request `content-type: application/json` (`api.ts:771-779`). `sendQueuedNow`
(`api.ts:1256`) sendet POST **ohne Body** → Fastify lehnt den leeren
„JSON"-Body mit 400 ab, bevor `POST /api/sessions/:id/queue/:id/send`
erreicht wird. Core (`sendQueuedNow`) und Route sind korrekt — der Defekt
ist der leere Body mit JSON-Content-Type.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [x] `bugfix`
