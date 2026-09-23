---
id: BUG-0028
slug: tokens-in-request-log
status: fixed
severity: S1
area: server
instance: dev
commit: ""
forge: ""
epic: "EPIC-P6 AC-P6-2 (keine Credentials im Log)"
created: 2026-09-23
reporter: "Claude Opus 5.5 (Prüfung AC-P6-2)"
---

# BUG-0028 — Geräte-Tokens stehen im Klartext im Request-Log

## Gesehen

`/tmp/uacc-hub.log` des echten Hubs enthielt 14 Einträge der Form
`"url":"/api/events/<id>/tail?token=<Geräte-Token>"`. WebSocket-Clients
(PWA, `hubctl tail`, jetzt auch die Flotten-Weiterleitung) melden sich per
`?token=` an; Fastifys Standard-Serializer loggt die URL unverändert. Die
Redaction griff nur auf Header und Objekt-Schlüssel.

## Erwartet

Kein Token in Logs (AC-P6-2, `docs/security.md`).

## Repro

Hub mit `UACC_LOG=info`, Session öffnen → Log enthält `?token=…`.

**Häufigkeit:** bei jedem Öffnen einer Session.

## Eingrenzung

`packages/server/src/index.ts`, Fastify-`logger` ohne `req`-Serializer.

## Fix

Eigener `req`-Serializer: `redactUrl()` ersetzt `token`/`access_token` im
Query durch `[redacted]`.

**Nachsorge beim Nutzer:** vorhandene Logs (`/tmp/uacc-hub.log`) enthalten
alte Tokens — Log leeren und die betroffenen Geräte-Tokens rotieren
(`hubctl token revoke <label>`, neu ausstellen).

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| Integration | `packages/server/test/log-redaction.test.ts` | rot (Token im Log) | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
