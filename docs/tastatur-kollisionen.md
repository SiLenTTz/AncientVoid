# Tastatur-Kollisionen: AV-Kürzel × Omarchy × Browser

**Art:** referenz
**Stand:** 14.11.2026 · **Epic:** P51 T51.9 (Fail-loud-Messlatte) · **Quellen:**
Omarchy-Binds live dieses Hosts (`workstation menu keybindings --print`,
persönliche `~/.config/hypr/bindings.lua` eingerechnet), Browser-Defaults
nach Firefox-/Chromium-Dokumentation (Stand Nov. 2026). Die `?`-Übersicht
(`shared/shortcuts/CheatSheet.tsx`) verweist auf diese Datei.

## Ergebnis in einem Satz

Das AV-Standardschema (Ctrl/Alt, kein Super) kollidiert mit den
Omarchy-Defaults **nicht** — Omarchy bindet Arbeitsflächen und Fenster an
SUPER; reine Alt-Kombos sind bei Omarchy nur Alt+Tab, Alt+Print und
(host-spezifisch) Alt+M belegt, die AV nicht verwendet. Firefox hat zwei
echte Konflikte (Alt+1–4, Alt+Pos1) und einen Double-Zoom-Fall
(Strg+±/0); alles übrige funktioniert.

## Tabelle

| AV-Kürzel (Aktion) | Omarchy-Default | Firefox-Default | Chromium (E2E belegt) | Bewertung |
|---|---|---|---|---|
| Strg + / − / 0 (UI-Zoom) | frei | **Browser-Zoom, reserviert** — preventDefault der Seite wirkt nicht zuverlässig: Firefox zoomt trotzdem („Doppel-Zoom“-Risiko) | ja ( Specs grün) | Chromium/Chrome-App: ok. Firefox-Desktop: UI-Zoom zusätzlich zum Browser-Zoom — Browser-Zoom auf 100 % lassen (PWA misst eigenes Zoomniveau, `--ui-zoom`) |
| Strg+K (Schnellsuche/Befehle) | frei | Suchleisten-Fokus, aber **nicht reserviert**: Seiten mit preventDefault gewinnen (wie GitHub) | ja | ok — bewährt |
| Esc (Overlays schließen) | frei (SUPER+Escape = Systemmenü, anderes Combo) | Ladevorgang abbrechen/Fullscreen — im Seitenkontext konsumiert die Seite | ja | ok |
| Strg+Umschalt+E (Dateien-Seitenleiste) | frei (SUPER+CTRL+E = Emojis, anderes Combo) | DevTools Netzwerk (nur mit geöffneten DevTools relevant) | ja | ok im Normalbetrieb; mit offenen DevTabs kann der Browser konsumieren |
| **Alt+1 … Alt+4** (Kachel fokussieren) | frei (SUPER+1–4 = Arbeitsfläche; SUPER SHIFT ALT+Ziffer = Fenster verschieben — beides braucht SUPER) | **Tab-Wechsel, reserviert** — die Seite sieht das Event nicht | ja | **Konflikt (P18-offener Punkt):** am Firefox-Desktop funktionieren die Fokus-Kürzel nicht. Ausweich: Kachel-Chips „‹ Fokus / Fokus ›“ (Maus) funktionieren überall; Alt+Umschalt+1–4 (Tauschen) ist in Firefox frei. Verhaltensänderung (zweites Schema) nur mit Jans Entscheidung — bis dahin dokumentiert statt geändert |
| Alt+Umschalt+1–4 (Kachel tauschen) | frei (siehe oben) | frei | ja | ok |
| Alt+L (Layout wechseln) | frei | frei | ja | ok |
| Alt+W (Kachel leeren) | frei (SUPER+W = Fenster schließen, anderes Combo) | frei | ja | ok |
| Alt+Pos1 (Zur Übersicht) | frei | **Startseite, reserviert** — Seite sieht das Event nicht | ja (E2E) | Firefox/Chrome-Tab: Kürzel kommt nicht an; Ausweich: Dock „Start“. In der installierten App (eigene Fenster, keine Browser-UI) wirkt es |
| Alt+← / Alt+→ (Historie zurück/vor) | frei | Browser-Back/Forward, reserviert | ja (E2E) | **Bewusst so gebaut:** selbst wenn der Browser konsumiert, passiert genau das Gewünschte (AV-Routen sind Hash-Historie) — kein Funktionsverlust |
| ? (Kürzel-Übersicht) | frei | frei (Shift+/) | ja | ok |
| Strg+Enter (Senden, Composer) | frei | frei | ja | ok |
| 1–9, ↑/↓ (Freigaben/Vorschläge — lokal) | frei | frei | ja | ok |

## Host-spezifische Ergänzung (dieser Rechner)

- **Alt+M** ist hier an „Mikrofon stumm schalten“ gebunden
  (`bindings.lua`, Toggle-to-Talk). AV verwendet Alt+M nicht — künftige
  AV-Kürzel sollten es meiden (bleibt sonst beim WM hängen).
- F9 ist hier vom voxtype-Diktat befreit — für AV irrelevant, aber
  Belegungsänderungen des Hosts gehören in diese Tabelle, wenn AV-Kürzel
  betroffen sind.

## Optionaler Hyprland-`pass`-Snippet (Doku, kein Auto-Write)

Wer Super-Kombos doch an AV durchreichen will, macht das im Fenstermanager,
nicht in der Web-App (eine PWA kann Compositor-Grabs technisch nicht
übernehmen — die ehrliche Grenze dieses Features):

```ini
# klassisches Format (hyprland.conf):
bind = SUPER, K, pass, class:^(<AV-Fensterklasse>)$
# Omarchy (bindings.lua): o.bind("SUPER + K", "AV: Suche", "passclass <klasse>")
```

`<AV-Fensterklasse>` erfährt man mit `hyprctl clients` für das offene
AV-Fenster (installierte PWA/eigenes Fenster; normale Browser-Tabs haben
die Browser-Klasse — `pass` auf Browser wirkt auf den Browser, nicht AV).
Gebundene Super-Kombos landen damit **nur im fokussierten AV-Fenster**;
ungebundene Super-Kombos erreicht die Seite ohnehin als `metaKey`.

## Entscheidungs-Log

- 14.11.2026 (T51.9): AV-Alt-Schema bestätigt; Alt+1–4 bleibt trotz
  Firefox-Konflikt unverändert (Muskelgedächtnis, Chromium/Handy/main
  Nutzungswelt grün) — Ausweich dokumentiert. Ein zweites Schema wäre
  eine Verhaltensänderung mit Jans ausdrücklichem Auftrag.
