# Design-System — „Futuristisch" (P1.6)

Diese Datei ist die Referenz, an der sich **jede künftige UI-Aufgabe**
orientiert (P2 T2.3 Diff-UI, P3 T3.8 Sprachsuche-Frontend, P4) — neue
Komponenten übernehmen diese Tokens, statt neue Hex-Werte oder Schriften
einzuführen. Abweichungen brauchen einen genannten Grund, keine stille
Werteliste im Komponenten-CSS.

## Herkunft

Kein am Schreibtisch entschiedener Stil, sondern das Ergebnis eines mit dem
Nutzer durchgespielten, zweistufigen Mockup-Vergleichs (beide Runden als
Artifact veröffentlicht, siehe EPIC-P1.6-Vorbemerkung für die volle
Historie):

1. Drei Informationsarchitekturen (Leitstand/Feldnotiz/Signal) → Nutzerwahl:
   **Leitstand** (dichte Log-Zeilen, Monospace-Metadaten).
2. Drei visuelle Weiterentwicklungen von Leitstand (Modern/Futuristisch/
   Künstlerisch), zusätzlich unter vom Nutzer genannten Ergonomie-Vorgaben
   (Bedienung nur unten, linsenartige Scrollbars, Sprachsteuerung überall,
   Status-Glow) → Nutzerwahl: **Futuristisch**.

## Farb-Tokens (`apps/pwa/src/app/styles/`)

Dieselben Variablennamen wie seit P0 — nur die Werte sind neu, jede
bestehende Komponente re-themt sich automatisch.

| Token | Dunkel (Default) | Hell (`[data-theme="light"]`) | Rolle |
|---|---|---|---|
| `--bg` | `#08090b` | `#eef0f6` | App-Hintergrund |
| `--bg-elev` | `#121316` | `#ffffff` | Karten-/Panel-Oberfläche |
| `--bg-chip` | `#21252c` | `#d7dae5` | Chips, Trennlinien, sekundäre Fläche |
| `--fg` | `#eef1f5` | `#0d1016` | Primärtext |
| `--fg-dim` | `#8d95a3` | `#565d6e` | Sekundärtext |
| `--fg-faint` | `#585f6c` | `#9ba0af` | Tertiärtext (Platzhalter, Meta) — **neu** |
| `--accent` | `#ff9a3c` (heißes Amber) | `#d9601a` | Primäraktion, aktiver Zustand |
| `--accent-ink` | `#1a0a00` | `#fff4ec` | Text/Icon auf `--accent`-Fläche — **neu** |
| `--ok` | `#4fe0ab` | `#158c62` | Status „working"/Erfolg — **semantisch, nie der Akzent** |
| `--warn` | `#ffcf5c` | `#9a6a06` | Status „wartet auf dich" |
| `--err` | `#ff5c6a` | `#c72d3d` | Status „error" |

`--ok`/`--warn`/`--err` sind bewusst von `--accent` getrennt (Regel aus der
`artifact-design`-Praxis dieses Projekts: Statusfarbe ≠ Akzentfarbe) —
Kontingent-Balken und Primär-Buttons nutzen `--accent`, Session-Status nutzt
`--ok`/`--warn`/`--err`.

## Typografie

| Token | Wert | Einsatz |
|---|---|---|
| `--font-display` | `"Orbitron", system-ui, sans-serif` | Marke, Seiten-/Session-Überschriften — HUD-Charakter, sparsam einsetzen |
| `--font-mono` | `"JetBrains Mono", ui-monospace, "Fira Code", system-ui, monospace` | Fließtext **und** Daten — dieses Projekt war seit P0 monospace-first, T1.6-1 lädt die bisher nur als Fallback-Name genannte Schrift jetzt tatsächlich (`apps/pwa/index.html`) |
| `--tracking-label` | `0.1em` | Großbuchstaben-Labels (Status-Badges, Reiter) |

Geladen über Google Fonts (`fonts.googleapis.com`/`fonts.gstatic.com`, per
CSP erlaubt): `Orbitron:wght@500;700;800` + `JetBrains+Mono:wght@400;500`.

## Form & Bewegung

| Token | Wert | Hinweis |
|---|---|---|
| `--radius` | `7px` | Standard-Rundung (Karten, Buttons) |
| `--radius-sm` | `4px` | Kompakte Elemente (Chips, kleine Buttons) — **neu**, ab T1.6-2/3 im Einsatz |
| `--radius-lg` | `14px` | Sheets/Overlays — **neu** |
| `--shadow-elev` | `0 0 0 1px var(--bg-chip), 0 10px 26px -14px rgba(0,0,0,.7)` (dunkel) / entsprechend abgeschwächt hell | Elevation — **neu**, ab T1.6-8 auf Karten |
| `--glow-blur` / `--glow-dur` | `20px` / `1.6s` | Status-Glow-Animationsparameter — **neu**, ab T1.6-8 auf `.session-card` |

**Bewegungsregel:** Glow/Scanline sind ausschließlich Statusanzeigen
(arbeitend/wartet), nie reine Dekoration — wer eine neue Animation baut, muss
sagen, welchen Zustand sie zeigt. Nur `box-shadow`/`opacity`/`transform`
(compositor-freundlich, kein Layout-Reflow). Jede Animation muss unter
`prefers-reduced-motion: reduce` vollständig verschwinden (K2-Schutz, siehe
EPIC-P1.6 AC-P1.6-8/9).

## Belege (Mockup-Screenshots)

Die Werte oben sind aus der vom Nutzer gewählten „Futuristisch"-Mockup-
Variante übernommen (Playwright-Screenshots dieser Session):
`v2-futuristic-dashboard.png`, `v2-futuristic-session-chat.png`,
`v2-futuristic-session-verlauf.png` — HUD-Glas-Look, heißes Amber,
Scanline über arbeitenden Karten, Orbitron-Headings.

## Für künftige Phasen

- **P2 (T2.3, Diff-UI):** Hunk-Karten nutzen `--bg-elev`/`--bg-chip`/
  `--radius`, Diff-Add/Del-Farben werden aus `--ok`/`--err` mit
  `color-mix()` abgeleitet (Muster: `apps/pwa/src/app/styles/`, siehe
  bestehende `.pill.*`-Regeln) — keine neuen Grün-/Rot-Werte.
- **P3 (T3.8, Sprachsuche):** Ergebnisliste/Datei-Viewer übernehmen
  `--font-mono` für Code-Snippets, `--accent` für Zeilen-Anker-Highlights.
- Neue Komponenten, die eine Farbe brauchen, die hier fehlt: zuerst prüfen,
  ob `color-mix(in srgb, var(--token) X%, ...)` das Problem löst, bevor ein
  neuer Hex-Wert entsteht.
