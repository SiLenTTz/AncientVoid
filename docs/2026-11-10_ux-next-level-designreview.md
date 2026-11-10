# UX Next Level — Design-Review, Entscheidungen und Funktionsinventar

Stand: 2026-11-10 · Grundlage für [EPIC-P43](../epics/EPIC-P43-ux-next-level.md),
[EPIC-P43.5](../epics/EPIC-P43.5-darstellungs-presets-quellenchips.md) und VoidWarden
EPIC-P13 (Repo `voidwarden`). Ergänzt [`design-system.md`](design-system.md); wo beide
sich widersprechen, gilt bis zum Abschluss von T43.1 das bestehende Design-System.

## 1. Methode

- Ist-Screenshots der PWA aus einem **isolierten Test-Hub** (`e2e/support/hub.ts`, frischer
  PWA-Build, nachgebaute Provider-CLIs) bei 412×915 und 1600×950; der produktive Hub wurde
  nicht berührt. Erfasst: Übersicht, Session (Chat, Verlauf, Bericht, Diff, Datei, GitLab,
  Suche, Code, Umgebung, Graph), Freigaben, Neue Session, Entdeckt, Runs, Notizen,
  Einstellungen, Status.
- Nyx-Kiosk: ein Screenshot des laufenden Web-Clients, dazu `web/src/style.css` und
  VoidWarden-EPIC-P11.
- **Nicht erfasst:** die Dateien-Seitenleiste mit geöffneter Datei (das Aufnahmeskript
  öffnete sie nicht), der Browser-Arbeitsplatz, Medien, PC, Popout-Fenster im Betrieb,
  helles Erscheinungsbild, echte Geräte. T43.0 holt das nach.
- Zwei Mockup-Runden als private Artifacts, im Dialog mit Jan abgestimmt:
  [Runde 1](https://claude.ai/artifact/7DXAXfm1ej3PoUKrUx5BqW) (Start, Session, Nyx-Bühne,
  Bewegungssprache) und [Runde 2](https://claude.ai/artifact/RzQGvikQWFxjA5tm3EK5cX)
  (PC-Arbeitsfläche, Herauslösen, Formfaktoren, Kleinkram-Regeln, Nyx-Blatt). Die Links
  sind Referenz, keine Spezifikation; maßgeblich sind dieses Dokument und die Epics.

## 2. Befund

| # | Befund | Beleg |
|---|---|---|
| B1 | Die Session ist ein Protokoll: `#12 · tool_use`, JSON-Rümpfe und `session.turn_end` stehen gleichrangig neben der Antwort, auch im Chat-Reiter (`#3 · system`, `#6 · system OpenCode denkt…`) | Session-Screenshots Chat/Verlauf |
| B2 | Am Handy belegen Bedienleisten bei offener Freigabe rund drei Viertel der Höhe (Kopf, Metrikzeile, Freigabekarte, Modus/Modell, Schnellantworten, Composer mit fünf Tasten, Filterumschalter, Reiterleiste) | Session mit Freigabe, 412 px |
| B3 | Zehn Session-Reiter (`TABS` in `SessionTail.tsx`), am Handy abgeschnitten; sieben Dock-Einträge mit umbrechender Beschriftung | `Dock.tsx`, Screenshots |
| B4 | Amber trägt Akzent, Links, „bereit“ und liegt dicht an der Warnfarbe; „unterbrochen“ hat keine Pille | Übersicht |
| B5 | Festbreite für Fließtext; Titel brechen ab („PLAN für das Auth-R…“). Inter ist seit P34 im Bundle | `01-base.css`, `appearance.ts` |
| B6 | Vier `@keyframes` im gesamten Stylesheet; ob ein Agent arbeitet, zeigt nur eine Pille | `styles/` |
| B7 | Fenstertaste in drei Ausführungen: winziges Symbol im Kachelkopf (`.tile-popout`), Texttaste „⧉ Eigenes Fenster“ (Graph, Datei, Notizen), randlose Taste im Dateireiter (`.files-tab-popout`) | `TileWorkspace.tsx`, `SessionTail.tsx`, `30-files.css` |
| B8 | Diff: „Notiz an Zeilen“, „Review-Notizen (0)“ und „Befunde zum Versand auswählen“ stehen ohne Notiz da; der Diff einer Datei füllt einen Bruchteil der Kachel | Diff-Screenshot Desktop |
| B9 | Leere Reiter mit Absatz: „Umgebung“ ohne `ancientvoid.workspace.json` (samt ADR-Verweis), „GitLab“ ohne MR, „Datei“ ohne offene Datei | Screenshots |
| B10 | Dauerhinweise: „Tastatur: Alt+1-4 · Alt+Shift+1-4 · …“ über den Kacheln; „Kontext unbekannt · Kontingent: Provider meldet nichts“ in jeder Session | Desktop-Screenshots |
| B11 | Unfertige Stellen: Browser-Standardfelder (Sessions filtern, Modus, Modell), breite Composer-Taste nur mit „⤢“, Zieh-Streifen „▴/▾“, Randlaschen „Dateien“/„Browser“ über dem Inhalt | Screenshots |
| B12 | Nyx-Kiosk: starkes Sprite auf stiller schwarzer Bühne, Zustand als kleine Zeile, vier Kacheln heißen gleich („AncientVoid“) | Kiosk-Screenshot |

## 3. Entscheidungen (Jan, 10.11.2026)

| # | Entscheidung |
|---|---|
| E1 | **Ruf-Farbe und Akzent sind getrennt.** Amber wird das feste System-Token für „du bist dran“. Der Akzent bleibt frei wählbar; die bestehende Ähnlichkeitswarnung des Farbwählers (`appearance.ts`, `STATUS_NEAR`) prüft künftig auch gegen die Ruf-Farbe. Verhindert wird die Wahl nicht; der Ruf bleibt dann an Form und Bewegung erkennbar |
| E2 | **Standard-Akzent: Void-Violett** (`#b58cff` dunkel; heller Wert in T43.1 mit Kontrastprüfung festlegen) |
| E3 | **Inter als Standard** für Text und Bedienung; Festbreite für Code, Pfade, Zahlen. Festbreite überall bleibt wählbar |
| E4 | **Schritte falten sich ein** und sind von Hand aufklappbar (Schritt → Ein-/Ausgabe) |
| E5 | **Nyx in der PWA** als Zustandsfigur mit kleinen Funktionen: offene Fragen mit Vorauswahl, Bestätigungen; weitere Zustände und Bewegungen, wo sie etwas aussagen |
| E6 | **P43 wird neu gefasst**; die bisherigen P43-Themen Quellenchips, Presets und benannte Layouts werden als P43.5 abgetrennt |
| E7 | **Jede Komponente, die allein auf einem zweiten Bildschirm Sinn ergibt, ist herauslösbar** (PC); die Taste dafür ist groß und überall gleich |
| E8 | **Kein Vorziehen:** P43 startet regulär nach P42 |
| E9 | **VoidWarden-Bühne wird jetzt mitgeplant** (eigenes Epic dort). Fragen am Kiosk zu beantworten braucht dort eine eigene Entscheidung (VoidWarden ADR-0009 legt sie heute als reine Anzeige fest) |
| E10 | **Leitplanke: Es geht keine Funktion verloren.** Alles bleibt auf Handy, Tablet und PC einfach auffindbar und nutzbar |

## 4. Gestaltungsregeln

### 4.1 Zustand in Farbe, Form und Bewegung

| Zustand | Farbe | Form | Bewegung |
|---|---|---|---|
| arbeitet | `--ok` | gefüllter Punkt | Atmen |
| blockiert, braucht dich (Freigabe) | Ruf (Amber) | gefüllter Punkt mit Hof | Ruf, einmalig |
| Frage | Info-Blau | gefüllter Punkt mit Hof | Ruf, einmalig |
| fertig, dein Zug | Ruf (Amber) | offener Ring | Einrasten, dann Wandern |
| Fehler / unterbrochen | `--err` | Quadrat | einmaliges kurzes Rütteln |
| ruhig | `--fg-faint` | gefüllter Punkt | keine |

### 4.2 Sechs Bewegungen

| Name | Bedeutung | Dauer |
|---|---|---|
| Atmen | ein Agent arbeitet | Schleife, nur während Arbeit |
| Schimmer | genau dieser Schritt läuft | Schleife, nur am laufenden Schritt |
| Ruf | du bist dran | einmal bei Ankunft, mit Haptik |
| Zählen | Zahl ist live (Tokens, Kosten, Laufzeit) | fortlaufend, ohne Sprünge |
| Einrasten | Schritt oder Zug fertig | einmal |
| Wandern | Element wechselt Gruppe oder öffnet sich | einmal (View Transitions/FLIP) |

`prefers-reduced-motion` und der bestehende Schalter in den Einstellungen setzen alles auf
Standbild mit gleicher Aussage. Bei Verbindungsverlust halten Atmen und Schimmer an (K10).

### 4.3 Sieben Kleinkram-Regeln

1. Unbekanntes schweigt in der Leiste; es steht im Bericht.
2. Leere Reiter verschwinden unter „Mehr“ und zeigen dort einen Satz mit einer Aktion.
3. Zeilenaktionen erscheinen beim Überfahren, bei Fokus oder langem Drücken, und stehen
   zusätzlich im Menü der Zeile.
4. Eine Hauptaktion je Ansicht, gefüllt, oben rechts.
5. Tasten tragen Worte oder ein bekanntes Symbol mit `aria-label` und Tooltip.
6. Nichts liegt über dem Inhalt.
7. Formularelemente sind App-Bausteine, kein Browser-Standard.

### 4.4 Formfaktoren

| | Handy < 700 px | Tablet 700–1279 px | PC ≥ 1280 px |
|---|---|---|---|
| Navigation | Dock (Start, Suchen, ＋, Runs, Mehr) | Dock | Leiste links |
| Aufbau | eine Spalte | Liste + Session; Hochformat: Liste als Streifen | Liste + bis zu vier Kacheln + Fenster |
| Freigabe/Frage | Blatt von unten | Blatt bzw. Karte in der Liste | Karte in der Liste, Nyx-Aufklappfeld |
| Ziele | ≥ 44 px | ≥ 44 px | ≥ 30 px |

Die Grenze 1280 px entspricht dem bestehenden `useWide()`.

## 5. Funktionsinventar (Leitplanke E10)

Jeder heutige Einstieg mit seinem neuen Ort. Die Liste entstand aus Code-Sichtung
(`Dock.tsx`, `route.ts`, `SessionTail.tsx`, `Composer.tsx`, `Dashboard.tsx`,
`TileWorkspace.tsx`, `App.tsx`) und den Screenshots. Sie ist **nicht als vollständig
belegt**; T43.0 vervollständigt sie und macht sie als E2E-Spec zum Gate.

### 5.1 Global

| Heute | Neu: Handy/Tablet | Neu: PC |
|---|---|---|
| Dock „Übersicht“ | Dock „Start“ | Leiste „Start“ |
| Dock „Neue Session“ | Haupttaste ＋ | Leiste ＋, Schnellsuche |
| Dock „Entdeckt“, Chip „Gefunden“ | „Mehr“, Chip in Start, Schnellsuche | Leiste, Schnellsuche |
| Dock „Medien“ | „Mehr“ | Leiste |
| Dock „Runs“ | Dock „Runs“ | Leiste |
| Dock „Notizen“ | „Mehr“ | Leiste |
| Dock „Einstellungen“ (inkl. PC, Push, Schrift, Akzent) | „Mehr“ | Leiste unten |
| Seite Freigaben (`#/freigaben`), Banner „1 Freigabe wartet“ | „Du bist dran“ in Start, Nyx-Blatt; Route bleibt | dito |
| Kopfzeile „Status“ (Provider-Status) | „Mehr“, Fuß des Nyx-Blatts | Statuszeile, Leiste |
| Glocke (Benachrichtigungen) | Kopfzeile, unverändert | Kopfzeile, unverändert |
| „✦ Auftrag in Worten“ (Strg+K) | Dock „Suchen“: ein Feld für Springen **und** Auftrag in Worten | Strg+K, dasselbe Feld |
| Umschalter Sessions/Projekte/Hosts | in Start, unverändert | in der Liste, unverändert |
| „Archiv“, Filterfeld, „Heute: mind. $“ | Start: Filterfeld, Archiv am Fuß von „Ruhig“, Kosten im Kopf | Liste bzw. Statuszeile |
| Karte: Repo-Graph, Anheften, Archivieren | Wischen und langes Drücken; Session-Menü „⋯“ | Überfahren, Rechtsklick; Session-Menü „⋯“ |
| Abzeichen „⧉ eigenes Fenster“ an der Karte | — (nur PC) | bleibt, holt das Fenster nach vorn |

### 5.2 Session

| Heute | Neu |
|---|---|
| Reiter Chat | Chat |
| Reiter Diff, Bericht | „Änderungen“ (Diff oben, Bericht als Abschnitt; Zähler am Reiter) |
| Reiter Datei, Code; Randlasche „Dateien“ | „Dateien“ (Baum, offene Dateien, Sprung auf Zeile) |
| Reiter Verlauf; Umschalter Überwachen/Debuggen | „Mehr → Verlauf“ mit beiden Filtern; im Chat „Details zeigen“ |
| Reiter Graph, GitLab, Suche, Umgebung; Randlasche „Browser“ | „Mehr“; am PC zusätzlich eigene Kachel oder eigenes Fenster |
| Stop, Pause | Stop als Composer-Taste während des Laufs und im Kopf (PC); Pause im Kopf (PC) und unter „⋯“ |
| Menü „⋯“: Umbenennen, Anheften/Lösen, Archivieren/Zurückholen, Löschen, Sprachbefehl, Auftrag in Worten | unverändert |
| Metrikzeile Tokens/Kontext/Kontingent, Schimmer der Kontextleiste | Statuszeile (nur Gemessenes) und Bericht (alles) |
| To-do-Liste des Agenten | Planleiste; Antippen klappt die Liste auf |
| Freigabekarte mit Laya-Einschätzung, „Regeln“, Restzeit | Blatt bzw. Karte, gleiche Inhalte |
| Rückfragen (Fragen-Dialog, `QuickConfirm` Ja/Nein) | an der Antwort im Chat und im Nyx-Blatt, mit Vorauswahl |
| Composer: Anhang, Vergrößern, Mikrofon, Verbessern, Senden/Vormerken, Schnellantworten, Slash-Commands, Skill-Overlay, Modus, Modell, Entwurfsstatus | einzeilig; „＋“ öffnet Anhang, Verbessern, Skills; Modus und Modell als Chips im aufgeklappten Composer; „/“ wie bisher; Schnellantworten am Zugende |
| „Kopieren“ je Ereignis | Überfahren, langes Drücken, Menü |
| Übergabe, „Weitermachen“ (unterbrochen), Host-Befehle, Worktree-Abzeichen, „Ins Projekt übernehmen“, `code <pfad>` | bleiben; „Ins Projekt übernehmen“ wird Hauptaktion in „Änderungen“ |
| Review-Notizen und Versand an den Agenten | „Änderungen“: „+“ an der Zeile, Sendeleiste ab der ersten Notiz |

### 5.3 PC-Arbeitsfläche

| Heute | Neu |
|---|---|
| Layoutwahl (fünf Layouts) | bleibt als Segment |
| Fokus ‹ ›, Tauschen, Layout, Leeren | Tastenkürzel wie bisher, Kachelkopf-Menü, „?“-Übersicht |
| „Liste einklappen“ | bleibt |
| Tastaturhinweis-Zeile | „?“-Übersicht |
| Fenster: Session, Werkzeugseiten, Graph, Datei, Notizen, Browser (`WindowTarget`) | bleiben; neu: Änderungen, Dateibaum, Bericht, GitLab, Suche, Umgebung, Du-bist-dran-Liste, Runs, Nyx-Blatt |
| Griff „aus dem Fenster ziehen“ | bleibt, an jedem Kachelkopf |
| Statusleiste unten | bleibt, zusätzlich Zahl offener Fenster |

## 6. Offene Punkte

- Heller Akzentwert für Void-Violett (Kontrast gegen `--bg-elev` hell).
- Nyx-Sprite in der PWA: Atlas-Kopie aus VoidWarden mit Herkunftsvermerk; keine
  Laufzeitabhängigkeit zwischen den Repos.
- Fragen am Kiosk beantworten: VoidWarden-Entscheidung plus Hub-Abhängigkeit, siehe
  VoidWarden EPIC-P13.
