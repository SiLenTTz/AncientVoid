---
id: BUG-0181
slug: app-dreht-nicht-mit-und-querformat-ohne-leshoehe
status: done
severity: S2
area: pwa
instance: prod
commit: ""
forge: ""
epic: ""
created: 2026-11-16
reporter: kai (Handy über Tailnet)
---

# BUG-0181 — Die App dreht nicht mit; gedreht fehlt dem Chat die Höhe

## Gesehen

1. **Kein Drehen überhaupt.** Als installiertes PWA (Tailnet, Standalone) bleibt
   die Oberfläche senkrecht, egal wie das Handy gehalten wird. Grund ist das
   Manifest: `"orientation": "portrait-primary"` steht dort seit der ersten
   öffentlichen Fassung (`4bfbcc2d`, Commit „first public release“).
2. **Und wenn sie sich doch dreht, ist sie unbrauchbar.** Im Browser bei
   `915 × 412` CSS-px (Handy bzw. Fold-Außendisplay quer) gemessen:

   | Block | Höhe |
   |---|---|
   | Dock (fixiert, unten) | **278 px** |
   | Laufleiste (`run-strip`) | 66 px |
   | Chat (`tail-scroll`) | 80 px Box, davon **~31 px Inhalt** (80 px Endplatz) |
   | verfügbare Höhe | 412 px |

   Der Chat hatte 48–80 px — ein paar Zeilen. Die Kürzel-Regeln für niedrige
   Fenster aus `08-session-events.css` (BUG-0053) wirkten nicht mehr: später
   importierte Dateien (`15-run-strip.css`, `40-turns.css`) gewinnen bei gleicher
   Spezifität die Kaskade, `.run-strip { display: none }` wurde also einfach
   überstimmt.

## Erwartet

Das Gerät bestimmt die Ausrichtung. Nach dem Drehen (ohne Neuladen) steht die
Sitzungsliste links als Spalte, die Laufleiste ist Aus, und dem Chat bleibt
Leshöhe; im Hochformat bleibt alles wie es war.

## Ursache

- `apps/pwa/public/manifest.webmanifest`: `portrait-primary` sperrt die
  Ausrichtung für installierte Apps (im Browser merkbar, weil die Android-App
  danach fragt).
- `apps/pwa/src/app/styles/08-session-events.css:203` (`@media (max-height: 520px)`)
  verlor gegen später importierte Basalregeln — BUG-0053 war damit faktisch
  zurück.
- Der Endplatz von 80 px (`43-nyx-fab.css`, BUG-0145) ist für den Sprach-Knopf
  gedacht, der in niedrigen Fenstern gar nicht über der letzten Chatzeile hängt —
  er fraß dort fast die halbe Chat-Höhe.

## Repro

1. `npm run -s -w @ancientvoid/pwa build`, Hub öffnen, Session öffnen.
2. Viewport auf `915 × 412` stellen, Chat-Reiter wählen.
3. Höhen von `.dock-stack`, `.run-strip`, `.tail-scroll` messen.

**Ergebnis nach Schritt 3 (vor dem Fix):** Dock 278 px, Laufleiste sichtbar
(66 px), Chat-Box 80 px mit `padding-bottom: 80px`, Bedienung (Eingabe) erst nach
Tipp auf „Steuerung einblenden“, danach Dock 160–229 px und Chat 48–111 px.

**Häufigkeit:** immer, sobald die Fensterhöhe ≤ 520 px ist.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Windows-Host, Hub `127.0.0.1:7373` / Tailnet, Chromium (agent-browser) |
| Commit | `main`-Linie nach PR #37 (`61151169`) |
| Repro-Weg | Messung im Browser + E2E (`e2e/specs/querformat.spec.ts`) |

## Logs

```text
vorher  {innerH:412, dock:278, runStrip:"grid", tailBox:80, tailPadB:"80px", chatSichtbar:48}
nachher {innerH:412, dock:180, runStrip:"none", tailPadB:"20px", chatSichtbar:130}
nachher, Steuerung aufgeklappt: {dock:112, eingabe:44, chatSichtbar:160}
Hochformat (412×915) unverändert: {runStrip:"grid", tailPadB:"80px", chatSichtbar:326}
```

## Fix

- `apps/pwa/public/manifest.webmanifest`: `"orientation": "any"`.
- Neu `apps/pwa/src/app/styles/50-short-viewport.css`, **zuletzt** importiert
  (Kommentar in `index.css` hält fest, warum die Reihenfolge dort entscheidet):
  Laufleiste/Vorlagen/Filter aus, Dock und Tabs flacher, Eingabe und
  Symbolknöpfe in einer Reihe, Warteschlange auf Titel + eine Zeile begrenzt.
- Sprach-Knopf-Ausgleich in niedrigen Fenstern: `padding-bottom: 20px` und
  `padding-right: 70px` statt 80 px Endplatz — der Text läuft rechts am Knopf
  vorbei, anstatt dass die halbe Chat-Höhe als Sicherheitsplatz verpufft.
  Die Regel spiegelt den Selektor aus `43-nyx-fab.css` und gewinnt nur über die
  Importreihenfolge.

## Tests

| Ring | Datei / Fall | Stand |
|---|---|---|
| E2E | `e2e/specs/querformat.spec.ts` — „Manifest erzwingt keine Hochformat-Sperre“ | grün |
| E2E | „Querformat: Chat behält Leshöhe, Bedienung bleibt im Screen“ (Dock ≤ 200, Chat ≥ 90, Tabs im Screen, Laufleiste `none`, Streifen `column`; nach einem Tipp auf ▴ Eingabe sichtbar) | grün |
| E2E | „drehen ohne Neuladen baut um (hoch → quer → hoch)“ (nur Viewport geändert, kein Reload) | grün |
| E2E | bestehende BUG-0053-Fälle in derselben Datei | auf diesem Rechner nicht prüfbar (`read ECONNRESET`, BUG-0179) — mit und ohne Änderung identisch |

## Schrittstand

- [x] Manifest-Sperre raus
- [x] Kaskade der Querformat-Regeln repariert (eigene Datei, zuletzt importiert)
- [x] Chat-Höhe im Querformat: 48 → 130 px (Steuerung zu) bzw. 160 px (offen)
- [x] E2E für Drehen ohne Neuladen
- [ ] Echtes Gerät: Ausrichtung folgt der Systemvorgabe erst, wenn der Service
      Worker das neue Manifest geholt hat (App schließen/neu öffnen)
