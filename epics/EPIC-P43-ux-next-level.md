# EPIC-P43 — UX Next Level: Leitstand, der lebt

**Status:** Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P43
**Dauer:** 4–6 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P42 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

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

- [ ] **T43.0** Funktionsinventar vervollständigen (inkl. der im Design-Review nicht erfassten Flächen) und als `e2e/specs/funktionsinventar.spec.ts` für Handy, Tablet, PC grün machen; Vorher-Screenshots 412/800/1280/1600 px ablegen. **K1/K10**. — **Vorarbeit 2026-11-10 (MR !364):** [UX-Audit](../docs/2026-11-10_p43-ux-audit.md) mit Vorher-Bildern Handy/Desktop für vier Journeys und 12 Befunden; offen daraus: echter Pixel, CI-Anteil von Journey 4, Zähler-Befund #5 messen, Nutzerabnahme der Befundliste.
- [ ] **T43.1** Fundament: Tokens (`--call`, `--info`, Standard-Akzent, Skalen, Bewegung), Inter-Standard mit Bestandsschutz gespeicherter Wahl, Formular-Bausteine, `design-system.md` fortschreiben; Kontrasttests für beide Erscheinungsbilder. **K2/K10**.
- [ ] **T43.2** Zustandssprache: `StatusDot`, Anzeigezustand „Frage“, sechs Bewegungen als Bausteine mit „Bewegung reduzieren“; alle Pillen/Punkte umstellen. **K2**.
- [ ] **T43.3** Start als Warteschlange mit Entscheidung auf der Karte, laufendem Schritt, Gruppenwechsel, Dock neu. **K1/K2**.
- [ ] **T43.4** Session in Zügen: Gruppierungsfunktion mit Unit-Tests gegen aufgezeichnete Fixtures aller Adapter, Falten/Aufklappen, Statuszeile, Composer, vier Reiter; Verlauf unverändert vollständig. **K2/K5/K7**.
- [ ] **T43.5** „Änderungen“ und „Dateien“, Kleinkram-Regeln 1–7 je mit Test. **K3**.
- [ ] **T43.6** Tablet-Zweispalter, PC-Kachelkopf, Schnellsuche im Befehlsfeld. **K2**.
  — *„?“-Übersicht an P51 T51.7 abgegeben (Nutzerentscheid 11.11.2026 — braucht die dort gebaute Shortcut-Registry).*
- [ ] **T43.7** ADR (Fortschreibung ADR-0053), `DetachButton`, neue Fensterziele, Platzhalter/Zurückholen, Fensterzähler. **K2/K7/K10**.
- [ ] **T43.8** Nyx-Blatt: Zustandsfunktion, Blatt/Aufklappfeld, Fragen mit Vorauswahl, Bestätigungen, Atlas-Übernahme mit Herkunftsvermerk. **K1**.
- [ ] **T43.9** Abnahme: Nachher-Screenshots, K1/K2-Messlauf (Skill `messlauf`, auch vier Kacheln mit Bewegung), Tastatur- und Screenreader-Durchgang, Geräteabnahme Handy/Tablet/PC, Retro. **K1/K2/K10**.
- [ ] **T43.10** AV-D3: ADR (Fortschreibung ADR-0048), Token-Berechtigung, Prüfung im `decide`-Handler, Feld „am Display beantwortbar“, `hubctl`, Integrations-Tests für jeden Ablehnungsfall, Doku für VoidWarden. **K1/K7**.

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
