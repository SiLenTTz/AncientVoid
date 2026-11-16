---
id: BUG-0030
slug: data-directory-world-readable
status: done
severity: S2
area: core, hubctl
instance: dev
commit: "ce156ff"
forge: ""
epic: P12
created: 2026-09-24
reporter: Codex
---

# BUG-0030 — Hub-Datadir und SQLite-Credentials sind für andere Benutzer lesbar

## Gesehen

Das Produktiv-Datadir hatte Modus `0755`; `hub.db`, `hub.db-wal` und
`hub.db-shm` waren für andere Benutzer lesbar. Dieselben Modi entstanden bei
einem verschlüsselten Restore. Die DB enthält `fleet_peers.token` als
Klartextspalte.

## Erwartet

Hub-Datadir und wiederhergestellter Datadir sind nur für den Hub-Benutzer
zugänglich; DB, WAL/SHM und darin enthaltene Peer-Credentials sind nicht für
andere lokale Benutzer lesbar.

## Repro

Voraussetzung: Hub-Datadir mit vorhandener `hub.db`, danach sauberer Hub-Stop.

1. `stat -c '%a %n' data data/hub.db`
2. Öffne die SQLite-Datei lesend und frage nur `PRAGMA table_info(fleet_peers)`
   ab; keine Spaltenwerte ausgeben.
3. Erstelle mit `hubctl backup create` ein verschlüsseltes Archiv und stelle
   es mit `hubctl backup restore` in ein neues, noch nicht vorhandenes Datadir
   wieder her.
4. `stat -c '%a %n' <restore-dir> <restore-dir>/hub.db`

**Ergebnis:** `data`/Restore-Datadir `755`, DB `644`; `fleet_peers` hat eine
Klartextspalte `token`. Jeder lokale Benutzer kann DB-Datei und
Flotten-Credentials lesen.

**Häufigkeit:** zweimal live reproduziert am 2026-09-24: Produktivdatadir und
isolierter Backup-Restore.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) und isolierter Loopback-Test |
| Commit | `ce156ff` |
| Node-Version | 26.7.0 |
| Adapter | Produktiv-Hub; isolierter `dummy` |
| Repro-Weg | Hub-Start/Restore + Dateimodus + SQLite-Schema |

## Logs

Es wurden nur Dateimodi und Spaltennamen protokolliert. Keine Tokenwerte oder
Peer-Credentialwerte wurden ausgegeben.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/platform/db.test.ts` | Regressionstest ergänzt; war ohne Fix rot (Datadir `0755`) |
| Unit | `apps/hubctl/test/backup.test.ts` | Regressionstest ergänzt; war ohne Fix rot (Restore-DB `0644`) |

Die Regressionstests verlangen unter umask `0022` `0700` für das Datadir und
alle wiederhergestellten Verzeichnisse sowie `0600` für DB, WAL/SHM und
wiederhergestellte Dateien. Der Hub-Startpfad begrenzt außerdem ein
vorhandenes Produktiv-Datadir auf `0700`.

## Eingrenzung

Root cause: `packages/core/src/platform/db.ts` legt DB/Elternverzeichnis mit
der Prozess-umask an; `apps/hub/src/main.ts` übernimmt bestehende
Datadir-Rechte nicht. `apps/hubctl/src/backup.ts` publiziert den extrahierten
Baum ohne anschließende Einschränkung der Dateimodi.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt
- [x] Regressionstests vor Fix rot, nach Fix grün; `npm run gate` grün
- [x] Live-Start unter umask `0022`: Health 200, Datadir `0700`, DB/WAL/SHM `0600`
- [x] Fix-Branch gepusht; [MR !115](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/115) nach `feat/p12-backup-restore` geöffnet
- [ ] Review und Merge
