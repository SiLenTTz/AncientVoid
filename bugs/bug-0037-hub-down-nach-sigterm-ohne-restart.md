---
id: BUG-0037
slug: hub-down-nach-sigterm-ohne-restart
status: done
severity: S1
area: hub.sh
instance: prod
commit: ""
forge: ""
epic: ""
created: 2026-09-29
reporter: jan
---

# BUG-0037 — Hub blieb nach SIGTERM-Exit down: kein Restart bei status 0

## Gesehen

Der mobile Hub war vom Handy nicht mehr erreichbar. `uacc-hub.service`
stand auf `inactive (dead)` — seit 01:08:45 Uhr, rund 6 Stunden, ohne
Neustart. Der Prozess hatte sich um 01:08:45 per SIGTERM sauber beendet
(`code=exited, status=0/SUCCESS`). Zeitgleich (~01:05) warfen mehrere
andere User-Services mit WorkingDirectory auf `/mnt/omarchy_data`
CHDIR-Fehler (Mount-Kurzausfall); deren Restart-Loops erholten sich,
der Hub nicht.

## Erwartet

Ein nicht bewusst gestoppter Hub-Hauptprozess startet automatisch neu;
nur `systemctl --user stop` (Runbook-Update-Pfad) beendet ihn dauerhaft.

## Repro

1. Hub als User-Service mit `Restart=on-failure` betreiben.
2. Dem Hauptprozess SIGTERM schicken (`kill <pid>`) — bewusst NICHT über
   `systemctl --user stop`.
3. Service-Status ansehen.

**Ergebnis nach Schritt 3:** `inactive (dead)`, Exit 0, kein Restart,
Hub bis zum manuellen Eingriff down. **Häufigkeit:** immer (Deterministik
von systemd: `on-failure` restartet Clean-Exits nicht).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | omarchy, systemd `--user`, Loopback + `tailscale serve` |
| Commit | `92a2a98` |
| Node | 26.7.0 |
| Adapter | — (betrifft Service-Unit, nicht Adapter) |
| Repro-Weg | systemctl/journalctl |

## Logs

```text
Sep 29 01:08:45 omarchy node[3736448]: {"msg":"shutting down","signal":"SIGTERM"}
Sep 29 01:08:45 omarchy node[3736448]: {"msg":"stopping hub","keepWorkers":true}
Sep 29 01:08:45 omarchy systemd[1276]: uacc-hub.service: Consumed 28min …
   Process: 3736448 ExecStart=… (code=exited, status=0/SUCCESS)
```

Kein `Stopping uacc-hub.service`-Eintrag davor — der SIGTERM kam nicht
von einem expliziten `systemctl stop`.

## Eingrenzung

`~/.config/systemd/user/uacc-hub.service` (bzw. das Unit-Template in
`scripts/fleet-deploy.sh` und das Runbook-Beispiel in
`docs/operations-runbook.md`): `Restart=on-failure`.

## Behebung (2026-09-29)

**Fix:** `Restart=always` in der Live-Unit, im Unit-Template von
`fleet-deploy.sh` und im Runbook; `systemctl --user daemon-reload`.
Explizites `systemctl --user stop` unterdrückt Restart auch bei
`always` — der dokumentierte Update-Pfad bleibt sicher.

**Test:** Kein automatisierter Test (systemd-Unit-Verhalten, außerhalb
der vitest-Suite). Verifikation: Service-Start, `Restart=always` im
`systemctl show`, Health 200 lokal und über
`https://omarchy.tail6d2826.ts.net/api/health`.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue (Solo-Repro, systemd-Konfiguration — kein Forge-Eintrag)
