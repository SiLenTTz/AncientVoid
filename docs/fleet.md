# Flotte betreiben (EPIC-P6)

Mehrere Hubs erscheinen in einer Oberfläche. Der **Heim-Hub** (hier
`omarchy`) bündelt; jeder andere Hub bleibt Quelle seiner Sessions und hat
seine eigene PWA (ADR-0017).

## Einen Rechner aufnehmen

Voraussetzungen auf dem Rechner: Linux, Node ≥ 22.5 (24/26 geprüft), git,
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

## Entfernen oder sperren

- Heim-PWA → Einstellungen → Host „Entfernen“: vergisst den Host und
  widerruft das Token dort.
- Nur sperren, auf dem anderen Rechner:
  `node apps/hubctl/src/cli.ts token revoke fleet:<heim-host-id> --db ~/.local/share/ancientvoid/hub.db`
  — neue Anfragen sofort abgelehnt, offene Streams binnen 5 s beendet.
- Dienst entfernen: `systemctl --user disable --now ancientvoid-hub`.

## Aktuelle Flotte (2026-09-23)

| Host | Adresse | Adapter |
|---|---|---|
| omarchy (Heim) | `https://omarchy.tail6d2826.ts.net` | claude, codex, opencode, aider, copilot, cursor-clip, deepseek |
| silenttz-server | `http://silenttz-server.tail6d2826.ts.net:7373` | — (keine CLI installiert) |
| evox2 | `http://evox2-securesight.tail6d2826.ts.net:7373` | claude, codex, opencode, copilot, aider |
