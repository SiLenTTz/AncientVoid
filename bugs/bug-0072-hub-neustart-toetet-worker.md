---
id: BUG-0072
slug: hub-neustart-toetet-worker
status: done
severity: S2
area: ops
instance: prod
commit: "21706d8"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/27"
epic: "P17"
created: 2026-10-27
reporter: jan
---

# BUG-0072 — Jeder Neustart oder Absturz des Hub-Dienstes tötet die Worker und bricht laufende Züge ab

## Gesehen

Läufe werden „regelmäßig unterbrochen“. Nach jedem Neustart des systemd-Dienstes `ancientvoid-hub.service` stehen die tmux-Sessions der Worker
mit der Startzeit des Hubs da (08:11:15 bei Hub-Start 08:11:14), sie wurden neu angelegt statt übernommen. Die Doku verspricht das Gegenteil
(`docs/fleet.md`: „Der Neustart stoppt keine Session; laufende Züge werden übernommen“, ADR-0014).

## Erwartet

Ein Neustart oder Absturz des Hubs stoppt nur den Hub. Die Worker laufen weiter, der neue Hub übernimmt sie.

## Repro

Ohne den Produktiv-Hub anzufassen, mit zwei transienten Units und eigenem tmux-Socket:

1. `systemd-run --user --unit=ancientvoid-killtest-control-group -p KillMode=control-group bash -c "tmux -L k new-session -d -s worker 'sleep 900'; exec sleep 900"`
2. `systemctl --user restart ancientvoid-killtest-control-group`, danach `tmux -L k ls`.
3. Dasselbe mit `-p KillMode=process`.

**Ergebnis nach Schritt 2:** `control-group`: die Session ist neu (Erstellzeit 16:17:43 → 16:17:45), der alte tmux-Server wurde getötet.
`process` (Schritt 3): unverändert (16:17:46 vorher und nachher).

**Häufigkeit:** bei jedem Neustart und jedem Absturz des Dienstes.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub omarchy, systemd `--user`, `KillMode=control-group` (Standard) |
| Commit | `21706d8` |
| Node-Version | v26.7.0 |
| Repro-Weg | systemd (transiente Units), Journal |

## Logs

```text
$ systemd-cgls --user-unit ancientvoid-hub.service
├─ node apps/hub/src/main.ts
├─ tmux new-session -d -s ancientvoid-587a143d-… -c … "sleep 300"
└─ sh -c "cat >> …/workers/ancientvoid-587a143d-….log"
[control-group] vorher:  worker: 1 windows (created … 16:17:43)
[control-group] nachher: worker: 1 windows (created … 16:17:45)
[process]       vorher:  worker: 1 windows (created … 16:17:46)
[process]       nachher: worker: 1 windows (created … 16:17:46)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `scripts/fleet-deploy.test.mjs` „fleet-deploy.sh: ein Neustart … darf die Worker nicht mitnehmen“, „das Runbook zeigt dieselbe Dienstdatei“ | rot ohne Fix (kein `KillMode=process`), grün mit Fix |

## Eingrenzung

`scripts/fleet-deploy.sh` (Dienstdatei-Template) und `docs/operations-runbook.md` setzen kein `KillMode`. Der tmux-Server entsteht beim ersten
Worker-Start im cgroup des Dienstes. Fix: `KillMode=process`. Auf bestehenden Installationen kommt es mit einem erneuten `fleet-deploy.sh`
(Peers) bzw. einem Drop-in (omarchy).

Beifang im selben Template: ein Kommentar mit Backticks (`systemctl --user stop`) wurde im unquoted Heredoc **ausgeführt** („Too few arguments“
beim Deploy) und zerstörte den Kommentar. Behoben, mit eigenem Test.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` erledigt
