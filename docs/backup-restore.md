# Verschlüsseltes Backup und Restore

`hubctl backup` erstellt ein authentifiziert verschlüsseltes Archiv aus der
Hub-Datenbank, Session-JSONL, Snapshots und Blobs, Attachments, Medienjobs,
Workern, Worktrees sowie der Hub-Konfiguration. Das Archiv enthält damit auch
lokale Geräte- und Flotten-Credentials. Es wird mit AES-256-GCM verschlüsselt;
ein Schlüssel aus einer privaten Datei wird mit scrypt abgeleitet.

## Backup

Lege den Schlüssel außerhalb des Datadirs und der Sicherung ab. Mindestens
16 UTF-8-Bytes; Modus `0600` ist erforderlich:

```sh
umask 077
openssl rand -base64 36 > ~/.config/uacc/backup.key
chmod 600 ~/.config/uacc/backup.key
```

Stoppe den Hub sauber mit `systemctl --user stop uacc-hub` (oder dem passenden
Dienstnamen). Der Hub entfernt dann `.uacc-hub.pid`; das Backup verweigert
aktive Hubs, verwaiste Locks, laufende tmux-Worker und SQLite-WAL/SHM-Dateien.
Geplantes Hub-Stoppen lässt tmux-Worker absichtlich weiterlaufen. Beende
laufende Sessions vor dem Service-Stop im Hub. Falls ein Worker bewusst
abgebrochen werden soll, beendet `tmux kill-session -t uacc-<session-id>` den
Prozess; nicht gespeicherte Änderungen dieses Laufs können dabei verloren
gehen.

```sh
node apps/hubctl/src/cli.ts backup create \
  --config ~/.config/uacc/hub.config.json \
  --out /mnt/backup/uacc-2026-09-24.uaccbak \
  --key-file ~/.config/uacc/backup.key
```

Das Ziel darf noch nicht existieren und muss außerhalb des Datadirs liegen.
Archive und temporäre Dateien werden mit Dateimodus `0600` angelegt. Es gibt
keine automatische Rotation. `prune` zeigt standardmäßig nur an, was über der
expliziten Aufbewahrungszahl liegt; erst `--apply` löscht alte `.uaccbak`-
Dateien:

```sh
node apps/hubctl/src/cli.ts backup prune --dir /mnt/backup --keep 14
node apps/hubctl/src/cli.ts backup prune --dir /mnt/backup --keep 14 --apply
```

Lege die Zahl passend zu deinem Sicherungsplan fest und lagere Archive auf
einem separaten, geschützten Medium.

## Restore auf einen frischen Host

Installiere zuerst Hub-Code, Provider-CLIs und externe Modell-/Credential-Dateien
wie im [Konfigurationshandbuch](configuration.md). Das Backup packt keine
externen API-Key-Dateien oder Provider-Logins ein. Nutze einen neuen, noch nicht
existierenden Datenpfad und ein neues Config-Ziel:

```sh
node apps/hubctl/src/cli.ts backup restore \
  --archive /mnt/backup/uacc-2026-09-24.uaccbak \
  --data-dir ~/.local/share/uacc-restored \
  --config-out ~/.config/uacc/hub-restored.config.json \
  --key-file ~/.config/uacc/backup.key
```

Restore entschlüsselt zuerst in ein privates Staging-Verzeichnis, prüft
Archivpfade, SQLite-Integrität, Attachment- und Session-Blob-Hashes sowie
Draft-Referenzen und veröffentlicht erst nach erfolgreicher Prüfung das neue
Datadir. Das Config-Ziel wird auf das neue `dataDir` gesetzt. Ein falscher
Schlüssel oder ein unvollständiges Archiv hinterlässt kein teilweise
wiederhergestelltes Datadir. Das bestehende Datadir wird nie überschrieben.

Nach dem Restore: Config prüfen (insbesondere absolute Provider-Key-Pfade,
Adapter-Module und Projektwurzeln), Hub starten, `/api/health` prüfen und
Session-Recovery sowie externe Provider-Outcomes abgleichen. Passkeys/WebAuthn
sind an Hardware und Browserprofile gebunden; das Kopieren der SQLite-Datenbank
garantiert nicht, dass ein anderes Gerät diese Schlüssel verwenden kann.

## Betriebsgrenzen

- GNU `tar` muss verfügbar sein; die Sicherung wird gestreamt und nicht als
  zweites vollständiges Archiv im RAM gehalten.
- Alle Dateien im Datadir werden aufgenommen, einschließlich Worktrees und
  Worker-Logs. Aus dem Datadir herauszeigende Symlinks sowie Spezialdateien
  werden abgelehnt.
- Das Backup beweist Integrität und Referenzvollständigkeit, aber keine
  Wiederaufnahme eines externen Providers. Ein Restore-Test auf einem frischen
  Zielhost bleibt Teil der Geräteabnahme.
- Das Schlüsselmaterial liegt nicht im Archiv. Eine verlorene Schlüsseldatei
  kann nicht aus dem Backup wiederhergestellt werden.
