---
id: BUG-0212
slug: terminal-stream-401-auth-hook
status: done
severity: S2
area: server
instance: dev
commit: "1ca58f3e"
forge: ""
epic: "ADR-0087 (betroffenes Feature)"
created: 2026-11-18
reporter: Nutzer (Terminal-Ziel-Auswahl „funktioniert nicht", 18.11.2026)
---

# BUG-0212 — Terminal-Stream wird vom authHook mit 401 abgewiesen: Verbinden scheitert für jedes Ziel

## Gesehen

Im PWA-Terminal-Tab lässt sich ein Ziel auswählen, aber „Verbinden"
scheitert immer mit „WebSocket-Fehler" — für jedes Ziel der Allowlist,
sowohl `local` als auch `ssh`. Aus Nutzersicht ist damit die Auswahl des
Hosts, auf dem ein Terminal geöffnet wird, wirkungslos.

## Erwartet

Der WebSocket-Upgrade auf `GET /api/terminals/:id/stream` kommt zustande
(ADR-0087: „Ticket-WS wie STT"); das kurzlebige Ticket authentifiziert die
Verbindung, die Shell öffnet sich auf dem gewählten Ziel.

## Repro

Voraussetzung: Hub mit mindestens einem `terminals[]`-Eintrag.

1. PWA öffnen → „Mehr" → „Terminal".
2. Ziel belassen (oder wechseln), „Verbinden" drücken.

**Ergebnis nach Schritt 2:** Statuszeile „Fehler", Meldung
„WebSocket-Fehler"; im Hub-Log steht für den Upgrade ein 401
`missing device token`.

**Häufigkeit:** immer (seit PR #125)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) und E2E-Fixture-Hub |
| Commit | `1f4def8f` (PR #125, gemerged als `8c2879e4`) |
| Node-Version | 26 |
| Adapter | — (Feature unabhängig) |
| Repro-Weg | PWA / E2E `e2e/specs/terminal.spec.ts` |

## Logs

```text
{"req":{"method":"GET","url":"/api/terminals/hub/stream?ticket=[redacted]&cols=80&rows=24"},
 "res":{"statusCode":401},"msg":"request completed"}
[hub] WS error: Unexpected server response: 401
```

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/terminal.spec.ts` „Verbinden öffnet eine lokale Shell" | **rot** (seit PR #125; Commit-Nachricht: „E2E terminal.spec.ts noch nicht lokal gefahren") |
| Unit/Route | `apps/hub/test/modules/terminal/terminal.test.ts` | grün — prüfte nur Liste/Ticket per `inject`, nie den Stream-Upgrade |

Neue Tests (mit Fix grün, ohne Fix rot):

- `apps/hub/test/modules/terminal/terminal.test.ts` — „Stream: Ticket-WS
  kommt durch die Auth (Browser sends no Bearer)" und „Stream: abgelaufenes/
  falsches Ticket wird abgewiesen" (echtes `listen` + `ws`-Client).
- `e2e/specs/terminal.spec.ts` — „gewähltes Ziel bekommt das Ticket
  (Auswahl wirkt)" mit zwei Zielen (Deckungslücke: Auswahl wurde nie mit
  mehr als einem Ziel getestet).

## Eingrenzung

`apps/hub/src/platform/auth.ts:78-99` — der `authHook` exemptiert
`/api/stt/stream` (Ticket-Muster), aber nicht
`/api/terminals/:id/stream`. Ein Browser-WebSocket kann keinen
`Authorization`-Header tragen; `extractToken` findet kein `?token=`, also
401 noch vor der Ticket-Prüfung der Route
(`apps/hub/src/modules/terminal/terminal.routes.ts:115-127`), die sonst
alles Ungültige mit 4401 abweist. Das wiederverwendbare Device-Token in
die URL zu stecken wäre der falsche Fix (BUG-0028).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (folgt mit dem PR)
- [x] `bugfix` (Fix: `authHook` exemptiert `GET /api/terminals/:id/stream`
      per `TERMINAL_STREAM_PATH` wie STT; Route prüft ihr Ticket selbst)
