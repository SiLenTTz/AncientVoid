# EPIC-P43 — UX Next Level: Leitstand, der lebt

**Status:** umgesetzt, Abnahme mit offenen Punkten (Retro 2026-11-11: 8 🟢 / 3 🟡) · **Umsetzung:** freigegeben (Nutzerauftrag 11.11.2026, siehe unten) · **Phase:** P43
**Dauer:** 4–6 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P42 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.
**Freigabe 11.11.2026 (Jan):** „Setze jetzt bitte Epic 43 sauber um“ — ausdrücklich auch für den Fall, dass P42 nicht begonnen ist (Stand: P42 offen, läuft parallel mit einem anderen Agenten). Das hebt E8 („kein Vorziehen“) für dieses Epic auf. Fachlich hängt P43 an P42 nur über das Funktionsinventar: Kommt das Geräte-Panel aus P42 hinzu, trägt P42 seine Zeilen in `docs/funktionsinventar.md` und den Spec ein.

Quelle: [Design-Review vom 10.11.2026](../docs/2026-11-10_ux-next-level-designreview.md)
(Befund B1–B12, Entscheidungen E1–E11, Funktionsinventar) und
[UX-Audit vom 10.11.2026](../docs/2026-11-10_p43-ux-audit.md) (12 Befunde mit Vorher-Bildern, je Befund die Ziel-Aufgabe). Referenz-Mockups, bedienbar, im Repo:
[Runde 1](../docs/mockups/2026-11-10_ux-next-level-runde-1.html) (Start, Session, Nyx-Bühne, Bewegungssprache) und
[Runde 2](../docs/mockups/2026-11-10_ux-next-level-runde-2.html) (PC-Arbeitsfläche, Herauslösen, Formfaktoren, Kleinkram, Nyx-Blatt).
**Planungsauftrag 10.11.2026 (Jan):** Dieses Epic ersetzt den bisherigen P43-Entwurf
„Arbeitsfläche/Styling“. Dessen Themen Quellenchips, Presets und benannte Layouts leben in
[EPIC-P43.5](EPIC-P43.5-darstellungs-presets-quellenchips.md) weiter. Kein Vorziehen (E8).
Vor T43.0 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

Die PWA zeigt zuerst, was den Menschen braucht, erzählt eine Session in Zügen statt in
Ereigniszeilen und macht Arbeit durch Bewegung mit fester Bedeutung sichtbar. Sie sieht auf
Handy, Tablet und PC sauber aus, und am PC lässt sich jede eigenständige Komponente in ein
eigenes Fenster herauslösen. **Dabei geht keine Funktion verloren** (E10).
Messlatten: K1 (Freigabe < 5 s), K2 (Latenz/Flüssigkeit, auch mit vier Kacheln), K3 (Diff),
K7 (Zustand rekonstruierbar), K10 (Offline sichtbar).

## 2. Scope (In / Out)

**In:** Funktionsinventar als Gate; Gestaltungsfundament (Inter-Standard, Skalen, Ruf-Token
getrennt vom Akzent, Void-Violett als Standard-Akzent, eigene Formularelemente,
Bewegungs-Tokens); Zustandssprache mit neuem Anzeigezustand „Frage“; Start als
Warteschlange; Session in Zügen; „Änderungen“ und „Dateien“ samt Kleinkram-Regeln;
Tablet-Zweispalter und PC-Kachelkopf; Schnellsuche im bestehenden Befehlsfeld; einheitliches
Herauslösen mit neuen Fensterzielen; Nyx-Blatt; Hub-Berechtigung, mit der ein Display-Akteur Optionsfragen beantwortet (AV-D3 für VoidWarden P13).

**Out:** Quellenchips, Presets/Import/Export, benannte Layouts (P43.5); Plugin-Panels und
-Themes (P44); Preact→React-Migration; neue native App; neue Hub-Fachfunktionen; Änderung
der semantischen Farben `--ok`/`--err`; mehr als vier Kacheln; Änderungen an VoidWarden
(eigenes Epic dort, VoidWarden bleibt eigenständig); die Kiosk-Oberfläche für Fragen (VoidWarden P13); Freitext-Antworten vom Display.

## 3. Design-Details

### 3.0 Referenz-Mockups
Die beiden HTML-Dateien unter `docs/mockups/` sind eigenständig lauffähig (im Browser öffnen) und halten den abgestimmten Stand vom 11.11.2026 fest; dieselben Seiten liegen als private Artifacts vor (Links im Design-Review). Sie sind **Referenz für Aufbau, Zustandssprache und Bewegung, keine Spezifikation**: Bei Abweichung gelten dieses Epic und das Funktionsinventar. Bewusste Vereinfachungen der Mockups: Symbole sind Platzhalter, Inhalte sind Beispiele, „Mehr“-Menüs, helles Erscheinungsbild und Tablet-Ansicht sind nicht gezeichnet. T43.0 legt die Vorher-Screenshots daneben ab, T43.9 die Nachher-Screenshots.

### 3.1 Leitplanke: Funktionsinventar zuerst
Das Inventar in Design-Review §5 wird in T43.0 vervollständigt (alle Seiten, Reiter, Menüs,
Composer-Funktionen, Kachel- und Fensteraktionen, helles Erscheinungsbild) und als
`e2e/specs/funktionsinventar.spec.ts` ausführbar: je Eintrag ein Test, der die Funktion am
Handy, Tablet und PC über den dokumentierten Weg erreicht. Der Spec ist **vor** dem Umbau
grün (heutige Wege), jede Umbau-Aufgabe ändert Weg und Test im selben Commit. Ein Eintrag
darf nur mit ausdrücklicher Nutzerentscheidung entfallen. Obergrenze für die Tiefe: jede
Funktion in höchstens drei Interaktionen ab Start oder ab geöffneter Session, zusätzlich
über die Schnellsuche auffindbar.

### 3.2 Fundament
Bestehende Token-Namen bleiben (`design-system.md`), damit Komponenten sich weiter
automatisch umfärben. Neu: `--call`/`--call-ink` (Ruf, Amber, fest), `--info` (Frage);
`--accent` bekommt den Standard `#b58cff` (dunkel), der helle Wert wird mit der vorhandenen
Kontrastrechnung festgelegt. Wer in den Einstellungen bereits einen eigenen Akzent gewählt
hat, behält ihn; nur der Standard wechselt. `STATUS` in `appearance.ts` nimmt die Ruf-Farbe
auf, damit die Ähnlichkeitswarnung greift. `--font-ui` steht standardmäßig auf Inter;
gespeicherte Schriftwahl bleibt. Skalen für Abstände (4/8/12/16/24) und Größen, Mindestziele
44 px (Touch) und 30 px (Maus). Bewegungs-Tokens (Dauer, Kurve) und die sechs Bewegungen aus
Design-Review §4.2 als wiederverwendbare Klassen in `shared/`. Formularelemente (Feld,
Auswahl, Schalter, Segment) als Bausteine in `shared/`.

### 3.3 Zustandssprache
Ein Baustein `StatusDot` kodiert Zustand in Farbe, Form und Bewegung (Design-Review §4.1)
und ersetzt Pillen und Punkte in Karte, Kopf, Kachel, Statuszeile. „Frage“ ist ein
**Anzeigezustand** der PWA: `waiting_approval` plus offene Anfrage mit Werkzeug aus
`QUESTION_TOOLS`. Der `SessionStatus`-Contract bleibt unverändert; reicht die vorhandene
Information nicht aus, kommt vor der Umsetzung ein ADR.

### 3.4 Start als Warteschlange
Drei Gruppen: „Du bist dran“ (Freigaben, Fragen, fertige Züge, Unterbrechungen; älteste
bzw. kürzeste Restzeit zuerst), „Arbeitet“ (laufender Schritt, Laufzeit, Planfortschritt
aus `run-progress.ts`), „Ruhig“ (eingeklappt, samt Archiv). Entscheidbare Freigaben tragen
Befehl, Laya-Einschätzung, Restzeit und Erlauben/Ablehnen auf der Karte; Freigaben mit
Begründungspflicht oder WebAuthn öffnen wie bisher die Session. Der Umschalter
Sessions/Projekte/Hosts, Filterfeld und Tageskosten bleiben. Gruppenwechsel einer Session
sind sichtbar (Wandern). Das Dock hat vier Ziele plus Haupttaste.

### 3.5 Session in Zügen
Eine reine Funktion gruppiert den Ereignisstrom zu Zügen: Nutzernachricht → Arbeit
(Werkzeugaufrufe als Schritte mit Verb, Ziel, Ergebnis-Kurzform) → Antwort. Laufende Arbeit
steht offen mit Schimmer am aktuellen Schritt; am Zugende faltet sie sich zu einer Zeile
(„4 Schritte · 38 s“). Antippen klappt die Schritte auf, ein Schritt zeigt Ein- und Ausgabe
(Blob-Nachladen wie bisher, K5). Systemereignisse und unbekannte Ereignistypen erscheinen
nicht im Chat, bleiben aber **vollständig** im Verlauf; unbekannte Typen zeigt der Chat als
eine Zeile „1 unbekanntes Ereignis · im Verlauf ansehen“ (Fail loud). Der Zustand
auf/zu ist Gerätezustand, kein Session-Zustand (K7). Eine Statuszeile ersetzt Pille und
Metrikband (nur Gemessenes, Kontext als Balken mit Schwellen 80/95 %). Der Composer ist
einzeilig und klappt beim Fokus auf; alle bisherigen Funktionen bleiben erreichbar
(Inventar §5.2). Vier Reiter: Chat, Änderungen, Dateien, Mehr.

### 3.6 Änderungen, Dateien, Kleinkram
„Änderungen“ vereint Diff und Bericht: Kopf mit Zusammenfassung und Hauptaktion „Ins Projekt
übernehmen“, Dateiliste mit Plus/Minus-Balken, Diff, Notiz über „+“ an der Zeile (P36-Fluss
unverändert), Sendeleiste ab der ersten Notiz. „Dateien“ nimmt Dateibaum, offene Dateien und
den Zeilensprung auf; die Randlaschen entfallen. Die sieben Kleinkram-Regeln (Design-Review
§4.3) gelten für alle Ansichten und werden je Regel mit einem Test belegt.

### 3.7 Tablet und PC
Tablet (700–1279 px): Liste und Session nebeneinander, im Hochformat die Liste als Streifen;
Dock unten. PC: Leiste, Liste, Kacheln. Der Kachelkopf trägt Griff, Titel, Zustand, die vier
Reiter und rechts „Herauslösen“; die senkrechte Symbolleiste je Kachel entfällt.
Tastaturhinweise stehen hinter „?“ (Baustein an P51 T51.7 abgegeben — Nutzerauftrag
11.11.2026, wird dort mit der zentralen Shortcut-Registry gebaut). Die Schnellsuche erweitert das bestehende Befehlsfeld
(`features/commands`, Strg+K): Springen zu Sessions, Projekten, Dateien, Werkzeugen und
Befehlen, darunter weiterhin „Auftrag in Worten“. Kein zweites Kürzel, kein neuer
Volltextindex.

### 3.8 Herauslösen überall
Eine Taste (`DetachButton`), immer letzte im Kopf, 30 px, Beschriftung beim Überfahren und
Fokus; zusätzlich Griff-Ziehen und Schnellsuche. `WindowTarget` (`features/windows/protocol.ts`)
erhält neue Arten: `changes`, `files`, `report`, `forge`, `search`, `environment`, `queue`,
`runs`, `nyx`. Herausgelöstes hinterlässt in der Kachel einen Platzhalter mit „Zurückholen“
und „Fenster zeigen“; die Statuszeile zählt offene Fenster. Fenster verbinden sich selbst
neu und zeigen offline den letzten Stand (bestehendes Verhalten der `PopoutShell`). Die
Erweiterung braucht ein ADR, das ADR-0053 fortschreibt (Zielarten, Platzhalter, Verhalten
bei geschlossenem Hauptfenster). Verborgene Browser-/Emulatorströme laufen nicht im
Hintergrund weiter.

### 3.9 Nyx-Blatt
Eine kleine Nyx in Kopfzeile bzw. Leiste zeigt den Gesamtzustand nach der Priorität aus
VoidWarden `spec.md` §5.1 (offline > Freigabe > Frage > Fehler > arbeitet > ruhig), als reine
Funktion in der PWA nachgebaut. Antippen öffnet das Blatt: alle wartenden Freigaben und
Fragen über alle Sessions. Fragen zeigen die Optionen des Agenten als Tasten, die empfohlene
vorgewählt, plus „Eigene Antwort“; Ja/Nein-Fragen genügt ein Tipp. Grundlage sind der
Fragen-Dialog aus P21 und `QuickConfirm`; es entsteht kein zweiter Antwortweg zum Hub.
Freigaben mit Begründungspflicht oder WebAuthn verweisen in die Session. Nyx' Satz ist eine
feste Vorlage je Zustand, nie Agenten-Text (PRD §8.5). Der Sprite-Atlas wird mit
Herkunftsvermerk in die PWA kopiert; es gibt keine Laufzeitabhängigkeit zu VoidWarden.

### 3.10 Fragen vom Display beantworten (AV-D3)
Heute lehnt der `decide`-Handler für den Akteur `display` jede Provider-Rückfrage ab
(`tool.question`, ADR-0048 Punkt 4). Entscheidung E11 öffnet einen engen Fall: Ein Display
darf eine Rückfrage beantworten, wenn **alle** Bedingungen gelten: jede Teilfrage hat vom
Agenten vorgegebene Optionen; die Antwort nennt je Teilfrage genau eine dieser Optionen
(der Hub prüft das gegen die gespeicherte Anfrage, wortgleich); kein Freitext, keine
Mehrfachauswahl; die Anfrage ist nicht `destructive` und nicht `reasonRequired`; das
Display-Token trägt die neue, je Token einzeln vergebene Berechtigung (Standard: aus,
`hubctl token issue <name> --display --answer-questions`). Alles andere bleibt 403, auch bei
unbekannter ID (Policy vor Existenz, kein Info-Leak). Die Antwort läuft über den bestehenden
Weg `POST /api/approvals/:id/decide` mit `answers` (`DecideApprovalInput`), bleibt „höchstens
einmal“ (ADR-0019) und steht mit dem Label `display:<name>` im Audit. Die Liste/Detail-Route
liefert dem Display dafür ein Feld „am Display beantwortbar“, damit der Companion nichts rät.
Das ist eine Änderung an Policy und Display-Vertrag und braucht **vor** der Umsetzung ein ADR,
das ADR-0048 fortschreibt. Die PWA ist davon nicht betroffen; die Aufgabe hängt an keiner
anderen P43-Aufgabe.

## 4. Aufgaben (Checkliste T43.m)

- [x] **T43.0** Funktionsinventar vervollständigen (inkl. der im Design-Review nicht erfassten Flächen) und als `e2e/specs/funktionsinventar.spec.ts` für Handy, Tablet, PC grün machen; Vorher-Screenshots 412/800/1280/1600 px ablegen. **K1/K10**. — **Vorarbeit 2026-11-10 (MR !364):** [UX-Audit](../docs/2026-11-10_p43-ux-audit.md) mit Vorher-Bildern Handy/Desktop für vier Journeys und 12 Befunden; offen daraus: echter Pixel, CI-Anteil von Journey 4, Zähler-Befund #5 messen, Nutzerabnahme der Befundliste. — **Erledigt 2026-11-11:** [`docs/funktionsinventar.md`](../docs/funktionsinventar.md) (58 globale, 64 Session- und 16 PC-Zeilen; 79 davon im Inventar-Spec, der Rest mit benanntem Bestands-Spec, vier bekannte Lücken ausgewiesen), `e2e/specs/funktionsinventar.spec.ts` grün auf Handy, Tablet und PC, Vorher-Bilder in vier Breiten. Der Spec fand BUG-0118 (Session-Menü unter der Steuerung), im selben MR behoben. Offen aus der Vorarbeit bleiben echter Pixel und Nutzerabnahme der Befundliste (T43.9).
- [x] **T43.1** Fundament: Tokens (`--call`, `--info`, Standard-Akzent, Skalen, Bewegung), Inter-Standard mit Bestandsschutz gespeicherter Wahl, Formular-Bausteine, `design-system.md` fortschreiben; Kontrasttests für beide Erscheinungsbilder. **K2/K10**. — **Erledigt 2026-11-11:** Tokens in `01-base.css` (`--call` Amber getrennt vom Akzent Void-Violett, `--info`, Abstands-/Schrift-/Bewegungsskalen, `--target`), Inter als Standard ohne Migration (gespeicherte Wahl bleibt, E2E-Nachweis in `appearance-font.spec.ts`), `36-motion.css` + `shared/motion.ts`, `37-forms.css` + `shared/forms.tsx`, Kontrasttests `apps/pwa/test/app/tokens.test.ts` für beide Erscheinungsbilder (dokumentierte Ausnahme: `--ok` hell 4,2:1, semantische Farben sind laut Scope unverändert).
- [x] **T43.2** Zustandssprache: `StatusDot`, Anzeigezustand „Frage“, sechs Bewegungen als Bausteine mit „Bewegung reduzieren“; alle Pillen/Punkte umstellen. **K2**. — **Erledigt 2026-11-11:** `shared/StatusDot.tsx` + `shared/display-state.ts` (sechs Anzeigezustände, „Frage“ aus `tool.questions`, „fertig“ aus dem Lesezeiger des Geräts; kein Contract geändert), eingesetzt in Karte, Session-Kopf, Statusleiste und Vorschau; umlaufende Randlinien entfernt (nur noch Atmen und Schimmer als Schleifen), Schalter heißt „Bewegung“, `data-conn="off"` hält Schleifen an. Nachweis: `e2e/specs/zustandssprache.spec.ts`, `apps/pwa/test/shared/display-state.test.ts`. Die Bewegung „Zählen“ ist als Funktion (`countStep`) vorhanden und wird mit der Statuszeile in T43.4 angeschlossen.
- [x] **T43.3** Start als Warteschlange mit Entscheidung auf der Karte, laufendem Schritt, Gruppenwechsel, Dock neu. **K1/K2**. — **Erledigt 2026-11-11:** Gruppen „Du bist dran“ / „Arbeitet“ / „Angeheftet“ / „Ruhig“ aus dem Anzeigezustand (`features/overview/queue.ts`), „Ruhig“ zu, solange oben etwas steht (Wahl ist Gerätezustand); entscheidbare Freigaben mit Befehl, Laya-Einschätzung, Restzeit und Erlauben/Ablehnen auf der Karte (`CardDecision`, derselbe `decide`-Weg), Rückfragen/Begründung/WebAuthn öffnen weiter die Session; Gruppenwechsel mit „Wandern“; Dock mit Start, Suchen, ＋, Runs, Mehr (am PC stehen alle Ziele weiter einzeln in der Leiste). Nachweis: `e2e/specs/start-warteschlange.spec.ts`, `dock-visibility.spec.ts`, `apps/pwa/test/features/overview-relevance.test.ts`, Inventar G01–G18 angepasst, G59–G63 neu. **Abweichungen:** (1) „Angeheftet“ bleibt als vierte, offene Gruppe, weil Anheften sonst in der zugeklappten Gruppe „Ruhig“ verschwände; (2) der Planfortschritt steht nur auf der Karte, wenn dieses Gerät den Verlauf der Session aktuell hat (Tail-Cache) — der Hub liefert ihn nicht im `SessionRecord`, eine Erweiterung wäre eine Contract-Änderung mit ADR; (3) die Laufzeit auf der Karte ist die Zeit seit dem letzten Schritt.
- [x] **T43.4** Session in Zügen: Gruppierungsfunktion mit Unit-Tests gegen aufgezeichnete Fixtures aller Adapter, Falten/Aufklappen, Statuszeile, Composer, vier Reiter; Verlauf unverändert vollständig. **K2/K5/K7**. — **Erledigt 2026-11-11:** `features/session/turns.ts` (reine Funktion, 19 Unit-Tests gegen normalisierte Mitschnitte von claude, codex, opencode, copilot, pi — erzeugt mit `scripts/turn-fixtures.ts`), `ChatTurns.tsx` (Falten/Aufklappen, Schritt mit Ein-/Ausgabe, unbekannte Typen als eine Zeile), `StatusLine.tsx` (nur Gemessenes, Zählen angeschlossen), Composer einzeilig bis Fokus, Reiter Chat/Änderungen/Dateien/Mehr (Adressen und Ansichten unverändert). Nachweis: `e2e/specs/chat-zuege.spec.ts`, Inventar S01–S10, S20, S25, P10 angepasst, S68/S69 neu. **Abweichungen:** (1) „Änderungen“ zeigt in T43.4 Diff und Bericht untereinander; Kopf mit Zusammenfassung und Dateibalken folgt in T43.5; (2) die Ein-/Ausgabe eines Schritts nutzt die bestehende Ereignisansicht (Blob-Nachladen wie im Verlauf), keine eigene Darstellung je Werkzeug; (3) codex hat keinen eigenen Fehler-Mitschnitt — Fehlerregeln sind mit opencode/copilot und synthetischen Strömen belegt. (4) Aus T43.5 vorgezogen: die Randlaschen „Dateien“, „Browser“, „Geräte“ entfallen (Regel 6) — die Browser-Lasche verdeckte die Streich-Taste der Vormerkliste. Dateibaum über Reiter „Dateien“ bzw. globales „Mehr“/PC-Leiste, Browser und Geräte über „Mehr“ der Session (`shared/layers.ts`). Das Antwortfeld bleibt nach dem ersten Fokus offen; Zuklappen beim Verlassen verschob Tasten unter dem Finger.
- [x] **T43.5** „Änderungen“ und „Dateien“, Kleinkram-Regeln 1–7 je mit Test. **K3**. — **Erledigt 2026-11-11:** Kopf von „Änderungen“ (`ChangesHead.tsx`: „N Dateien · +A −D“, Hauptaktion „Ins Projekt übernehmen“ rechts, Bericht darunter ohne Doppel), Dateibalken je Datei in `DiffPane`, leere Reiter unter „Mehr“ mit Satz und Aktion, Zeilenaktionen der Karten beim Überfahren/langem Drücken plus Menü „⋯“, fehlende Tooltips ergänzt. Nachweis: `e2e/specs/kleinkram.spec.ts` (Regel 1–7), Inventar S04, S06, G29–G31, P10 nachgezogen. **Abweichungen:** (1) Der Diff wird zusätzlich einmal geladen, sobald kein Zug läuft — nur so weiß der Reiter, ob er leer ist (K3 unverändert: eine Anfrage je Zugende, kein Strom). (2) Der Hub meldet einen leeren Diff als `error` „keine Änderungen …“; die PWA wertet das als „0 Dateien“, der Vertrag bleibt unverändert. (3) Regel 6 war schon in T43.4 umgesetzt (Randlaschen entfallen).
- [x] **T43.6** Tablet-Zweispalter, PC-Kachelkopf, Schnellsuche im Befehlsfeld. **K2**. — **Erledigt 2026-11-11:** Tablet 700–1279 px: Sessions als Streifen über (hoch) bzw. als Spalte neben (quer) der offenen Session (`features/overview/SessionStrip.tsx`, Reihenfolge der Warteschlange), Dock unten; PC-Kachelkopf trägt Griff, Titel, Zustand, die vier Reiter als Symbole und rechts Herauslösen/Leeren, die senkrechte Leiste je Kachel entfällt (schmale Kachel: Reiter und Tasten rücken in eine zweite Zeile); Schnellsuche im Befehlsfeld (`features/commands/quick.ts`, reine Funktion mit Unit-Tests): Sessions, Projekte (springt in „Neue Session“ mit vorgewähltem Projekt), Dateien (bestehende Codesuche der offenen Session), Werkzeuge, Befehle; Pfeiltasten wählen, Enter springt nur mit Auswahl, sonst bleibt es „Auftrag in Worten“. Kein zweites Kürzel, kein neuer Index. Nachweis: `e2e/specs/schnellsuche.spec.ts`, `tablet-layout.spec.ts` (Zweispalter), `layout-desktop.spec.ts` (Kachelkopf), Inventar P10. **Abweichung:** Die Projektliste der Schnellsuche ist die Projekt-Erkennung des Hubs (`/api/projects`), dieselbe Liste wie in „Neue Session“.
  — *„?“-Übersicht an P51 T51.7 abgegeben (Nutzerentscheid 11.11.2026 — braucht die dort gebaute Shortcut-Registry).*
- [x] **T43.7** *(erledigt 2026-11-11, [ADR-0068](../docs/adr/0068-herausloesen-ueberall.md), Spec `herausloesen.spec.ts`)* ADR (Fortschreibung ADR-0053), `DetachButton`, neue Fensterziele, Platzhalter/Zurückholen, Fensterzähler. **K2/K7/K10**.
- [x] **T43.8** *(erledigt 2026-11-11, Spec `nyx-blatt.spec.ts`, Fensterziel `nyx` nach ADR-0068)* Nyx-Blatt: Zustandsfunktion, Blatt/Aufklappfeld, Fragen mit Vorauswahl, Bestätigungen, Atlas-Übernahme mit Herkunftsvermerk. **K1**.
- [x] **T43.9** *(erledigt 2026-11-11 mit offenen Punkten — siehe Retro: Nachher-Bilder, Messlauf, `tastatur-screenreader.spec.ts`, `breiten.spec.ts`, Handy-Lauf; echtes Tablet, zweiter Bildschirm und Screenreader-Lauf nicht abgenommen)* Abnahme: Nachher-Screenshots, K1/K2-Messlauf (Skill `messlauf`, auch vier Kacheln mit Bewegung), Tastatur- und Screenreader-Durchgang, Geräteabnahme Handy/Tablet/PC, Retro. **K1/K2/K10**.
- [x] **T43.10** *(erledigt 2026-11-12, [ADR-0066](../docs/adr/0066-display-beantwortet-optionsfragen.md); als einzige P43-Aufgabe vorgezogen, weil VoidWarden P13 darauf wartet und sie an keiner anderen P43-Aufgabe hängt — das übrige Epic bleibt gesperrt)* AV-D3: ADR (Fortschreibung ADR-0048), Token-Berechtigung, Prüfung im `decide`-Handler, Feld „am Display beantwortbar“, `hubctl`, Integrations-Tests für jeden Ablehnungsfall, Doku für VoidWarden. **K1/K7**.

Jede Aufgabe liest vor Beginn die ihr zugeordneten Audit-Befunde (Audit §3/§5) und belegt im MR, dass sie behoben sind.

Reihenfolge: T43.0 → T43.1 → T43.2, danach T43.3–T43.8 in beliebiger Folge (je eigener
Branch/MR), T43.9 zuletzt. T43.10 ist unabhängig und kann als erste Aufgabe laufen, damit VoidWarden P13 nicht wartet.

## 5. Acceptance Criteria (AC-P43-k)

- **AC-P43-1:** `funktionsinventar.spec.ts` ist auf Handy, Tablet und PC grün; jeder Eintrag aus dem Inventar ist in höchstens drei Interaktionen und über die Schnellsuche erreichbar. Kein Eintrag wurde ohne dokumentierte Nutzerentscheidung entfernt.
- **AC-P43-2:** Eine entscheidbare Freigabe lässt sich aus Start, Session und Nyx-Blatt mit einem Tipp entscheiden; K1 im Messlauf belegt. Freigaben mit Begründung/WebAuthn behalten ihren Weg.
- **AC-P43-3:** Der Chat zeigt Züge; gefaltete Arbeit lässt sich aufklappen bis zur Ein-/Ausgabe eines Schritts. Der Verlauf enthält weiterhin jedes Ereignis; unbekannte Ereignistypen sind im Chat als Hinweis sichtbar.
- **AC-P43-4:** Ruf-Farbe und Akzent sind getrennte Tokens; der Farbwähler warnt bei Nähe zur Ruf-Farbe; gespeicherte Akzent- und Schriftwahl überlebt das Update. Zustand ist ohne Farbe unterscheidbar (Form), Kontrast in beiden Erscheinungsbildern ≥ 4,5:1 für Text.
- **AC-P43-5:** Mit „Bewegung reduzieren“ läuft keine Animation, und jede Aussage bleibt lesbar. Bei getrennter Verbindung laufen Atmen und Schimmer nicht.
- **AC-P43-6:** Kein horizontales Scrollen und keine abgeschnittene Bedienung bei 412, 800, 1280 und 1600 px (Spec je Ansicht); Ziele ≥ 44 px bei Touch, ≥ 30 px mit Maus.
- **AC-P43-7:** Jede in §3.8 genannte Komponente lässt sich am PC herauslösen und zurückholen; Entwurf, Scrollposition und Verbindung bleiben erhalten; kein Fenster geht nach Reload verloren.
- **AC-P43-8:** Kleinkram-Regeln 1–7 sind je durch einen Test belegt.
- **AC-P43-9:** K2-Messlauf mit vier Kacheln und laufenden Sessions liegt nicht schlechter als der letzte belegte Stand; `npm run loadtest` grün.
- **AC-P43-10:** Eine Auswahlfrage des Agenten ist im Nyx-Blatt mit vorgewählter Option beantwortbar; die Antwort kommt über den bestehenden Weg beim Agenten an (Spec).
- **AC-P43-11:** Ein Display-Token mit der neuen Berechtigung beantwortet eine Optionsfrage genau einmal; ohne Berechtigung, bei Freitext, bei fremder Option, bei Mehrfachauswahl, bei `reasonRequired`/`destructive` und bei unbekannter ID antwortet der Hub 403 (Integrations-Test je Fall). Die Antwort erscheint im Audit mit `display:<name>`.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Funktionen verschwinden beim Aufräumen** (das größte Risiko dieses Epics) → Inventar-Spec vor dem Umbau grün, jede Aufgabe ändert Weg und Test gemeinsam; AC-P43-1 blockiert den Abschluss.
2. **Gefaltete Schritte verstecken einen Fehler oder ein fremdes Ereignis** → Fehler und Rückfragen falten nie; unbekannte Typen als sichtbarer Hinweis; Gruppierung als reine Funktion gegen Fixtures aller Adapter getestet.
3. **Bewegung kostet Flüssigkeit oder lenkt ab** → nur zwei Schleifen, nur `transform`/`opacity`, K2-Messlauf mit vier Kacheln; Schalter und Systemvorgabe respektiert.
4. **Tablet fällt zwischen Handy und PC durch** → eigener Zweispalter, `@tablet`-Specs für jede Ansicht, Geräteabnahme.
5. **Standardwechsel überschreibt Nutzerwahl** (Akzent, Schrift) → Migration nur für unveränderte Standards, Test mit gespeicherter Wahl.
6. **Neue Fensterziele verlieren Entwurf oder Verbindung** → vorhandene `PopoutShell`-Regeln wiederverwenden, Remount-Regression als Spec, ADR vor Umsetzung.
7. **Nyx-Blatt wird zweiter, abweichender Entscheidungsweg** → nutzt dieselben API-Aufrufe und Bausteine wie Session und Start; keine eigene Logik für Policy oder Ablauf.
8. **Epic zu groß** → jede Aufgabe ist für sich auslieferbar; P43.5 ist bereits abgetrennt; bei Verzug zuerst T43.8, dann T43.7 in ein Folge-Epic schieben, nie T43.0.
9. **Die Display-Berechtigung wird zum Seiteneingang für Prompts** (Antworttext erreicht den Agenten) → nur wortgleiche, vom Agenten selbst gelieferte Optionen, serverseitig geprüft; Standard aus; je Token vergeben; jede Ablehnung getestet.

## 7. Definition of Done

Alle T43.* und AC-P43-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate`
und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md`
nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion und jeder Ablauf hat einen Spec
in `e2e/specs/`; Geräte-Nachweise (Handy, Tablet, PC mit zweitem Bildschirm) separat, Skip ≠
Pass. `design-system.md` beschreibt den neuen Stand; das Funktionsinventar ist aktuell und
jeder Eintrag erreichbar. ADR vor Erweiterung der Fensterziele und vor AV-D3; K5/K7 unverändert
nachgewiesen; keine offene TODO ohne Epic-Bezug. Retro (Skill `retro`) angehängt.

## Retro (2026-11-11, Skill `retro`)

**Zeitraum:** 2026-11-10 (Neufassung, Audit) bis 2026-11-11 (T43.9) · **Commits mit P43-Bezug auf `main`:** 28 bis
`05a6607`, dazu die T43.9-Commits dieses MR · **MRs:** u. a. !382 (T43.5), !384 (T43.6), !385 (T43.7), !386 (T43.8).

### AK-Matrix

| AC | Bewertung | Beleg | Bemerkung |
|---|---|---|---|
| AC-P43-1 | 🟡 teilweise | `funktionsinventar.spec.ts` im Gate auf Handy, Tablet, PC; `schnellsuche.spec.ts`; T43.6 „?“-Übersicht an P51 T51.7 (Nutzerentscheid 11.11.) | Inventar grün, Obergrenze drei Interaktionen geprüft (`funktionsinventar.spec.ts:318`). **Nicht belegt:** „jeder Eintrag über die Schnellsuche“ — sie springt zu Sessions, Projekten, Dateien, Werkzeugen und Befehlen, nicht zu jeder Inventarzeile. |
| AC-P43-2 | 🟢 erfüllt | `start-warteschlange.spec.ts`, `nyx-blatt.spec.ts` (Tipp im Blatt; Begründung/Passkey → Session), `harness.spec.ts` (Karte in der Session), `k1-ein-tipp.spec.ts`, [Messlauf](../docs/messlauf/2026-11-11-p43-k1-k2.md) | K1 p95 68 ms (Start) / 59 ms (Nyx), n = 20 je Weg; Grenze 5 s. |
| AC-P43-3 | 🟢 erfüllt | `chat-zuege.spec.ts`; `apps/pwa/test/features/turns.test.ts` „unbekannte Ereignistypen werden gezählt und als eine Zeile gezeigt“ | Verlauf unverändert vollständig (T43.4). |
| AC-P43-4 | 🟡 teilweise | `accent-color.spec.ts:109` (Nähe zur Ruf-Farbe), `appearance-font.spec.ts`, `apps/pwa/test/app/tokens.test.ts`, `zustandssprache.spec.ts:19` (Form statt nur Farbe) | Ausnahme dokumentiert in T43.1: `--ok` im hellen Erscheinungsbild 4,2:1 statt 4,5:1 (semantische Farben waren außerhalb des Scopes). |
| AC-P43-5 | 🟢 erfüllt | `zustandssprache.spec.ts:63` (Schalter, `reducedMotion`, `data-conn="off"`) | — |
| AC-P43-6 | 🟢 erfüllt | `breiten.spec.ts` (412/800/1280/1600 × Start, Session, Nyx-Blatt; Handy, Tablet, PC), `tablet-layout.spec.ts`, `layout-desktop.spec.ts` | Der neue Spec fand zu kleine Ziele in Kopfzeile, Nyx-Blatt und Kachelkopf — behoben in `1e2ff5f`. Gemessen sind die Ziele dieser drei Ansichten, nicht jede Werkzeugseite. |
| AC-P43-7 | 🟡 teilweise | `herausloesen.spec.ts` (jede Ansicht, Platzhalter, Zurückholen, Neuladen, Warteschlange), `nyx-blatt.spec.ts` (Nyx-Fenster), `windows.spec.ts` (Session-Fenster, Entwurf und Neuladen nach ADR-0053) | Ansichtsfenster haben bewusst kein Antwortfeld (ADR-0068 Punkt 3). **Nicht belegt:** Scrollposition einer herausgelösten Ansicht. |
| AC-P43-8 | 🟢 erfüllt | `kleinkram.spec.ts` (Regel 1–7) | — |
| AC-P43-9 | 🟢 erfüllt | [Messlauf](../docs/messlauf/2026-11-11-p43-k1-k2.md): K2 p95 89 ms / max 178 ms, 0 von 72.513 über 200 ms (P18: 91 / 176 / 0); `npm run loadtest` 603 ev/s, PASS | Fremdlast Load 7–9 während der Läufe. |
| AC-P43-10 | 🟢 erfüllt | `nyx-blatt.spec.ts` „eine Auswahlfrage steht mit der empfohlenen Option vorgewählt; die Antwort erreicht den Agenten“ | Antwort kommt als „Gewählt: Grün (Empfohlen)“ über `decide` an. |
| AC-P43-11 | 🟢 erfüllt | `apps/hub/test/modules/approvals/tool-permissions.test.ts` (je Ablehnungsfall 403, `decidedByLabel: "display:kiosk"`), `packages/contracts/test/approvals/display-answers.test.ts`, [ADR-0066](../docs/adr/0066-display-beantwortet-optionsfragen.md) | — |

**Summe:** 8 🟢 / 3 🟡 / 0 🔴 / 0 ⚪.

### Abnahme T43.9

- **Nachher-Bilder** in vier Breiten neben den Vorher-Bildern: [Funktionsinventar § Nachher-Bilder](../docs/funktionsinventar.md#nachher-bilder).
- **Messlauf** K1/K2/K8: [docs/messlauf/2026-11-11-p43-k1-k2.md](../docs/messlauf/2026-11-11-p43-k1-k2.md).
- **Tastatur und Screenreader:** `tastatur-screenreader.spec.ts` (jede sichtbare Bedienung benannt, Fokus sichtbar,
  Nyx-Blatt nimmt und gibt den Fokus) — fand den fehlenden Fokuswechsel im Nyx-Blatt, behoben in `1e2ff5f`. Ein Lauf mit
  einem echten Screenreader (TalkBack/Orca) ist **nicht** gemacht.
- **Handy (echt):** OnePlus A6013 per `npm run test:phone`, Specs-Liste um die P43-Specs erweitert (`playwright.config.ts`):
  101 bestanden, 6 übersprungen (sichtbar: PC-Fenster, Mikrofon, Service Worker), 2 gescheitert. Davon war Regel 3 ein
  Testfehler (Touch am Projektnamen statt am Gerät erkannt, behoben in diesem MR, am Handy grün); `session.spec.ts:4`
  scheitert nur in der Gesamtfolge ([BUG-0121](../bugs/bug-0121-handy-lauf-session-test-zeitueberschreitung.md)),
  einzeln und wiederholt grün — **nicht als Pass gezählt**.
- **Tablet:** nur Emulation (800 × 1280 und 1024 × 768 im Projekt `tablet`) — kein echtes Tablet vorhanden; **nicht gemessen**.
- **PC mit zweitem Bildschirm:** Fensterverhalten über Playwright-Popups belegt; ein echter zweiter Bildschirm ist **nicht** abgenommen.
- **Vorgänger:** P42 ist in `main` (Nutzerangabe 11.11.), seine Epic-Datei steht aber noch auf „Umsetzung“; P43 lief auf
  ausdrücklichen Nutzerauftrag vor dessen Abschluss (Kopf dieser Datei).
- **Pipelines:** zu !384–!386 und `main` `pending` (Projekt-Runner belegt) — nach `docs/ci-runbook.md` nachzuziehen,
  nicht als Pass gezählt. Qualität belegt über die lokalen Gates (`npm run gate` je MR grün).

### Premortem

| # | Risiko | Eingetreten? | Beleg |
|---|---|---|---|
| 1 | Funktionen verschwinden | nein — vom Gate abgefangen | Inventar-Spec fand das falsche Nachweisformat von G23 (Fix `3b68d93`) und den Reiter, der unter „Mehr“ wandert (`9d4475e`) |
| 2 | Gefaltete Schritte verstecken Fehler | nein | `turns.test.ts` (unbekannte Typen, Fehler falten nie) |
| 3 | Bewegung kostet Flüssigkeit | nein | K2 gleichauf mit P18 (Messlauf) |
| 4 | Tablet fällt durch | teilweise | Glocke über „Stop“ und gequetschter Titel im Querformat, in T43.6 vor dem Merge behoben; kein echtes Tablet |
| 5 | Standardwechsel überschreibt Nutzerwahl | nein | `appearance-font.spec.ts`, `accent-color.spec.ts` |
| 6 | Fensterziele verlieren Entwurf/Verbindung | nein (Scroll unbelegt) | `herausloesen.spec.ts`, `windows.spec.ts` |
| 7 | Nyx-Blatt als zweiter Entscheidungsweg | nein | `Nyx.tsx` nutzt `QuestionForm`, `CardDecision`, `hubApi.decideApproval` |
| 8 | Epic zu groß | nein | T43.0–T43.10 in zwei Tagen, je eigener MR |
| 9 | Display-Berechtigung als Prompt-Eingang | nein | `tool-permissions.test.ts` (403 je Fall) |

### Erkenntnisse

1. **Das Inventar als Gate trägt.** Jede Umbau-Aufgabe, die einen Weg verschob, scheiterte zuerst am Inventar-Spec und
   musste Weg und Test gemeinsam ändern (`3b68d93`, `9d4475e`, Inventarzeilen G64/G65/P17).
2. **Querschnitts-ACs kamen spät.** Zielgrößen (AC-6) und Fokus (Tastatur) wurden erst in T43.9 gemessen und fanden dort
   noch Fehler (`1e2ff5f`); das Blatt unter dem Dock fand erst der Nyx-Spec (`a071b47`). Früh laufende Querschnitts-Specs
   hätten das in T43.3–T43.6 gezeigt.
3. **Dynamische Reiter machen Test-Helfer fragil.** „Änderungen“ wandert je nach Diff zwischen Reiter und „Mehr“; der
   Helfer `sessionTab` brauchte zwei Nachbesserungen und kostete zwei Gate-Läufe (`9d4475e`, `3b68d93`).
4. **Parallele Playwright-Läufe teilen `test-results/`.** Gate und Handy-Lauf gleichzeitig löschten sich gegenseitig die
   Artefakte (ENOENT); beide Läufe waren ungültig und wurden nacheinander wiederholt.
5. **Messwerte stabil trotz mehr Oberfläche.** K2 mit vier Kacheln wie in P18, K1 weit unter der Grenze.

### Action Items

- **AI-P43-1:** Schnellsuche über alle Inventarzeilen (oder AC-P43-1 auf die Sprungziele der Schnellsuche eingrenzen) — zurück als: nächste Epic-Aufgabe (P51, neben der Shortcut-Registry aus T51.7).
- **AI-P43-2:** `--ok` im hellen Erscheinungsbild auf ≥ 4,5:1 heben — zurück als: nächste Epic-Aufgabe (Design-System).
- **AI-P43-3:** Scrollposition herausgelöster Ansichten als Spec — zurück als: nächste Epic-Aufgabe (Fortschreibung ADR-0068).
- **AI-P43-4:** `breiten.spec.ts` auf Werkzeugseiten und Formulare ausdehnen; Querschnitts-Specs ab der ersten Umbau-Aufgabe laufen lassen — zurück als: nächste Epic-Aufgabe.
- **AI-P43-5:** Geräteabnahme echtes Tablet und zweiter Bildschirm, Screenreader-Lauf mit TalkBack — zurück als: nächste Epic-Aufgabe (Abnahme).
- **AI-P43-7:** BUG-0121 (Handy-Gesamtlauf, Zeitüberschreitung) eingrenzen — zurück als: Bug [BUG-0121](../bugs/bug-0121-handy-lauf-session-test-zeitueberschreitung.md).
- **AI-P43-6:** Playwright-Ausgabeordner je Lauf trennen (`test:phone` eigener `outputDir`), damit Gate und Handy-Lauf parallel gehen — zurück als: Bug [BUG-0120](../bugs/bug-0120-parallele-playwright-laeufe-teilen-test-results.md).
