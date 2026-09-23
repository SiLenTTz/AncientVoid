---
id: BUG-0026
slug: tail-opens-with-oldest-100
status: fixed
severity: S1
area: server, pwa
instance: dev
commit: ""
forge: ""
epic: "EPIC-P5 AC-P5-2/AC-P5-5, gefunden im Handtest 2026-09-23"
created: 2026-09-23
reporter: "Nutzer (Handtest), eingegrenzt von Claude Opus 5.5"
---

# BUG-0026 — Eine geöffnete Session zeigt nur ihre ersten 100 Events

## Gesehen

Lauf 821b0ec8 (OpenCode, 107 Events): Status `idle`, letzte Nachricht im
Chat „OpenCode denkt…“ (seq 100). Die Abschlussnachricht (seq 105) war im
Hub gespeichert, kam im Browser aber nie an.

## Erwartet

Beim Öffnen steht das Ende da; ältere Events so weit, wie die PWA hält.

## Repro

Session mit mehr als 100 Events, danach öffnen. Browser-Probe gegen den
echten Hub: `.event[data-seq]` endet bei 100.

**Häufigkeit:** immer ab 101 Events — also bei fast jedem echten Lauf.

## Eingrenzung

`packages/server/src/ws.ts`: `hello` (lastSeq 0) schickte `tail(0, 100)` —
die **ältesten** 100 — und sonst nichts. `hello` mit lastSeq > 0 schickte gar
nichts nach, `resync` nur eine Seite.

## Fix

`replay(from)` schickt seitenweise bis zum Ende und hält Live-Events so lange
zurück. Beim Öffnen: die neuesten `WS_HISTORY_EVENTS` (500), erste Seite mit
`baseline: true`, damit der Client ab dort zählt statt Resync. Reconnect holt
alles nach `lastSeq`.

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| Integration | `packages/server/test/ws-history.test.ts` (3 Fälle) | rot (100) | grün |
| Unit | `packages/pwa/test/ws-client.test.ts` „baseline“ | — | grün |
| E2E | `e2e/specs/session.spec.ts` „lange Session“ | rot | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
