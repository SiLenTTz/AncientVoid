---
id: BUG-0048
slug: freigabe-noetig-haengt-nach-neustart
status: done
severity: S2
area: core
instance: prod
commit: ""
forge: ""
epic: "P7"
created: 2026-10-09
reporter: jan
---

# BUG-0048 — „Freigabe nötig“ bleibt stehen, obwohl nichts zu entscheiden ist

## Gesehen

Nach einem Hub-Neustart mitten in einer Tool-Freigabe stand die Session (diese hier) in der
Datenbank auf `waiting_approval`, mit **null** offenen Freigaben. Die Übersicht zeigt sie dann unter
„Braucht dich“ mit „Freigabe nötig“, obwohl nichts anliegt. Der Status wurde nur verlassen, wenn der
Abruf der Bridge die Antwort abholt oder der Zug endet; kam die Antwort während der Recovery (12 s,
in der die Session noch nicht lebt), ging sie verloren.

## Erwartet

`waiting_approval` gilt nur, solange eine Tool-Freigabe offen ist. Gibt es keine mehr, geht die
Session bei Aktivität des Providers zurück auf `working`, nach einer Recovery ohne laufenden Zug auf
`idle`.

## Repro

1. Session mit Tool-Freigabe auslösen, Hub während der offenen Freigabe neu starten.
2. Nach der Recovery den Status lesen.

**Ergebnis nach Schritt 2:** `waiting_approval`, `approvals` ohne `pending`.

**Häufigkeit:** immer bei einem Neustart, der in eine Freigabe fällt.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub |
| Commit | `e5a7130` |
| Repro-Weg | Datenbank (`sessions.status`), Unit-Test |

## Logs

```text
diese Session: {"status":"waiting_approval", ...}   offene Freigaben: []
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Integration | `packages/core/test/modules/sessions/waiting-approval-heal.test.ts` (3) | Recovery-Fall rot ohne Fix |

## Eingrenzung

`session-manager.ts`: Es gab keinen Weg zurück aus `waiting_approval` ohne den Abruf der Bridge.
Fix: `healWaitingApproval` — bei Provider-Aktivität (assistant, tool_use, tool_result, thinking)
und nach der Recovery; eine wirklich offene Tool-Freigabe hält den Status.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
