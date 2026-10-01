# Desktop-Companion (EPIC-P11)

Tippt, was du am Handy diktierst oder schreibst, in das Fenster, das am PC
den Fokus hat. Die Seite „PC“ in der PWA zeigt dieses Fenster vorher an.
Architektur und Grenzen: [ADR-0031](adr/0031-desktop-companion.md).

## Einrichten (Hyprland oder sway)

Voraussetzungen: `wtype`, `hyprctl` bzw. `swaymsg`, optional `python3-gobject`
für die Passwortfeld-Erkennung über AT-SPI.

```bash
# 1. Token nur für den Companion (erreicht nichts außer seinen eigenen Routen)
node apps/hubctl/src/cli.ts token issue companion:omarchy | tail -1 > ~/.config/uacc/companion.token
chmod 600 ~/.config/uacc/companion.token

# 2. Starten (Hub auf demselben Rechner; sonst --hub http://<tailnet-ip>:7373)
node apps/companion/src/cli.ts run --hub http://127.0.0.1:7373
#   --allow foot,code,chromium   nur diese Apps (App-ID/Klasse)
#   --no-atspi                    ohne Passwortfeld-Abfrage (schneller, weniger sicher)
```

Als Dienst (`~/.config/systemd/user/uacc-companion.service`):

```ini
[Unit]
Description=UACC Desktop-Companion
After=graphical-session.target

[Service]
ExecStart=/usr/bin/node %h/…/mobile-hub/apps/companion/src/cli.ts run --hub http://127.0.0.1:7373
Restart=on-failure

[Install]
WantedBy=graphical-session.target
```

## Not-Stopp

```bash
node apps/companion/src/cli.ts stop     # sofort, danach tippt nichts mehr
node apps/companion/src/cli.ts resume
node apps/companion/src/cli.ts status
```

Hyprland-Keybind (in `~/.config/hypr/bindings.conf`):

```
bind = SUPER SHIFT, ESCAPE, exec, node …/apps/companion/src/cli.ts stop
```

Token widerrufen: `node apps/hubctl/src/cli.ts token revoke companion:omarchy` —
der Companion beendet sich mit Meldung.

## Was er nicht tut

- Keine Maus, keine Tastenkürzel außer Enter/Tab/Esc/Rückgängig/Strg+A (Ersetzen).
- Nichts in Passwortmanager, PIN-/polkit-Dialoge oder erkannte Passwortfelder.
- Nichts, solange der Bildschirm gesperrt ist (hyprlock/swaylock) oder der Not-Stopp aktiv ist.
- Nichts doppelt: nach Abbruch oder Neustart wird nichts wiederholt.

## Labor (Tests ohne deinen Desktop)

`scripts/messlauf-desktop.mjs` startet ein headless sway in einem eigenen
`XDG_RUNTIME_DIR` (sway/wlroots ohne root entpackt nach `~/uacc-companion-lab`:
Pakete `sway`, `wlroots0.20`, `xcb-util-wm`, `seatd`, `libdisplay-info`,
`libliftoff`, `xcb-util-errors` von einem Arch-Spiegel, `tar --zstd -xf`).
Dort laufen foot, ein GTK4-/GTK3-Feld (`scripts/desktop-lab/entry.py`) und
Chromium; kein Fenster deines echten Desktops wird berührt.
