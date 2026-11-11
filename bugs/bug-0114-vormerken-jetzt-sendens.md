---
id: BUG-0114
slug: vormerken-jetzt-sendens
status: in-progress
severity: S3
area: pwa
instance: dev
commit: "58a79b0"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/49"
epic: EPIC-P15
created: 2026-11-11
reporter: Jan
---

# BUG-0114 — Vorgemerkte Nachricht lässt sich nicht sofort in den laufenden Zug senden

## Gesehen

Eine vorgemerkte Nachricht kann nur gestrichen werden — es gibt keine
Möglichkeit, sie direkt in die laufende Konversation zu senden (z. B. für
Zwischenfragen), obwohl der Zug noch läuft.

## Erwartet

Neben dem ✕ der Vormerk-Liste gibt es je Eintrag eine Aktion „Jetzt senden",
die den Prompt sofort in den laufenden Zug steuert (Mid-Turn-Steer, wie ihn
der Hub ohne `queue`-Flag ohnehin kann). Wird er abgelehnt, bleibt die
Nachricht vorgemerkt und der Grund wird sichtbar (Fail loud, kein
Textverlust).

## Repro

Voraussetzung: Hub läuft, Session mit laufendem Zug (PWA, Adapter mit
`followUp`, z. B. claude).

1. Session öffnen, während der Zug läuft in das Antwortfeld „kurze
   Zwischenfrage" tippen.
2. „Vormerken" drücken — die Liste zeigt:
   „Vorgemerkt (1) — geht raus, sobald der Zug endet".
3. Den einzigen Knopf am Eintrag prüfen.

**Ergebnis nach Schritt 3:** Einzige Aktion ist ✕ („streichen",
`QueueList.tsx:33`). Ein „Jetzt senden" existiert nicht; serverseitig gibt
es nur `GET /queue` und `DELETE /queue/:id`
(`apps/hub/src/modules/sessions/sessions.routes.ts:301-313`).

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `58a79b0` |
| Node-Version | 22.5 (Repo-Standard) |
| Adapter | alle mit `followUp` (z. B. claude) |
| Repro-Weg | PWA (Nutzerbericht Jan, 11.11.2026) |

## Logs

Kein Fehlerlog — es fehlt die Aktion, nichts schlägt fehl. UI-Zustand:

```text
Vorgemerkt (1) — geht raus, sobald der Zug endet
1. kurze Zwischenfrage            ✕
```

## Tests

| Ring | Befundl. Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/modules/sessions/session-queue.test.ts` | nicht vorhanden |
| Route | `apps/hub/test/modules/sessions/queue.test.ts` | nicht vorhanden |
| E2E | `e2e/specs/pause-queue.spec.ts` | nicht vorhanden |

Ohne Fix rot: Unit („sofort in den laufenden Zug senden", „Ablehnung stellt
die Vormerkung wieder her") und Route (`POST /queue/:id/send` → 404), E2E
(„Jetzt senden"-Knopf existiert nicht).

## Eingrenzung

- `apps/pwa/src/features/session/QueueList.tsx:26-39` — nur Streichen.
- `apps/hub/src/modules/sessions/sessions.routes.ts:301-313` — nur
  GET/DELETE.
- `packages/core/src/modules/sessions/session-manager.ts:2620-2679` — Drain
  nur am Zugende (`scheduleDrain`/`drainSlot`); kein gezielter Sofort-Versand.
- Mid-Turn-Steer ist hub-seitig erlaubt (`refuseSteer` prüft nur
  `features.followUp`, `packages/core/src/modules/harness/features.ts:23`);
  die Vormerk-Reihenfolge war UX-Entscheidung aus EPIC-P15 T15.3.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix`
