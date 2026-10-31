---
id: BUG-0062
slug: eta-waechst-bei-altem-plan
status: done
severity: S3
area: pwa
instance: dev
commit: "995f2df"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/17"
epic: ""
created: 2026-10-21
reporter: nutzer (Handy)
---

# BUG-0062 — Restzeit-Schätzung wächst, statt zu schrumpfen

## Gesehen

Im Run-Strip einer laufenden Session zeigt „noch ca. …“ eine Restzeit, die **weiter wächst**, je länger der Agent arbeitet, obwohl jede vergangene Minute die Fertigstellung näher bringt — bis der nächste Plan-Update die Zahl wild springen lässt.

## Erwartet

Die Restzeit fällt oder bleibt konstant; sie basiert auf der gemessenen Plan-Geschwindigkeit (Todo-Snapshots mit Zeitstempel), nicht auf einer eingefrorenen Quote multipliziert mit der Laufzeit.

## Repro

Voraussetzung: laufende Session mit Plan (Todo-Liste), Agent aktualisiert die Liste eine Weile nicht (normal — er arbeitet).

1. Session `b66c47db…` (dieser Hub, 2026-10-21): Turn ab 20:14:08, Plan-Snapshots 1/8 um 20:17:41, 6/8 um 20:31:06, 8/8 um 20:42:22.
2. Abgelesene Anzeige zwischen den Snapshots (Formel `elapsed·(1−r)/r`, `r` eingefroren auf 1/8):

```text
20:17:41 → „1/8 Aufgaben · 13 % · noch ca. 25 min“  (realisiert: 25 min)
20:24:00 → „1/8 Aufgaben · 13 % · noch ca. 69 min“  (realisiert: 18 min)
20:31:00 → „1/8 Aufgaben · 13 % · noch ca. 118 min“ (realisiert: 11 min)
```

**Ergebnis:** Die Restzeit wächst von 25 auf ~118 min, während die echte Restzeit von 25 auf 11 min fällt. Ursache: `runProgress()` in `run-progress.ts:55` teilt die gesamte Turn-Laufzeit durch die altersalte Quote — jede Sekunde ohne Plan-Update erhöht die Schätzung.

**Häufigkeit:** immer (structurally, jede Session mit Plan-Lücken)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `995f2df` |
| Node-Version | 26.7.0 |
| Adapter | beliebig mit Todo-Liste (hier: deepseek/ACP) |
| Repro-Weg | Ereignisdaten der Live-Session nachgerechnet (`/api/sessions/{id}/events`) |

## Logs

Obige Tabelle aus den echten Event-Zeitstempeln (seq 3, 138, 268, 387); keine Secrets.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/session/run-progress.test.ts` | grün — „extrapolates the rest“ zementiert sogar die alte Formel (erwartet 180 s bei 1/4 nach 60 s) |

Rot ohne Fix: ein Test, bei dem zwischen zwei Plan-Snapshots 15 min vergehen und `etaMs` **nicht** wächst, sondern aus der Snapshot-Geschwindigkeit folgt; plus: vor dem zweiten Snapshot keine ETA (null statt Raterei).

## Eingrenzung

`apps/pwa/src/features/session/run-progress.ts:55` — `etaMs` aus Turn-Start-÷-Quote statt aus Plan-Snapshot-Timestamps.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt ([#17](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/17))
- [x] `bugfix` (im selben Lauf beauftragt)
