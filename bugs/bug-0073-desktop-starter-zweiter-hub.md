---
id: BUG-0073
slug: desktop-starter-zweiter-hub
status: done
severity: S2
area: ops
instance: prod
commit: "21706d8"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/28"
epic: "P17"
created: 2026-10-27
reporter: jan
---

# BUG-0073 — Der Desktop-Starter „UACC“ startet einen zweiten Hub neben dem Dienst

## Gesehen

Um 16:12:57 lief ein Hub außerhalb von systemd (PID 203257, cgroup `app-Hyprland-gtk-launch-….scope`, `GIO_LAUNCHED_DESKTOP_FILE=…/uacc-hub.desktop`).
Er hält Port 7373 und den Lock. Der Dienst `uacc-hub.service` scheiterte danach im 3,5-s-Takt: „Ein Hub läuft bereits (PID 203257, Lock …/.uacc-hub.pid)“,
62 Neustartversuche in drei Minuten.

## Erwartet

Es läuft genau ein Hub. Der Desktop-Starter startet den Dienst über systemd (so wie es `scripts/hub.sh` schon tut: „nie zwei Hubs auf einem Port“).

## Repro

1. Hub-Dienst gerade nicht erreichbar machen (z. B. in dem Moment nach einem Absturz, bevor `Restart=always` greift).
2. „UACC“ im Anwendungsmenü anklicken (`~/.local/bin/uacc-hub-app`).

**Ergebnis nach Schritt 2:** der Starter sieht Port 7373 nicht antworten, startet per `setsid nohup node apps/hub/src/main.ts` einen eigenen Hub. Gleich
danach bringt systemd seinen Hub hoch und scheitert am Lock.

**Häufigkeit:** immer, wenn der Starter in dem Moment des Ausfalls benutzt wird. Gesehen am 2026-10-27 16:12:57. Repro-Weg: Prozess- und Journal-Auswertung.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub omarchy |
| Commit | `21706d8` |
| Repro-Weg | Journal, `/proc` |

## Logs

```text
Oct 27 16:15:26 uacc-hub: {"level":"error","msg":"fatal","err":"Ein Hub läuft bereits (PID 203257, Lock …/.uacc-hub.pid)."}
Oct 27 16:15:26 systemd: uacc-hub.service: Main process exited, code=exited, status=1/FAILURE
Oct 27 16:15:29 systemd: uacc-hub.service: Scheduled restart job, restart counter is at 60.
PID 203257  STARTED 16:12:57  GIO_LAUNCHED_DESKTOP_FILE=…/uacc-hub.desktop  _=/usr/bin/setsid
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `scripts/fleet-deploy.test.mjs` „Desktop-Starter“: startet über systemd, Rückfall nur ohne Dienstdatei | rot (Starter lag nicht im Repo), grün mit Fix |

## Eingrenzung

`~/.local/bin/uacc-hub-app` lag **außerhalb des Repos** und rief unbedingt `setsid nohup node …` auf. Fix: `scripts/uacc-hub-app` (Repo) startet bei
vorhandener Dienstdatei `systemctl --user start uacc-hub.service` und wartet bis zu 20 s. `~/.local/bin/uacc-hub-app` wird ein Link darauf.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` erledigt
