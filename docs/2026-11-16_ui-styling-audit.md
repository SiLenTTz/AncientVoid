# UI-Styling-Audit 2026-11-16 — Bestandsaufnahme für EPIC-P63

Eingefrorene Analyse (altert bewusst). Grundlage für
[`epics/EPIC-P63-ui-konsolidierung.md`](../epics/EPIC-P63-ui-konsolidierung.md).
Messmethode: `grep`/`comm` über `apps/pwa/src` auf Commit `08c492a0`; Zahlen sind
Näherungen (dynamische Klassen wie `hljs-*`, `layout-*`, `graph-dot-*` werden
als „ungenutzt“ falsch positiv gezählt).

## Bestand

| Größe | Wert |
|---|---|
| CSS-Dateien unter `app/styles/` | 49 (+ `index.css`), 8.376 Zeilen |
| Größte Dateien | `11-report-and-diff` 540, `02-layout` 500, `24-settings` 459, `40-turns` 363 |
| TSX-Komponenten | 97; größte `SessionTail.tsx` 1.467, `GraphPane.tsx` 941, `Dashboard.tsx` 705 |
| Definierte Custom Properties | 52 |
| Inline-`style={{}}` | 26 (9 davon `AccentPicker.tsx`) |
| `!important` | 6 (5 Select-Pfeil in `01-base`, 1 `34-teams`) |

## Befunde (nach Schwere)

### B1 — Geister-Tokens mit fremder Fallback-Palette (Defekt)

`var(--border, #2a2f3a)`, `var(--bg-card, #151515)`, `var(--ok, #9ece6a)`,
`var(--danger, #ff7a7a)`, `var(--bad …)`, `var(--panel …)`, `var(--bg-panel …)`,
`var(--mono …)` — die Tokens `--border`, `--bg-card`, `--danger`, `--bad`,
`--panel`, `--bg-panel`, `--mono` **existieren nicht**. Die Fallbacks stammen aus
einer anderen Palette (Tokyo-Night-Werte `#9ece6a`, `#7aa2f7`, `#e0af68`) und
reagieren nicht auf `[data-theme="light"]` oder die Akzentfarbe.

| Token | Verwendungen | Dateien |
|---|---|---|
| `--border` | 17 | `11-report-and-diff`, `29-workplace`, `30-files` |
| `--bad` | 6 | `30-files`, `29-workplace` |
| `--bg-card` | 3 | `30-files` |
| `--panel`/`--bg-panel`/`--danger`/`--mono` | je 1–2 | `11-report-and-diff`, `30-files` |

→ [BUG-0177](../bugs/bug-0177-geister-tokens-fremde-fallback-farben.md).

### B2 — Hartkodierte Farben außerhalb der Token-Datei

Treffer `#hex`/`rgba()` pro Datei: `11-report-and-diff` 29, `30-files` 28,
`32-repo-graph` 15, `22-loops` 12, `23-workspace-runtime` 10, `29-workplace` 7,
`25-color-picker` 7, `34-teams` 5. Der Light-Theme-Block in `01-base.css` hat
23 Zeilen und überschreibt nur Tokens — alles Hartkodierte bleibt im hellen
Thema dunkel. Verstoß gegen `docs/design-system.md` § „Für künftige Phasen“
(`color-mix()` statt neuer Hex-Werte).

### B3 — Klassen ohne Regel und Regeln ohne Klasse

- **77 Klassennamen** stehen im TSX, haben aber keine CSS-Regel (Auszug:
  `aimetrics-page`, `automations-pane`, `browser-view`, `continue-card`,
  `desktop-setup`, `fleet-settings`, `inventory-card`, `modal`, `nyx-window`,
  `session-main`, `start-guide`, `teams-rows`, `worktree-card`). Teils
  Testanker, teils vergessene Gestaltung — unentschieden.
- **~40 echte Leichen** in CSS ohne Verwendung (nach Abzug dynamischer Muster):
  u. a. `bottom-actions`, `diag-error`, `ic`, `log-blocked`, `metric-estimated`.

### B4 — Doppelte Selektoren über Dateigrenzen

`.card` (`01-base` + `02-layout`), `.dock` (`10-voice-and-dock` +
`45-readable-content`), `.topbar` (`02-layout` + `14-notifications`),
`.status-bar` (`01-base` + `21-icon-rail`), `.mono` (`01-base` +
`03-session-cards`), `.session-title` (`15-run-strip` + `34-teams`) und 19
weitere. Kaskade hängt von der Import-Reihenfolge in `index.css` ab; die
Präfix-Nummer `23-` ist doppelt vergeben (`tool-pane`, `workspace-runtime`).

### B5 — Skalen werden umgangen

- Schriftgrößen: 18× `0.85em`, 9× `0.9em`, 8× `11px`, 8× `0.8em`, 7× `12px`
  statt `--text-xs/sm/md`. `em`-Ketten skalieren mehrfach, wenn Container
  bereits `--font-scale` nutzen.
- Breakpoints: 16 verschiedene `@media`-Ausdrücke (`639`, `699/700`, `480`,
  `520`, `1023`, `1280`, Orientierung, Höhe). Kein gemeinsamer Satz.
- `z-index`: 19 verschiedene Werte (1…210), keine Token-Leiter.

### B6 — Fokus und Bedienbarkeit

18× `:focus-visible` in 10 von 49 Dateien, 3× bloßes `:focus`. Kein globaler
Fokus-Ring für `button`/`a`/`[tabindex]` nachweisbar — pro Komponente nachgezogen.

### B7 — Komponenten-Größe

`SessionTail.tsx` (1.467 Zeilen) und `GraphPane.tsx` (941) tragen Layout,
Zustand und Darstellung zusammen; UI-Änderungen dort sind teuer und riskant.

## Was bereits gut ist

Token-Grundgerüst (`--space-*`, `--text-*`, `--motion-*`, `--target 44px`),
`prefers-reduced-motion` in 9 Dateien, Nummern-Präfixe als Lesereihenfolge,
`tokens.test.ts` für Kontrast, `kleinkram.spec.ts` für Regeln.
