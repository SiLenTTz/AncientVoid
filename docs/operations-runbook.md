# Installation, Update und Rückkehr

Dieses Runbook beschreibt den unterstützten Linux-Pfad für einen neuen Hub
und dessen Aktualisierung. Node.js 22.5 oder neuer ist erforderlich; Node 24
und 26 sind im Fleet-Betrieb geprüft. Jeder echte Provider braucht zusätzlich
seine eigene CLI und einen gültigen Login auf genau diesem Host.

## Neuer Hub

```sh
git clone <repo-url> mobile-hub
cd mobile-hub
node --version                  # mindestens 22.5
npm ci
npm -w @uacc/pwa run build
cp apps/hub/hub.config.example.json hub.config.json
chmod 600 hub.config.json
```

Passe `hub.config.json` an: `dataDir` auf einen dauerhaften Pfad setzen,
`projectRoots` auf die erlaubten Projektwurzeln begrenzen und nur installierte
Provider als Adapter registrieren. Provider-Logins und API-Schlüssel bleiben
außerhalb dieser Datei beziehungsweise in geschützten Dateien/Umgebungsvariablen.
Claude erhält standardmäßig Hub-Freigaben; OpenCode für native Freigaben über
ACP mit `preset: "opencode"`. Keine Bypass-Flags wie `--auto` oder
`--dangerously-skip-permissions` konfigurieren.

Für einen lokalen Entwicklungs-Hub:

```sh
scripts/hub.sh start
scripts/hub.sh status
```

### Dauerbetrieb auf dem eigenen Rechner (systemd)

`scripts/hub.sh` ist ein Entwicklungs-Daemon (PIDfile in /tmp) und
überlebt keinen Neustart. Für einen Hub, der beim Boot automatisch
startet, legt ein User-Unit an — gleiche Weise wie
[`fleet-deploy.sh`](../scripts/fleet-deploy.sh) es auf Peers tut:

```ini
# ~/.config/systemd/user/uacc-hub.service  (Pfade anpassen)
[Unit]
Description=UACC mobile-hub
After=network-online.target

[Service]
WorkingDirectory=/pfad/zum/mobile-hub
Environment=UACC_CONFIG=/pfad/zum/mobile-hub/hub.config.json
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=%h/.local/share/mise/shims/node apps/hub/src/main.ts
UMask=0077
# BUG-0037: on-failure ließ den Hub nach sauberem SIGTERM-Exit (status 0)
# down — always startet neu; explizites `systemctl --user stop`
# unterdrückt Restart weiterhin.
Restart=always
RestartSec=3
# BUG-0072: die tmux-Worker liegen im cgroup dieses Dienstes. Der Standard (control-group) tötet sie bei
# jedem Neustart und jedem Absturz und bricht laufende Züge ab. "process" stoppt nur den Hub selbst,
# der neue Hub übernimmt die Worker (ADR-0014).
KillMode=process

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
loginctl enable-linger "$USER"   # startet auch ohne Anmeldung beim Boot
systemctl --user enable --now uacc-hub.service
```

Ist das Unit installiert, delegieren `scripts/hub.sh start|stop|status|logs`
an `systemctl`/`journalctl` — nie zwei Hubs auf einem Port.

Für einen dauerhaften Fleet-Peer nutze
[`fleet-deploy.sh`](../scripts/fleet-deploy.sh): der User-Service heißt
`uacc-hub`, braucht aktives `loginctl enable-linger` und bindet an die
Tailnet-IP. Der Heim-Hub bleibt auf Loopback und wird für HTTPS mit
`scripts/setup-tailscale-serve.sh` veröffentlicht; keine Router-Portfreigabe
und kein öffentlicher Bind.

Gib ein Gerätetoken aus und speichere es sofort geschützt; der CLI-Befehl zeigt
den Klartext nur einmal:

```sh
umask 077
mkdir -p ~/.config/uacc/device-tokens
DATA_DIR=/path/to/data
node apps/hubctl/src/cli.ts token issue phone --db "$DATA_DIR/hub.db" \
  > ~/.config/uacc/device-tokens/phone.txt
chmod 600 ~/.config/uacc/device-tokens/phone.txt
```

Öffne die Hub-PWA am Gerät und verbinde es mit dem Token. Für einen Fleet-Peer
folge [`fleet.md`](fleet.md): Einmalcode vom Peer erzeugen, im Heim-Hub
einlösen, danach müssen beide Hosts unter `/api/fleet` erreichbar sein.
Prüfe die erste Session vom Zielgerät aus, nicht nur mit einem Loopback-Aufruf.

## Diagnose

Der Hub hat derzeit keinen separaten `doctor`-Befehl. Diese Prüfungen zeigen
den Dienst-, Datenbank- und Adapterzustand:

```sh
# Lokaler Entwicklungsdienst
scripts/hub.sh status

# Fleet-/systemd-Dienst
systemctl --user status uacc-hub
journalctl --user -u uacc-hub --since -15min --no-pager

# Authentifizierte Hub-Prüfungen
UACC_URL=http://127.0.0.1:7373 UACC_TOKEN=<device-token> \
  node apps/hubctl/src/cli.ts health
UACC_URL=http://127.0.0.1:7373 UACC_TOKEN=<device-token> \
  node apps/hubctl/src/cli.ts adapters
```

`health` muss Datenbank und EventStore als gesund melden. `adapters` muss die
konfigurierten Adapter und deren Fähigkeiten ausgeben. Bei einem Fleet-Peer
zusätzlich `/api/fleet` prüfen; ein unerreichbarer oder inkompatibler Peer ist
kein erfolgreicher Installationsnachweis.

**Speicher-Wächter (BUG-0074/0075):** `/api/health` meldet unter `checks.memory` den Heap-Füllstand
des Hub-Prozesses. Ab 60 % des V8-Heap-Limits steht `status: "degraded"` mit Klartext, ab 80 % ist die
Stufe `critical`. Der Hub schreibt Stufenwechsel (`hub heap ok → warn`) ins Log, alle 30 s geprüft. Ein
dauerhaft steigender Wert ist ein Leck: Hub neu starten (Worker überleben, `KillMode=process`) und den
Verlauf in der Bug-Datei festhalten.

## Session-Worktrees aufräumen (EPIC-P14)

Jede isolierte Session hat einen Git-Worktree unter `data/worktrees/<id>`.
Archivieren räumt ihn auf, wenn die Session zwischen zwei Zügen steht, kein
langlebiger Worker darin läuft und er keine Arbeit enthält. Ältere oder von
einem Worker gehaltene Worktrees zeigt und räumt `hubctl` (lokal, neben der DB):

```sh
node apps/hubctl/src/cli.ts worktrees --db data/hub.db            # Liste mit Zustand und Größe
node apps/hubctl/src/cli.ts worktrees prune --db data/hub.db      # Trockenlauf
node apps/hubctl/src/cli.ts worktrees prune --apply --db data/hub.db
```

`work` heißt: uncommittete Dateien oder Commits, die dem Projekt fehlen. Solche
Worktrees und solche mit einem Prozess im Verzeichnis (`/proc`-cwd) bleiben
immer stehen; laufende und nicht archivierte Sessions auch. Ein später
fortgesetzter Prompt legt einen fehlenden Worktree am selben Pfad neu an, mit
dem aktuellen Projekt-HEAD als Basis. Entfernen heißt `git worktree remove` und
`branch -D` im jeweiligen Projekt-Repo, nie `rm -rf`.

## Session außerhalb des Hubs fortsetzen (ADR-0036)

Adapter mit belegtem Resume-Pfad deklarieren ihn (`capabilities().resume`).
`hubctl show <sessionId>` nennt den konkreten Befehl, aktuell:

| Adapter | Fortsetzung |
|---|---|
| claude | `claude --resume <session-id>` |
| codex | `codex resume <session-id>` |
| opencode | `opencode --session <session-id>` |
| hermes | `hermes --resume <session-id>` |

Die `<session-id>` ist die Provider-Session-ID (bei claude z. B. über den
„PC offen"-Hinweis der PWA oder `claude agents` erfahrbar). Adapter ohne
Eintrag haben keinen belegten Pfad — dann bleibt die Fortsetzung über den
Hub („Weiter") der einzige Weg.

## Update und Rollback

Vor jedem Update sichere die Daten und Konfiguration verschlüsselt. Stoppe
aktive Provider-Züge vorher im Hub; ein geplanter Stop lässt tmux-Worker
absichtlich weiterlaufen.

1. Hub sauber stoppen (`scripts/hub.sh stop` oder
   `systemctl --user stop uacc-hub`).
2. Mit [`backup-restore.md`](backup-restore.md) ein verschlüsseltes Backup
   erstellen und dessen Schlüssel separat sichern.
3. Auf den geprüften Commit aktualisieren (`git fetch`, dann den gewünschten
   Commit auschecken). Auf Fleet-Peers aktualisiert
   `scripts/fleet-deploy.sh` den Code und startet den User-Service neu.
4. `npm ci`, PWA-Build und `npm run gate` auf dem neuen Stand ausführen.
5. Hub starten; Migrationen laufen beim Öffnen der Datenbank vor Annahme neuer
   Anfragen. `/api/health`, `/api/adapters`, die Session-Recovery und jeden
   Fleet-Peer prüfen.

SQLite-Migrationen sind vorwärtsgerichtet; automatische `down`-Migrationen
gibt es nicht. Für eine Rückkehr stoppe den neuen Hub, checke den vorherigen
Code-Commit aus und stelle das Vor-Update-Backup in ein **neues leeres**
Datadir wieder her. Passe `dataDir` in einer Kopie der alten Konfiguration an,
starte damit den alten Code und prüfe Health, Adapter und Session-Recovery.
Das alte Datadir bleibt bis zur bestätigten Wiederherstellung unangetastet.

Fleet-Verbindungen prüfen beim Koppeln die Protokollversion. Ein Peer mit
abweichender Version wird sichtbar als inkompatibel abgewiesen; aktualisiere
Heim-Hub und Peers aus demselben geprüften Commit-Satz, bevor du neue
Funktionen erwartest. Die PWA wird aus demselben Commit wie die Hub-API gebaut
und ausgeliefert; ein unabhängiger PWA-/API-Kompatibilitätsvertrag ist nicht
implementiert. Ein grüner lokaler Gate-Lauf ersetzt keine echte
Provider-, Handy-, WAN- oder Wiederherstellungsabnahme.
