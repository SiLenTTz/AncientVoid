---
id: BUG-0029
slug: hub-log-default-permissions
status: done
severity: S3
area: hub.sh
instance: dev
commit: "c24448b"
forge: ""
epic: P12
created: 2026-09-24
reporter: Codex
---

# BUG-0029 — Hub-Log wird mit der Benutzer-umask für andere lesbar angelegt

## Gesehen

Ein Start des lokalen Hubs legte `/tmp/uacc-hub.log` mit Modus `0644` an.

## Erwartet

Das Hub-Log soll nur für den ausführenden Benutzer lesbar und schreibbar sein (`0600`).

## Repro

Voraussetzung: lokaler Hub gestoppt, Standard-umask `0022`.

1. `scripts/hub.sh start`
2. `stat -c '%a' /tmp/uacc-hub.log`

**Ergebnis nach Schritt 2:** `644`.

**Häufigkeit:** einmalig reproduziert am 2026-09-24.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `93b2c62` |
| Node-Version | 26.7.0 |
| Adapter | mehrere |
| Repro-Weg | Hub-Skript + Dateimodus |

## Logs

Es wurde nur der Dateimodus geprüft. Die temporäre Logdatei wurde nach dem Stop
mit `shred -u -n 1` entfernt. Es wurden keine Loginhalte in diesen Report kopiert.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Integration | `scripts/hub.sh start` + `stat -c '%a' /tmp/uacc-hub.log` | reproduziert: `644` |
| Shell unit | nicht vorhanden | nicht vorhanden |

Der Start/Stop-Messlauf soll nach dem Fix `600` melden und den Port sowie die
PID-Datei nach dem Stop freigeben.

## Re-Verify

Nach dem Fix: `umask 0022; scripts/hub.sh start` meldete Logmodus `600` und
`GET /api/health` lieferte `ok`. `scripts/hub.sh stop` schloss Port 7373 und
entfernte PID-, WAL- und SHM-Datei. Das temporäre Log wurde anschließend
gelöscht. `npm run gate`: bestanden (104 Testdateien/637 Tests, 151 E2E,
2 sichtbare Skips).

## Eingrenzung

`scripts/hub.sh`: die Umleitung `>>"$LOG"` verwendet die geerbte Benutzer-umask;
das Log wird vor dem Start weder restriktiv erstellt noch auf `0600` gesetzt.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt
- [x] `bugfix` läuft im P12-Arbeitszweig
