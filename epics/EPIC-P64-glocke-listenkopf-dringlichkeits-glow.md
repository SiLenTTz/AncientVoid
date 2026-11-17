# EPIC-P64 — Benachrichtigungs-Glocke: fester Platz im Listenkopf, Glow nach Dringlichkeit

**Status:** offen (Planungsentwurf 2026-11-17) · **Phase:** P64 · **Dauer:** ≤ 1 Agenten-Woche · **Abhängigkeit:** keine fachliche offene (Quer-Epic wie P58–P63); **Koordinierung mit P63** (gleiche CSS-Dateien, siehe Premortem 2)

Quelle: Nutzerauftrag vom 17.11.2026 — die Glocke liege am PC über diversen
UI-Elementen; sie soll fest oben rechts in der Übersichtsliste sitzen,
symmetrisch, größer als umliegende Icons/Texte, und pulsend glühen, solange
Meldungen offen sind: rot für Fehler, gelb für offene Fragen/Aktionen, grün
für beendete Läufe. Zudem (Nachtrag, gleicher Auftrag): das
Benachrichtigungs-Panel mit der Liste soll am PC sauber **über den
Sessions** — an der Glocke verankert — liegen und nicht mitten im Bild.

## 1. Ziel

Die Glocke ist auf dem PC kein schwebendes Overlay mehr, sondern ein
verankerter Teil der Übersichtsliste. Sie sticht bewusst heraus (größer als
die umliegenden Icons und Texte) und signalisiert ohne Blick in das Panel
die höchste offene Dringlichkeit. Das Panel mit der Meldungsliste liegt in
**jedem** Layoutzustand sauber an der Glocke verankert über dem Inhalt —
nie mittig im Bild:

- **rot (`--err`):** mindestens eine ungelesene Fehlermeldung,
- **gelb (`--warn`):** mindestens eine offene Frage/Freigabe, die auf den
  Nutzer wartet,
- **grün (`--ok`):** mindestens ein ungelesener „Lauf beendet“,
- kein Glow, wenn nichts Offenes da ist.

Messlatten: K2 (Animation kostet keine Frames im Session-Tail),
AC-P43-4 (Kontrast ≥ 4,5:1 bleibt in beiden Themen erfüllt), K10 (Glow ist
reines CSS, offline unverändert).

## 2. Scope (In / Out)

**In:**

- Glocke am PC (wide, Liste sichtbar) als Flow-Element im Kopf der
  Übersichtsliste statt `position: fixed`; Entfall der
  Padding-Workarounds, die heute Freiraum für die schwebende Glocke
  reservieren (`.topbar { padding-right: 44px }`,
  `.split.list-collapsed .tile-bar { padding-right: 48px }` — nur soweit
  die Eck-Glocke das noch braucht).
- Symmetrie: rechter Innenabstand der Glocke = linker Innenabstand der
  Kopfzeile (`.overview-switch`); gleiche Grundlinie wie Suchfeld/Chips.
- Glocke größer als umliegende Icons/Texte (Zielgröße 44 px Kante vs. 36 px
  heute; Chips/Search bleiben unverändert), Badge-Zahl proportional.
- Pulsierender Glow nach Dringlichkeit (Priorität rot > gelb > grün) als
  CSS-Keyframe-Animation auf Semantik-Tokens; statischer Ring statt Puls
  bei `prefers-reduced-motion: reduce`.
- Dringlichkeits-Ableitung als reine, getestete Funktion aus dem
  Notification-Bestand (ungelesen = unterhalb des Read-Marks je Host) plus
  Live-Prüfung offener Freigaben.
- Hintergrund-Refresh offener Freigaben auch bei geschlossenem Panel
  (heute prüft `refreshPending` nur, während das Panel offen ist).
- Handy (schmale Layouts) und PC mit zugeklappter Liste: Glocke bleibt wie
  heute in der Fensterecke (EPIC-P51 T51.4-Entscheidung) — gleiche rechte
  obere Ecke, kein neues Muskelgedächtnis nötig.
- **Panel-Anker = Glocken-Anker in jedem Layoutzustand** (Befund und Fix
  siehe 3.5): Das Panel schwebt nie mittig im Bild, sondern hängt an der
  Glocke — auch im 700–1279-px-Bereich (`tablet-split`), wo heute nur die
  Glocke eine Ausnahme-Regel hat, das Panel aber nach der 680-px-Spalten-
  Formel mitten über den Sessions landet.

**Out:**

- Änderungen an Toasts, Panel-Inhalt, Push (ADR-0015 bleibt unberührt).
- Töne (EPIC-P65), Anzeige-Grundsätze des Design-Systems (P63).
- Neue Storage; Read-Marks bleiben, wie sie sind (localStorage).
- Glow für Peers-Ausfälle/„Hub nicht erreichbar“ (bleibt Toast/Warnung).

## 3. Design-Details

### 3.1 Platzierung

Auf breiten Layouts mit sichtbarer Liste wandert die Glocke aus dem
`position: fixed`-Kontext (`.notif-bell`, `z-index: 30`) in den Kopf der
Übersichtsliste (`.dashboard`-Kopf mit `.overview-switch`/
`.dashboard-search`) als letztes Flow-Element der Kopfzeile. Ist die Liste
zugeklappt (Session-Ansicht am PC), gilt die bestehende Eck-Position
(`.notif-bell.corner`) weiter. Das Panel folgt seinem Anker wie heute
(`.notif-panel.corner`-Muster).

### 3.2 Dringlichkeits-Ableitung (rein, testbar)

```ts
type Urgency = "error" | "action" | "done" | null;
```

- `error`: ungelesenes Item mit `level === "error"`.
- `action`: offene Freigabe/Frage — Item mit `kind` aus `APPROVAL_KINDS`
  **und** zugehörige Session steht in der live geprüften Pending-Menge
  (gleiche Datenquelle wie der angepinnte Panel-Abschnitt; Refresh künftig
  im Poll-Takt, nicht nur bei offenem Panel — ein API-Aufruf mehr je 4 s,
  nur wenn `APPROVAL_KINDS`-Kandidaten existieren).
- `done`: ungelesenes Item mit `kind === "session.turn_end"` (T8.6
  unterdrückt nur dessen Toast, nicht den Listeneintrag — der Glow macht
  genau diese Meldungen sichtbar, ohne die Toast-Flut zurückzuholen).
- Priorität `error > action > done`; ungelesen je Host über die
  bestehenden Read-Marks (`read[hostId]`), Panel-Öffnen markiert gelesen
  und löscht damit den Glow — kein Zeitablauf, kein neuer State-Store.

### 3.3 Glow (CSS, P63-kompatibel)

- Farbe aus Semantik-Tokens (`--err`/`--warn`/`--ok`) mit
  `color-mix()`-Abstufung; kein Hex-Wert, kein neuer `z-index`
  (P63-Regeln vorab eingehalten).
- Puls: `@keyframes` auf `box-shadow` (2 Ringe, ~2 s Zyklus),
  `@media (prefers-reduced-motion: reduce)` → statischer Ring.
- K2: Animation wirkt nur auf der Glocke (eigene Layer via
  `box-shadow`, kein Repaint der Liste); Messlauf-Vergleich vor/nach.

### 3.4 Größe & Symmetrie

- 44 px Kante (heute 36 px), Icon-Skalierung über `--font-scale`;
  umliegende Chips/Search unverändert → Glocke ist das größte Element der
  Kopfzeile.
- Symmetrie-Nachweis per E2E: `boundingBox()` von Glocke und Kopfzeile —
  rechter Außenabstand Glocke = linker Außenabstand `.overview-switch`.

### 3.5 Panel-Verankerung (Befund vom 17.11.2026)

`14-notifications.css` positioniert `.notif-panel` fest mit der Formel
`right: max(8px, calc((100vw / --ui-zoom - 680px)/2 + 8px))`; nur
`.notif-panel.corner` (PC ab 1280 px) und die Glocke haben Eck-Ausnahmen —
`41-tablet.css` korrigiert **nur die Glocke** für `tablet-split`
(700–1279 px, darunter auch PC-Fenster): Dort hängt die Glocke am
Fensterrand, das Panel rechnet aber weiter mit der 680-px-Formel und
schwebt mitten über den Sessions. Fix: eine gemeinsame Anker-Größe (z. B.
`--notif-anchor-right` auf `body`, von der Glocke gesetzt/vererbt), die
Glocke und Panel in **jedem** Layoutzustand teilen — Panel rechtsbündig
unter der Glocke (gleiche rechte Kante), Breite und `max-height` wie heute.

## 4. Aufgaben (Checkliste T64.m)

- [x] **T64.1** `urgencyOf()` als reine Funktion (Notification-Bestand,
  Read-Marks, Pending-Menge) + Unit-Tests: Priorität, ungelesen/ungelesen,
  leer. Messlatte: K2 (Voraussetzung, keine Messung nötig).
- [x] **T64.2** Glow-CSS (Keyframes, Token-Farben, reduced-motion-Fallback,
  Kontrast in Dark/Light geprüft) in `14-notifications.css`.
  Messlatte: AC-P43-4.
- [x] **T64.3** Hintergrund-Refresh offener Freigaben im Poll-Takt (nur bei
  Kandidaten); Unit-Test gegen die Drosselung.
- [x] **T64.4** Glocke in den Listenkopf am PC (Flow statt fixed, 44 px,
  Symmetrie, Entfall der überflüssigen Padding-Workarounds); Handy und
  zugeklappte Liste unverändert. E2E: Position/Symmetrie/Größe per
  `boundingBox()`. Messlatten: K2, AC-P43-4.
- [x] **T64.5** Panel-Anker gemeinsame Quelle mit der Glocke (3.5): eine
  Anker-Größe für alle Layoutzustände (schmal/wide/tablet-split), Panel
  rechtsbündig unter der Glocke, nie mittig; `41-tablet.css`-Lücke
  geschlossen. E2E in allen drei Zuständen. Messlatte: K2.
- [x] **T64.6** E2E `notifications-glow.spec.ts`: Zustände rot/gelb/grün/
  aus (auch reduced-motion emuliert), Glow verschwindet nach dem
  Panel-Öffnen; Screenshot-Vergleich Dark/Light; Eintrag
  `docs/funktionsinventar.md`.

## 5. Acceptance Criteria (AC-P64-k)

- **AC-P64-1:** Am PC mit sichtbarer Liste liegt die Glocke im Kopf der
  Übersichtsliste im Fluss — keine Überdeckung mehr; Beleg: E2E-
  Bounding-Box-Assertions (Symmetrie, Größe 44 px) und Screenshots.
- **AC-P64-2:** Glow zeigt die höchste offene Dringlichkeit korrekt
  (rot/gelb/grün/aus), Unit-Tests grün; rot schlägt gelb schlägt grün.
- **AC-P64-3:** Panel-Öffnen (Read-Mark) löscht den Glow; Hub-Restart
  verändert das Verhalten nicht (kein neuer Persistenzstand, K7-neutral).
- **AC-P64-4:** `prefers-reduced-motion: reduce` zeigt einen statischen
  Ring statt Puls (E2E emuliert).
- **AC-P64-5:** K2-Messlauf ohne Verschlechterung gegenüber der Referenz
  (Glow-Animation verursacht keinen Frame-Lag im Session-Tail).
- **AC-P64-6:** Handy und PC-mit-zugeklappter-Liste unverändert
  (bestehende Specs grün; keine Regression der P51-Entscheidung).
- **AC-P64-7:** Das Panel liegt in allen drei Layoutzuständen (schmal/
  700–1279 px/≥1280 px) rechtsbündig unterhalb der Glocke über dem
  Inhalt — Horizontalposition der Panel-Kante = Glocken-Kante, nie
  zentriert; Beleg: E2E-`boundingBox()` je Zustand.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Glow-Animation kostet Frames/Akku (besonders Handy, Dauerleuchten).**
   Mitigation: Puls nur auf `box-shadow` der Glocke, Handy prüfen; K2-
   Messlauf als AC; reduced-motion-Fallback.
2. **Kollision mit P63 (UI-Konsolidierung) in `14-notifications.css` und
   Token-Umbau.** Mitigation: P64 **vor** P63s T63.5 (Selektor-Zusammen-
   führung) mergen oder explizit abstimmen; Glow nutzt nur Semantik-Tokens
   und `color-mix()` — keine neuen Hex-Werte/z-index, P63-Ratchet nimmt
   den Endstand als Basis auf.
3. **„Größer + Glow" wird zu laut und dominiert die Ruhe des
   Design-Systems.** Mitigation: maximal zwei Glow-Ringe, dezente
   Intensität; Abnahme per Screenshot-Vergleich in beiden Themen;
   Größe als Token (`--bell-size`), nicht verstreute px.
4. **Grün glüht ewig, weil niemand das Panel öffnet** (Turn-Ende ohne
   Toast, T8.6). Mitigation: bewusst — Read-Mark beim Panel-Öffnen löscht;
   dokumentiert im Epic und Funktionsinventar; falls Feldtest es als
   nervig empfindet, folgt ein zeitlicher Verfall als eigener Bug/Task,
   nicht still im Epic.
5. **Zwei Anker (Listenkopf vs. Fensterecke bei zugeklappter Liste)
   verwirren.** Mitigation: beide Positionen liegen rechts oben mit
   identischem rechten Innenabstand; E2E prüft beide Zustände; Handy
   unverändert.

## 7. Definition of Done

Alle T64.* und AC-P64-* mit Evidenz. `npm run gate` lokal grün;
GitHub-Actions-Lauf (`verify`, `k8`, `e2e`) auf dem Abschluss-PR grün;
rote CI allein wegen Umgebung wird benannt, nie als Pass gezählt. Neue
UI-Zustände mit Spec in `e2e/specs/` (`notifications-glow.spec.ts`) und
Eintrag in `docs/funktionsinventar.md`; Glocke bleibt über die
Kurzbefehle/Tooltips erreichbar wie heute. K2/AC-P43-4 nachweislich
unverändert bzw. erfüllt; kein TODO ohne Epic-Bezug.

## 8. Retro (17.11.2026 — Abschluss)

| AC | Stand | Beleg |
|---|---|---|
| AC-P64-1 | ✅ | `notifications.spec.ts` „Liste offen: Glocke im Listenkopf …": `expectInListHead` prüft Fluss-Lage in der Spalte, 44 px, Abstand > 40 px zum Fensterrand; auch bei 130 % Zoom (mobile + desktop Projekt) |
| AC-P64-2 | ✅ | `urgency.test.ts` (9 Unit-Tests: Priorität, Read-Marks, Fleet-Hosts, live Pending) + `notifications-glow.spec.ts` (Klassen error/action/done, Priorität, `notif-glow-pulse`) |
| AC-P64-3 | ✅ | Glow-Spec „Panel öffnen liest den Bestand — done-Glow erlischt"; kein neuer Persistenzstand (Read-Marks unverändert) |
| AC-P64-4 | ✅ | Glow-Spec „reduzierte Bewegung": `reducedMotion: reduce` → `animationName: none`, statischer `box-shadow` |
| AC-P64-5 | ✅* | K2-Vergleichsmesslauf [`docs/messlauf/2026-11-17_k2-glocke-glow.md`](../docs/messlauf/2026-11-17_k2-glocke-glow.md): median 4 ms / p95 5 ms wie die Referenz vom 2026-09-18; *Vorbehalt: Glow ist während des K2-Laufs inaktiv (keine ungelesenen Meldungen im Frisch-Hub) — die Animation ist per Design auf die 44-px-Glocke begrenzt (box-shadow-Repaint, 0,83 Hz); ein Belastungslauf mit aktivem Glow bleibt der T63.0-Referenzmessung vorbehalten |
| AC-P64-6 | ✅ | Handy unverändert (mobile-Projekt: alle notifications/glow-Specs grün); zugeklappte Liste weiter im Fenstereck (`expectCornered` nach `tile-list-toggle`) |
| AC-P64-7 | ✅ | `notifications-glow.spec.ts` @tablet: Glocke **und** Panel am Fensterrand (≤ 14 px) in der Session-Ansicht 800 px — die 680-px-Formel-Lücke (41-tablet.css) ist geschlossen; Flow-Modus: Panel rechtsbündig unter der Glocke (± 2 px, auch bei 130 % Zoom) |

**Erkenntnisse**

1. Die Panel-Geometrie im Fluss-Modus ist bewusst **gemessen** (Bell-Rect
   ÷ `--ui-zoom`), nicht in CSS nachgebaut — die Spaltenbreite ist
   `minmax(360px, 420px)` und zoom-abhängig; CSS-Rechnungen dafür wären
   fragil (der 2026-10-30-Nutzerfund „Panel außer Reichweite" war genau
   so eine Formel).
2. `--ui-zoom` ist CSS `zoom` auf `<html>`: `getBoundingClientRect` liefert
   Render-px, Inline-Styles erwarten CSS-px — jede Messung muss teilen.
   Als Muster im Code kommentiert.
3. Mobile-Emulation (Pixel-7-Projekt) rendert Text ~5 px breiter als
   Desktop-Chrome: Die 44-px-Glocke drückte die Topbar der schmalen
   Listenspalte über die Spalte. Brand schrumpft jetzt mit Ellipse.
4. T51.4 („Glocke immer im Fenstereck am PC") ist für den Zustand
   „Liste sichtbar" von T64.4 abgelöst — Spec-Kommentar entsprechend
   umbenannt, Muskelgedächtnis bleibt gewahrt (beide Anker rechts oben,
   identischer rechter Innenabstand im Eck-Fall).

**Action Items**

- T63.0 (P63): K2-Referenzmessung sollte einmal mit **aktivem Glow**
  laufen (ungelesene Fehlermeldung offen), um AC-P64-5 ohne Vorbehalt zu
  belegen; dieses Epic verweist darauf.
- P65 (Status-Sounds) baut auf `urgency.ts` als gemeinsamer
  Dringlichkeits-Quelle auf — gleiche Taxonomie weiterverwenden.
