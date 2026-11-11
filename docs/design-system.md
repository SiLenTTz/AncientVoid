# Design-System — „Futuristisch" (P1.6), fortgeschrieben mit EPIC-P43

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
| `--fg-faint` | `#7b8391` | `#666d7d` | Tertiärtext (Platzhalter, Meta); seit P43 4,5:1 auf `--bg-elev` |
| `--accent` | `#b58cff` (Void-Violett) | `#6a3cc9` | Primäraktion, aktiver Zustand, Links; frei wählbar (siehe „Akzentfarbe“) |
| `--accent-ink` | `#12081f` | `#ffffff` | Text/Icon auf `--accent`-Fläche |
| `--call` | `#ff9a3c` (Amber) | `#9c4d00` | **Ruf: „du bist dran“** (Freigabe, fertiger Zug). Fest, nie der Akzent, nicht wählbar |
| `--call-ink` | `#1a0a00` | `#ffffff` | Text/Icon auf `--call`-Fläche |
| `--info` | `#5cc8ff` | `#0b6aa6` | Frage des Agenten |
| `--info-ink` | `#04131c` | `#ffffff` | Text/Icon auf `--info`-Fläche |
| `--ok` | `#4fe0ab` | `#158c62` | Status „working"/Erfolg — **semantisch, nie der Akzent** |
| `--warn` | `#ffcf5c` | `#9a6a06` | Warnung (Kontingent, Schwellen). „Du bist dran“ ist seit P43 `--call` |
| `--err` | `#ff5c6a` | `#c72d3d` | Status „error" |

`--ok`/`--warn`/`--err` sind bewusst von `--accent` getrennt (Regel aus der
`artifact-design`-Praxis dieses Projekts: Statusfarbe ≠ Akzentfarbe) —
Kontingent-Balken und Primär-Buttons nutzen `--accent`, Session-Status nutzt
`--ok`/`--call`/`--info`/`--err`.

**Ruf ≠ Akzent (EPIC-P43, E1).** Bis P43 trug Amber zugleich Akzent, Links und „bereit“. Seither
ist Amber allein der Ruf. Wer als Akzent eine Farbe nahe am Ruf wählt, bekommt im Farbwähler einen
Hinweis (`accentWarnings`, `STATUS` in `appearance.ts`); der Ruf bleibt dann an Form und Bewegung
erkennbar.

**Kontrast.** `apps/pwa/test/app/tokens.test.ts` liest die Tokens aus `01-base.css` und verlangt
für Text (`--fg`, `--fg-dim`, `--fg-faint`, `--accent`, `--call`, `--info`, `--err`) 4,5:1 auf `--bg`
und `--bg-elev`, in beiden Erscheinungsbildern. Bekannte Ausnahme: `--ok` hell liegt als Text bei
4,2:1; die semantischen Farben bleiben in P43 unverändert, Zustand steht deshalb nie allein in
Textfarbe, sondern immer auch in der Form.

## Typografie

| Token | Wert | Einsatz |
|---|---|---|
| `--font-display` | `"Orbitron", system-ui, sans-serif` | Marke, Seiten-/Session-Überschriften — HUD-Charakter, sparsam einsetzen |
| `--font-ui` | `"Inter", system-ui, sans-serif` | Text und Bedienung (Standard seit EPIC-P43, E3) |
| `--font-code` / `--font-mono` | `"JetBrains Mono", ui-monospace, "Fira Code", system-ui, monospace` | Code, Diff, Tool-Ausgabe, Pfade, Zahlen (`.num`, Laufleiste, Statusleiste: `tabular-nums`) |
| `--tracking-label` | `0.1em` | Großbuchstaben-Labels (Status-Badges, Reiter) |

Alle Schriften werden seit EPIC-P34 T34.6 selbst ausgeliefert (`@fontsource/*`, nur
`latin`, importiert in `styles/index.css`) — kein Fremd-Host, offline über den Service Worker.
`--font-ui` (Text und Bedienung) und `--font-code` (Code, Diff, Tool-Ausgabe; `--font-mono` ist
ein Alias darauf) sind getrennt und über Einstellungen → Schrift wählbar; `--font-scale`
(0,85–1,3) skaliert jede Textgröße (`calc(Npx * var(--font-scale, 1))`). Wahlmöglichkeiten:
Inter (Standard), Atkinson Hyperlegible, Systemschrift und die drei Festbreitenschriften für die
Oberfläche; JetBrains Mono (Standard), IBM Plex Mono, Systemschrift für Code. Wer vor P43 eine
Wahl gespeichert hatte, behält sie — auch JetBrains Mono als Oberflächenschrift. Orbitron bleibt fest für Marke und Überschriften.

## Form & Bewegung

| Token | Wert | Hinweis |
|---|---|---|
| `--radius` | `7px` | Standard-Rundung (Karten, Buttons) |
| `--radius-sm` | `4px` | Kompakte Elemente (Chips, kleine Buttons) — **neu**, ab T1.6-2/3 im Einsatz |
| `--radius-lg` | `14px` | Sheets/Overlays — **neu** |
| `--shadow-elev` | `0 0 0 1px var(--bg-chip), 0 10px 26px -14px rgba(0,0,0,.7)` (dunkel) / entsprechend abgeschwächt hell | Elevation — **neu**, ab T1.6-8 auf Karten |

## Skalen (EPIC-P43 T43.1)

| Token | Wert | Einsatz |
|---|---|---|
| `--space-1` … `--space-5` | 4 / 8 / 12 / 16 / 24 px | Abstände; neue Regeln nehmen diese Stufen statt freier Pixelwerte |
| `--text-xs` … `--text-xl` | 11 / 12 / 14 / 16 / 20 px × `--font-scale` | Textgrößen |
| `--target` | 44 px bei Touch, 30 px mit Maus (`hover: hover` und `pointer: fine`) | Mindestgröße eines Bedienelements |
| `--motion-fast` / `-base` / `-slow` | 120 / 220 / 420 ms | Dauer |
| `--ease-out` / `--ease-spring` | `cubic-bezier(.2,.8,.2,1)` / `cubic-bezier(.2,.9,.25,1.1)` | Kurve |

## Bewegungssprache (`36-motion.css`, `shared/motion.ts`)

Sechs Bewegungen, jede mit genau einer Bedeutung. Wer eine davon für etwas anderes benutzt,
macht die Sprache unlesbar.

| Klasse / Funktion | Name | Bedeutung | Ablauf |
|---|---|---|---|
| `.mv-breathe` | Atmen | ein Agent arbeitet | Schleife |
| `.mv-shimmer` | Schimmer | genau dieser Schritt läuft | Schleife |
| `.mv-call` | Ruf | du bist dran | einmal bei Ankunft |
| `.mv-snap` | Einrasten | Schritt oder Zug fertig | einmal |
| `wander()`, `.mv-wander` | Wandern | Element wechselt Gruppe oder öffnet sich | einmal (View Transitions, sonst Einblenden) |
| `countStep()` | Zählen | Zahl ist live | fortlaufend, ohne Sprünge |

Nur zwei Schleifen. Nur `transform` und `opacity`. Mit `prefers-reduced-motion` oder dem Schalter
in den Einstellungen (`data-ctx-motion="off"`) steht ein Standbild mit gleicher Aussage. Bei
getrennter Verbindung (`data-conn="off"` am Wurzelelement) halten Atmen und Schimmer an (K10).

## Zustandssprache (`shared/StatusDot.tsx`, `shared/display-state.ts`, `38-status.css`, EPIC-P43 T43.2)

Ein Baustein sagt den Zustand einer Session — in Karte, Session-Kopf, Statusleiste und Vorschau.
Farbe, Form und Bewegung sagen dasselbe; jede der drei reicht allein.

| Anzeigezustand | Hub-Status | Wort | Farbe | Form | Bewegung |
|---|---|---|---|---|---|
| `working` | `starting`, `working`, `stopping` | startet / arbeitet | `--ok` | gefüllter Punkt | Atmen |
| `approval` | `waiting_approval` | Freigabe nötig | `--call` | Punkt mit Hof | Ruf (einmal) |
| `question` | `waiting_approval` mit `tool.questions` | Frage | `--info` | Punkt mit Hof | Ruf (einmal) |
| `done` | `idle`, auf diesem Gerät ungesehen | fertig | `--call` | offener Ring | Einrasten (einmal) |
| `error` | `error`, `interrupted`, Unbekanntes | Fehler / unterbrochen / Rohwert | `--err` | Quadrat | kurzes Rütteln (einmal) |
| `quiet` | `idle` gesehen, `parked`, `stopped` | bereit / pausiert / beendet | `--fg-faint` | kleiner Punkt | keine |

- Der Anzeigezustand ist **abgeleitet**, kein Contract: `data-status` trägt weiter den Hub-Status,
  `data-display` den Anzeigezustand. Ein unbekannter Hub-Status ist nie „ruhig“ (fail loud).
- Gesamtzustand über mehrere Sessions (`overallState`): Freigabe > Frage > Fehler > arbeitet >
  fertig > ruhig — dieselbe Reihenfolge wie VoidWarden.
- Es gibt keine umlaufende Randlinie mehr (früher Karte, Session-Ansicht, Pille, Knopf). Eine
  Karte oder Session, die dich braucht, trägt eine ruhige Kante in `--call`; ein Knopf, dessen
  Aufruf läuft, schimmert.
- Der Schalter „Bewegung“ (Einstellungen → Darstellung, Attribut `data-ctx-motion`) und
  „Bewegung reduzieren“ des Systems schalten jede Bewegung ab; ohne Verbindung (`data-conn="off"`)
  halten Atmen und Schimmer an.
- `.pill` bleibt für Mengen- und Dienstangaben (Projekte, Hosts, Workspace-Dienste), nicht für
  Session-Zustand.

## Session in Zügen (`features/session/turns.ts`, `ChatTurns.tsx`, `40-turns.css`, EPIC-P43 T43.4)

- **Zug:** Auftrag → Arbeit → Antwort. `turnsOf(events, live)` ist eine reine Funktion über den
  vollständigen Strom; Werkzeugaufruf und Ergebnis werden zu einem Schritt mit Verb („Liest“,
  „Bearbeitet“, „Führt aus“, „Sucht“ …), Ziel und Kurzform. Systemereignisse stehen nicht im Chat,
  unbekannte Typen als eine Zeile „n unbekannte Ereignisse · im Verlauf ansehen“. Der Verlauf bleibt
  vollständig.
- **Falten:** laufende Arbeit offen, der aktuelle Schritt schimmert (`mv-shimmer`), am Zugende rastet
  das Zeichen ein (`mv-snap`) und die Arbeit faltet zu „4 Schritte · 2 gelesen · 1 bearbeitet · 8 s“.
  Auf/zu ist Gerätezustand (`sessionStorage`), kein Session-Zustand.
- **Statuszeile** (`StatusLine.tsx`): nur Gemessenes — Σ Tokens (zählt mit `useCounted`), Kontext mit
  Balken ab bekanntem Fenster (Schwellen 80/95 %), Kontingent nur mit Meldung. Unbekanntes steht im
  Bericht (Kleinkram-Regel 1).
- **Reiter:** Chat · Änderungen (Diff, darunter der Bericht; Zahl der Dateien) · Dateien (Code) · Mehr
  (Verlauf, Bericht, Datei, Graph, GitLab, Suche, Umgebung). Am Handy/Tablet ist „Mehr“ ein Blatt am
  unteren Rand, in der PC-Kachel öffnet es neben der Leiste.
- **Composer:** einzeilig (`.compact`), solange das Feld weder Fokus noch Text hat; „Verbessern“
  erscheint erst dann. Fokus auf einem Knopf klappt nicht auf (der Klick ginge sonst ins Leere).

## Tablet, PC-Kachelkopf, Schnellsuche (EPIC-P43 T43.6)

- **Tablet (700–1279 px):** in einer Session stehen die Sessions als Streifen darüber (hoch) bzw. als
  240-px-Spalte daneben (quer), Reihenfolge wie die Warteschlange (`SessionStrip.tsx`, `41-tablet.css`).
  Das Dock bleibt unten; ohne Session gilt die Übersicht wie am Handy.
- **Kachelkopf (PC):** Nummer, Griff `⠿`, Titel und Zustand, die vier Reiter als Symbole (Name als
  Tooltip und für Screenreader), rechts Stop/⋯ und Herauslösen/Leeren. Wird die Kachel schmal, rücken
  Reiter und Tasten in eine zweite Zeile, der Titel behält 160 px. „Mehr“ öffnet darunter, rechtsbündig.
- **Schnellsuche:** dasselbe Feld wie „Auftrag in Worten“ (Strg+K, Dock „Suchen“). Treffer je Art
  höchstens fünf, Wortanfang vor Teilstring; Pfeiltasten wählen, Enter springt nur mit Auswahl.

## Kleinkram-Regeln (EPIC-P43 T43.5, je Regel ein Test in `e2e/specs/kleinkram.spec.ts`)

1. **Unbekanntes schweigt** in der Leiste und steht im Bericht („keine Meldung“).
2. **Leere Reiter rücken unter „Mehr“** und sagen in einem Satz, was fehlt, mit einer Aktion
   (`.empty-state`): „Diese Session hat noch nichts geändert.“ → „Zum Chat“; „Keine Datei geöffnet …“
   → „Dateibaum öffnen“. Ein leerer Diff zählt erst als leer, wenn er geladen ist.
3. **Zeilenaktionen** (`.row-action`) erscheinen mit Maus beim Überfahren/Fokus, auf Touch nach langem
   Drücken; immer zusätzlich im Menü der Zeile („⋯“, `.row-menu`).
4. **Eine Hauptaktion je Ansicht**, gefüllt, oben rechts im Kopf (`.view-head`) — in „Änderungen“
   „Ins Projekt übernehmen“ neben „N Dateien · +A −D“; der Bericht darunter wiederholt sie nicht.
5. **Tasten tragen Worte** oder ein Symbol mit `aria-label` und `title`.
6. **Nichts liegt über dem Inhalt** — keine Randlaschen; Ebenen öffnen aus den Ansichten (`shared/layers.ts`).
7. **Formularelemente sind App-Bausteine** (Schrift der App, `appearance: none`, kein weißes Feld im Dunkeln).

## Formularelemente (`shared/forms.tsx`, `37-forms.css`)

Formularelemente sind App-Bausteine, kein Browser-Standard: `Field`, `Select`, `Switch`,
`Segmented`. Alle setzen auf den nativen Elementen auf, damit Tastatur, Screenreader und das
Auswahlrad des Handys bleiben. `01-base.css` gibt zusätzlich jedem `input`, `select`, `textarea`
und `button` Schrift, Farbe, Rahmen und (bei `select`) den Pfeil der App, mit Spezifität null —
ältere Stellen sehen damit richtig aus, ohne umgebaut zu werden. Neue Formulare nehmen die Bausteine.

**Bewegungsregel:** Glow/Scanline sind ausschließlich Statusanzeigen
(arbeitend/wartet), nie reine Dekoration — wer eine neue Animation baut, muss
sagen, welchen Zustand sie zeigt. Nur `box-shadow`/`opacity`/`transform`
(compositor-freundlich, kein Layout-Reflow). Jede Animation muss unter
`prefers-reduced-motion: reduce` vollständig verschwinden (K2-Schutz, siehe
EPIC-P1.6 AC-P1.6-8/9).

## Akzentfarbe (EPIC-P34 T34.5, Standard seit EPIC-P43 Void-Violett)

`--accent` ist pro Theme (dunkel/hell) überschreibbar: Einstellungen → Darstellung → Farbwähler (Farbfeld, Reglerstreifen,
Hex). `appearance.ts` hält die Wahl in `localStorage`, `accentInk()` wählt Schwarz oder Weiß als Schriftfarbe auf dem Akzent
nach Kontrast, `accentWarnings()` warnt bei zu geringem Kontrast zum Hintergrund, statt die Wahl zu verbieten. Alle
Akzentflächen leiten Töne per `color-mix()` aus `--accent` ab, kein fester Hex in neuen Regeln. Gespeichert wird nur die Abweichung vom Standard: wer nie gewählt hat, sieht seit P43 Violett; wer gewählt hat, behält seine Farbe.

## Erkennung (`26-discovery.css`, EPIC-P34 T34.9)

Kopf mit KPI-Kacheln (gefunden / aktiv / übernommen / Rauschen) und Anbieter-Chips, darunter Projektgruppen mit gleich hohen
Karten (Raster 2/2/1/1 nach Breite). Zustand einer Zeile wird als Text **und** Farbe gezeigt (live, ruht, übernommen,
nur lesbar), nie nur als Farbe. Temporäre Funde bündelt die Gruppe „Temporär“, Subagents hängen unter ihrer Eltern-Session.
Kartenhöhen und Schriftgrößen sind fest, damit ein Hinweis die Reihe nicht verschiebt.

## Eigene Fenster (`27-popout.css`, EPIC-P34 T34.10–T34.12)

Die Popout-Hülle (`/?window=1#/…`) zeigt nur Kopfzeile mit Titel, „In die App zurück“ und die Kachel oder Werkzeugfläche,
ohne Liste und ohne Dock; sie schreibt nie den Arbeitsbereich. Das Hauptfenster markiert ausgelagerte Kacheln mit dem
Abzeichen „⧉ eigenes Fenster“. Die Leiste „Wiederherstellen“ (RestoreBar) erscheint, wenn ein Fenster fehlt oder nicht mehr
antwortet (Heartbeat 3 s, Ablauf 10 s) und öffnet je Klick genau eines. Theme und Akzent folgen dem Hauptfenster über das
`storage`-Ereignis. Blockierte Pop-ups erscheinen als sichtbare Meldung mit Knopf, nie still.

**Herauslösen überall (EPIC-P43 T43.7, ADR-0068).** Jede Ansicht einer Session (Änderungen, Dateien, Bericht, GitLab,
Suche, Umgebung) und die Warteschlange tragen rechts im Kopf die Taste `DetachButton` („⧉“, beim Überfahren/Fokus mit
dem Wort „Herauslösen“) — nur am PC (≥ 1280 px) und nie im Fenster selbst. Die Ansicht im Hauptfenster wird zum Platzhalter
„… läuft in einem eigenen Fenster.“ mit „Fenster zeigen“ und „Zurückholen“; die Statuszeile zählt offene Fenster
(„⧉ n Fenster“).

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
  `11-report-and-diff.css`) — keine neuen Grün-/Rot-Werte.
- **P3 (T3.8, Sprachsuche):** Ergebnisliste/Datei-Viewer übernehmen
  `--font-mono` für Code-Snippets, `--accent` für Zeilen-Anker-Highlights.
- Neue Komponenten, die eine Farbe brauchen, die hier fehlt: zuerst prüfen,
  ob `color-mix(in srgb, var(--token) X%, ...)` das Problem löst, bevor ein
  neuer Hex-Wert entsteht.
