# EPIC-P18 — Desktop-Workspace: Widescreen und bis zu vier Sessions als Kacheln

**Status:** offen · **Phase:** P18 · **Dauer:** 1–1,5 Agenten-Wochen · **Abhängigkeit:** fachlich keine. Es baut auf dem Desktop-Split aus P8 auf (T8.5, AC-P8-6 grün). P17 ist abgeschlossen. Präzedenz wie P13/P14/P17: ein unabhängiges Epic neben den offenen Geräte-Abnahmen P12/P16.

Auslöser: Wunsch des Nutzers vom 2026-10-26: „Die UI auf dem Desktop, vor allem
im Widescreen, gefällt mir noch nicht. Am PC bis zu 4 Sessions gleichzeitig
sehen, schnell änderbar, so ähnlich wie auf Omarchy mit Tiles.“

## 1. Ziel

Am PC nutzt der Hub die Bildschirmbreite. Bis zu vier Sessions laufen
gleichzeitig sichtbar nebeneinander, und Layout und Belegung lassen sich mit
einem Klick oder einer Taste umstellen. Vorbild ist ein Tiling-Fenstermanager
(Hyprland/Omarchy). Die Handy-Ansicht bleibt unverändert.

Ausgangslage (Code, 2026-10-27): Ab 1280 px gibt es einen Split mit Liste links
(360–440 px) und genau **einer** Session rechts (`apps/pwa/src/app/main.tsx`,
`.split` in `02-layout.css`), gedeckelt auf 1680 px. Auf 2560 px oder einem
Ultrawide bleibt deshalb ein Drittel des Bildschirms leer. Eine zweite Session
gibt es nur in einem zweiten Browserfenster.

## 2. Scope (In / Out)

**In:**
- Widescreen-Grundlayout: kein 1680-px-Deckel, Liste einklappbar zu einer
  schmalen Leiste, Detail mit lesbarer Zeilenlänge.
- Kachelbereich mit 1–4 Sessions (`SessionTail` je Kachel) und festen Layouts:
  `1`, `2 nebeneinander`, `2 übereinander`, `1 + 2`, `2 × 2`.
- Belegung per Klick in der Liste (füllt die Fokus-Kachel), Tausch und
  Schließen je Kachel, Layout-Wahl in einer Kachel-Leiste.
- Tastatur nach Hyprland-Art (Alt statt Super, weil Super beim Fenstermanager
  bleibt): Fokus, Layout-Wechsel, Verschieben, Schließen.
- Persistenz pro Gerät (localStorage) und URL: Reload stellt Layout und
  Belegung wieder her. Der Hash zeigt die Fokus-Session (AC-P5-5 bleibt gültig).
- Token- und Kontextzeile (ADR-0032, !212) in jeder Kachel. Das kommt aus
  `SessionTail` selbst.
- K2-Messlauf mit vier gleichzeitig laufenden Kacheln.

**Out:** Freies Ziehen von Kachelgrößen (feste Layouts reichen für „schnell
ändern“, später ggf. ein Splitter), mehr als vier Kacheln, Kacheln auf dem
Handy oder Tablet unter 1280 px, mehrere Browserfenster synchron halten,
Hub-seitige Speicherung der Belegung (sie bleibt eine Gerätevorliebe wie
`controlsHidden`), neue Server-Endpunkte.

## 3. Design-Details

### 3.1 Wo der Code hinkommt (ADR-0020)

`apps/pwa/src/features/workspace/` (neu): `tiles.ts` (reiner Zustand, also
Layouts, Belegung, Fokus, Tausch und Serialisierung, voll unit-getestet) und
`TileWorkspace.tsx` (Rendering, Tastatur). `main.tsx` rendert im Wide-Zweig
statt einer `SessionTail` den `TileWorkspace`. Kein neuer globaler Store.

### 3.2 Layouts

CSS-Grid mit benannten Bereichen. Jede Kachel ist ein eigener Scroll-Container
mit eigenem Dock (`.dock-stack` bleibt in der Kachel, wie heute in
`.split-detail`).

| Layout | Kacheln | Grid |
|---|---|---|
| `1` | 1 | eine Fläche |
| `2v` | 2 | nebeneinander |
| `2h` | 2 | übereinander |
| `1+2` | 3 | groß links, zwei rechts gestapelt |
| `2x2` | 4 | Raster |

Wird beim Wechsel auf ein kleineres Layout eine Kachel überzählig, bleibt ihre
Session in der Belegung gemerkt und kommt beim Zurückwechseln wieder. Sie fällt
nicht still heraus.

### 3.3 Tastatur

| Taste | Wirkung |
|---|---|
| `Alt+1…4` | Fokus auf Kachel n |
| `Alt+L` / `Alt+Shift+L` | nächstes / voriges Layout |
| `Alt+Shift+1…4` | Fokus-Session mit Kachel n tauschen |
| `Alt+W` | Fokus-Kachel leeren |

Ist der Fokus in einem Eingabefeld, bleiben die Kürzel trotzdem aktiv, weil
sie Alt brauchen. Plain-Tasten sind tabu, sonst kollidieren sie mit dem Tippen.

### 3.4 Mehrere `SessionTail` gleichzeitig

`SessionTail` wurde für genau eine Instanz geschrieben. Zu prüfen und zu
entschärfen sind: `document.getElementById(anchor)` (Sprungmarken wie
`seit-letztem-besuch`, Tool-Anker) muss im Kachel-Container suchen statt im
Dokument, und es gibt globale Tastenkürzel (⌘/Ctrl+Enter) und
`localStorage`-Schalter (`uacc.controlsHidden`). Jede Kachel öffnet ihren
eigenen Tail-WebSocket. Das ist dasselbe wie vier Tabs, nur sichtbar.

## 4. Aufgaben

- [ ] **T18.1 — Widescreen-Grundlayout.** Kein 1680-px-Deckel. Liste
  einklappbar zur Leiste (Zustand pro Gerät). Detail mit begrenzter
  Zeilenlänge für Chat-Text, wenn nur eine Kachel offen ist. Unter 1280 px
  unverändert. K2, AC-P8-6.
- [ ] **T18.2 — Kachel-Zustand (`tiles.ts`).** Layouts, Belegung, Fokus,
  Tausch, Leeren, Layout-Wechsel ohne Verlust, Serialisierung. Rein und
  unit-getestet.
- [ ] **T18.3 — Kachel-Ansicht.** `TileWorkspace` mit Kachel-Leiste
  (Layout-Knöpfe, Kachel-Kopf mit Titel, Fokus-Markierung, ×). Klick in der
  Liste füllt die Fokus-Kachel. `SessionTail` ist mehrfach instanzierbar
  (Anker im Container, kein globaler Konflikt). E2E-Spec.
- [ ] **T18.4 — Tastatur.** Kürzel aus §3.3, sichtbar dokumentiert (Tooltip
  bzw. Hilfe im Kachel-Kopf). E2E-Spec.
- [ ] **T18.5 — Persistenz und URL.** Layout und Belegung pro Gerät. Reload
  stellt sie her. Eine nicht mehr vorhandene Session wird eine leere Kachel mit
  Hinweis (fail loud). Der Hash folgt der Fokus-Kachel. E2E-Spec.
- [ ] **T18.6 — K2 mit vier Kacheln.** `scripts/k2-frame-lag.mjs` bzw.
  Messlauf mit vier laufenden Dummy-Sessions zu je 30 ev/s. Kein Frame-Lag
  über 200 ms, drop-on-slow aktiv. Messlauf-Skill.

## 5. Acceptance Criteria

- **AC-P18-1:** Auf 2560 × 1440 nutzt die Oberfläche die volle Breite. Mit
  eingeklappter Liste bekommt der Kachelbereich ≥ 90 % der Breite (E2E misst
  das).
- **AC-P18-2:** Vier Sessions laufen gleichzeitig in `2x2`. Jede Kachel zeigt
  ihren Verlauf live, ihre Token- und Kontextzeile und ein eigenes
  Antwortfeld, das an die richtige Session sendet.
- **AC-P18-3:** Layout-Wechsel und Kachel-Tausch gehen mit einem Klick oder
  einer Taste. Nach Reload sind Layout und Belegung identisch.
- **AC-P18-4:** Unter 1280 px ist die Oberfläche unverändert. `layout.spec.ts`
  (Inhaltsanteil ≥ 50 % auf 390 × 844) und alle Mobile-Specs bleiben grün.
- **AC-P18-5:** K2 mit vier Kacheln zu je 30 ev/s: kein Frame-Lag über 200 ms.

## 6. Premortem

1. **`SessionTail` ist heimlich ein Singleton.** Sprungmarken per
   `document.getElementById`, globale Kürzel und geteilte localStorage-Schalter
   wirken in der falschen Kachel. *Mitigation:* T18.3 sucht gezielt nach
   Dokument-Zugriffen. Ein E2E prüft, dass Senden, Sprung und Kopieren in
   Kachel 3 nur Kachel 3 betreffen.
2. **Vier Live-Tails ruckeln.** Bei vier Streams, Markdown-Rendering (BUG-0067)
   und langen Verläufen leidet K2. *Mitigation:* T18.6 misst vor dem Abschluss.
   Bei Rot wird nur die Fokus-Kachel voll aktualisiert und die übrigen
   gedrosselt (sichtbar markiert), bevor Features dazukommen.
3. **Kleine Kacheln: Das Dock frisst die Kachel.** Bei `2x2` auf 1440 px Höhe
   bleiben ca. 700 px pro Kachel. Dock, Run-Strip und Kopf lassen kaum Verlauf
   übrig. *Mitigation:* In Kacheln unter 800 px Höhe startet das Dock
   eingeklappt (`controlsHidden` pro Kachel). Ein E2E misst den Inhaltsanteil
   je Kachel (≥ 40 %).
4. **Gespeicherte Belegung zeigt auf Tote.** Archivierte, gelöschte oder
   fremde Host-Sessions bleiben im localStorage. *Mitigation:* Beim Laden wird
   jede ID geprüft. Fehlt sie, gibt es eine leere Kachel mit Hinweis, nie eine
   weiße Fläche (K10).
5. **Tastenkürzel kollidieren.** Alt+Zahl ist in manchen Browsern Tab-Wechsel
   (Firefox unter Linux). *Mitigation:* Nach dem Live-Test in Chromium und
   Firefox auf Omarchy auf `Alt+Shift` ausweichen. Die Kürzel stehen im
   Tooltip, nicht nur in der Doku.

## 7. Definition of Done

- Alle AC grün mit Beleg. `npm run gate` grün, inklusive `check:arch` (neues
  Feature-Modul) und `check:workspace-links` (BUG-0069). Jede neue UI-Funktion
  hat einen Spec in `e2e/specs/` (`workspace-tiles.spec.ts`).
- Erreichbar: Die Kachel-Leiste ist ab 1280 px ohne Konfiguration da. Die
  Kürzel sind in der Oberfläche sichtbar.
- Mobile-Specs unverändert grün (AC-P18-4).
- `retro` am Ende, Abschnitt in dieser Datei.
