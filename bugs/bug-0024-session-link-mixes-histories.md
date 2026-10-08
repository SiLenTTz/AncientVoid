---
id: BUG-0024
slug: session-link-mixes-histories
status: done
severity: S2
area: pwa
instance: dev
commit: ""
forge: ""
epic: "EPIC-P5 AC-P5-5 (Deep-Link)"
created: 2026-09-23
reporter: "Claude Opus 5.5 (E2E-Gate, session.spec.ts)"
---

# BUG-0024 — Ein Link auf eine andere Session mischt beide Verläufe

## Gesehen

Session A ist offen. Ein Link `#/sessions/<B>` wird geöffnet (eingefügt,
aus einer Nachricht). Die Ansicht zeigt B im Kopf, im Verlauf aber A und B
gemischt (A mit seq 1–17, danach B mit seq 1–17).

## Erwartet

Nur der Verlauf von B; Filter, Entwurf und Tabs frisch.

## Repro

`e2e/specs/session.spec.ts` „ein Link auf eine andere Session“: A öffnen,
`location.hash` auf B setzen → Antwort von A bleibt sichtbar.

**Häufigkeit:** immer bei Wechsel Session → Session ohne Umweg über die
Übersicht.

## Eingrenzung

`packages/pwa/src/main.tsx`: `SessionTail` wurde bei neuem `session`-Prop
wiederverwendet; sein `events`-State hängt nicht an der ID.

## Fix

`<SessionTail key={route.session.id} …>` baut die Ansicht pro Session neu auf.

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| E2E | `e2e/specs/session.spec.ts` „andere Session“ | rot (Timeout, A sichtbar) | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
