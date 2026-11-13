# Flotte betreiben (EPIC-P6)

**Art:** how-to

Mehrere Hubs erscheinen in einer Oberfläche. Der **Heim-Hub** (hier
`omarchy`) bündelt; jeder andere Hub bleibt Quelle seiner Sessions und hat
seine eigene PWA (ADR-0017).

## Einen Rechner aufnehmen

Voraussetzungen auf dem Rechner: Linux, Node 22.18+, 24 oder 26+, git,
tmux, Tailscale, SSH-Schlüssel des Heim-Rechners, `loginctl enable-linger`.

```bash
# auf dem Heim-Rechner, im Repo (committeter Stand wird übertragen)
scripts/fleet-deploy.sh <user>@<name>.<tailnet>.ts.net <host-id> <tailnet-ip> <projekt-wurzel> [adapter-json]
```

- Code nach `~/AncientVoid`, Konfig `~/.config/ancientvoid/hub.config.json` (nur beim
  ersten Mal geschrieben), Daten `~/.local/share/ancientvoid`, Dienst
  `systemctl --user … ancientvoid-hub`.
- Der Hub lauscht **nur auf der Tailnet-IP**, Port 7373 — im LAN und im
  Internet nicht erreichbar. Anfragen brauchen trotzdem ein Token.
- Adapter nur für CLIs, die dort installiert und angemeldet sind; das JSON
  entspricht `adapters` in `hub.config.json`.

## Koppeln

1. Auf dem neuen Rechner: `cd ~/AncientVoid && node apps/hubctl/src/cli.ts fleet invite --db ~/.local/share/ancientvoid/hub.db`
   (oder dessen PWA → Einstellungen → „Einladungscode erzeugen“).
2. In der PWA des Heim-Hubs → Einstellungen → „Host hinzufügen“:
   Adresse `http://<name>.<tailnet>.ts.net:7373`, Code eingeben.

**Mit dem Handy (QR-Code):** In der PWA des neuen Rechners „Einladungscode
erzeugen“ — neben dem Code erscheint ein QR-Code mit Adresse und Code. In der
PWA des Heim-Hubs am Handy „QR-Code scannen“, Kamera auf den Bildschirm
halten: beide Felder sind ausgefüllt, dann „Host verbinden“. Die Kamera
braucht HTTPS (Heim-Hub über `tailscale serve`). Der QR-Code enthält die
Adresse, unter der die PWA des neuen Rechners gerade geöffnet ist — also diese
über die Tailnet-Adresse öffnen, nicht über `localhost`.

Der Code gilt 10 Minuten und einmal. Das Token, das der Heim-Hub dabei
bekommt, heißt auf dem anderen Hub `fleet:<heim-host-id>` und darf nur
Sessions, Events, Projekte, Skills, Suche, Freigaben und Meldungen erreichen.

## Aktualisieren

`scripts/fleet-deploy.sh` erneut ausführen. Der Neustart stoppt keine
Session; laufende Züge werden übernommen (ADR-0014). Das gilt erst, seit die Dienstdatei
`KillMode=process` setzt (BUG-0072): ältere Installationen bekommen es mit demselben Aufruf.

### Von `uacc-hub` migrieren (13.11.2026 durchgeführt)

Ältere Installationen (aus der Zeit vor der Umbenennung, ADR-0046/0047)
liefen als `uacc-hub.service` aus `~/mobile-hub` mit `~/.config/uacc`,
`~/.local/share/uacc`, `@uacc/*`-Adaptermodulen und
`KillMode=control-group` (Neustart tötet Worker). Migration pro Host,
Daten und Konfiguration bleiben erhalten:

1. **Backup:** `~/uacc-migration-backup-<datum>/` mit `hub.config.json`,
   Unit-Datei **und** evtl. Drop-in (`uacc-hub.service.d/*.conf`, dort
   lagen z. B. evox2s DEEPSEEK-Env), plus
   `tar -czf data-uacc.tgz -C ~/.local/share uacc`.
2. **Alte Unit weg:** `systemctl --user disable --now uacc-hub.service`,
   Unit-Datei löschen, `daemon-reload`.
3. **Namen umziehen:** `~/.config/uacc/hub.config.json` →
   `~/.config/ancientvoid/`, `~/.local/share/uacc` →
   `~/.local/share/ancientvoid`; in der Konfig `dataDir`, `pwaDir` (→
   `~/AncientVoid/apps/pwa/dist`) und `@uacc/`-Modulnamen umschreiben.
4. **Drop-ins** für die neue Unit übernehmen
   (`ancientvoid-hub.service.d/`), danach erst
   `scripts/fleet-deploy.sh …` (schreibt Unit mit `KillMode=process`,
   übernimmt die vorhandene Konfiguration).
5. **Prüfen:** Health über das Tailnet, Session-Zahlen vorher/nachher,
   geladene Adapter, `systemctl --user show -p KillMode`.

Erwartete Brüche (dokumentiert in ADR-0047): Handys melden sich an den
Peer-Hubs neu an (Client-Keys heißen anders). Rollback: Backup
zurückspielen, Unit wiederherstellen. Alt-Checkout `~/mobile-hub` bleibt
bis zur endgültigen Freigabe liegen.

## Entfernen oder sperren

- Heim-PWA → Einstellungen → Host „Entfernen“: vergisst den Host und
  widerruft das Token dort.
- Nur sperren, auf dem anderen Rechner:
  `node apps/hubctl/src/cli.ts token revoke fleet:<heim-host-id> --db ~/.local/share/ancientvoid/hub.db`
  — neue Anfragen sofort abgelehnt, offene Streams binnen 5 s beendet.
- Dienst entfernen: `systemctl --user disable --now ancientvoid-hub`.

## Aktuelle Flotte (2026-11-13)

| Host | Adresse | Adapter |
|---|---|---|
| omarchy (Heim) | `https://omarchy.tail6d2826.ts.net` | claude, codex, opencode, aider, copilot, cursor-clip, deepseek |
| silenttz-server | `http://silenttz-server.tail6d2826.ts.net:7373` | — (keine CLI installiert) |
| evox2 | `http://evox2-securesight.tail6d2826.ts.net:7373` | claude, codex, opencode, copilot, aider, deepseek (ACP), pi |

Alle drei Hosts laufen seit dem 13.11.2026 auf `ancientvoid-hub.service`
aus `~/AncientVoid` (Stand `a4135a6c`, PWA-Build per
`/api/health → deployment.pwaSha` nachweisbar); silenttz-server und evox2
wurden dabei von `uacc-hub.service` migriert (siehe oben), ihre Sessions
(7 bzw. 47) und Konfigurationen blieben erhalten.
