# Funktionsinventar der PWA

**Art:** referenz

**Stand:** 2026-11-11 (EPIC-P43 T43.0) · **Zweck:** Leitplanke E10 — beim Umbau der Oberfläche
geht keine Funktion verloren. · **Gate:** [`e2e/specs/funktionsinventar.spec.ts`](../e2e/specs/funktionsinventar.spec.ts)

Jede Zeile ist eine Funktion, die ein Mensch in der PWA erreichen kann. Die letzte Spalte
nennt den Nachweis:

- `inventar` — der Inventar-Spec erreicht die Funktion über den hier beschriebenen Weg, am
  Handy (412 px), am Tablet (800 px) und am PC (1280 px). Der Spec prüft, dass Dokument und
  Spec dieselben IDs führen.
- `spec:<datei>` — die Funktion braucht einen besonderen Zustand (laufender Zug, Freigabe,
  zweites Gerät …) und ist in diesem bestehenden Spec belegt. Der Inventar-Spec prüft, dass
  die Datei existiert.

**Regeln.** Ein Umbau ändert Weg, Zeile und Spec-Eintrag im selben Commit. Eine Zeile entfällt
nur mit dokumentierter Nutzerentscheidung (Datum, Wortlaut in der Zeile). Obergrenze für
`inventar`-Zeilen: höchstens drei Interaktionen ab Start oder ab geöffneter Session; der Spec
zählt mit. Wo heute mehr nötig sind, steht die Zahl in der Zeile und die Zielaufgabe behebt es.

Wo eine Funktion nach P43 hingehört, steht im
[Design-Review §5](2026-11-10_ux-next-level-designreview.md); die Spalte „Ziel“ nennt die
Aufgabe, die den Weg ändert („—“: bleibt).

## Global

Ausgangspunkt „Start“ ist die Übersicht (`#/`). Am PC steht das Dock in der Listenspalte, die
Werkzeugseiten füllen die Detailspalte.

| ID | Funktion | Weg heute | Ziel | Nachweis |
|---|---|---|---|---|
| G01 | Start (Übersicht) | Dock „Start“ | — | inventar |
| G02 | Neue Session | Dock-Haupttaste „＋“ | — | inventar |
| G03 | Entdeckt (gefundene Sessions) | Dock „Mehr“ → „Entdeckt“; PC: Leiste | — | inventar |
| G04 | Entdeckt über den Chip | Start → Chip „Gefunden“ | T43.3 | inventar |
| G05 | Medien | Dock „Mehr“ → „Medien“; PC: Leiste | — | inventar |
| G06 | Runs | Dock „Runs“ | — | inventar |
| G07 | Notizen | Dock „Mehr“ → „Notizen“; PC: Leiste | — | inventar |
| G08 | Automationen | Dock „Mehr“ → „Automationen“; PC: Leiste | — | inventar |
| G09 | Einstellungen: Darstellung (Erscheinungsbild, Akzent, Größe) | Dock „Mehr“ → „Einstellungen“; PC: Leiste | — | inventar |
| G10 | Einstellungen: Schrift | Dock „Mehr“ → „Einstellungen“; PC: Leiste | — | inventar |
| G11 | Einstellungen: Vorschau | Dock „Mehr“ → „Einstellungen“; PC: Leiste | — | inventar |
| G12 | Einstellungen: Benachrichtigungen | Dock „Mehr“ → „Einstellungen“; PC: Leiste | — | inventar |
| G13 | Einstellungen: Geräte | Dock „Mehr“ → „Einstellungen“; PC: Leiste | — | inventar |
| G14 | Einstellungen: Flotte | Dock „Mehr“ → „Einstellungen“; PC: Leiste | — | inventar |
| G15 | Einstellungen: Dienste | Dock „Mehr“ → „Einstellungen“; PC: Leiste | — | inventar |
| G16 | Einstellungen: Sicherheit & Verbindung | Dock „Mehr“ → „Einstellungen“; PC: Leiste | — | inventar |
| G17 | Helles Erscheinungsbild | „Mehr“ → Einstellungen → „Hell“ | — | inventar |
| G18 | PC-Eingabe (Am PC eintippen) | „Mehr“ → Einstellungen → „PC-Eingabe“ | — | inventar |
| G19 | Freigaben-Seite | Deeplink `#/freigaben` | T43.3 | inventar |
| G20 | Provider-Status | Kopfzeile „Status“ | T43.3 | inventar |
| G21 | Benachrichtigungen | Glocke | — | inventar |
| G22 | Auftrag in Worten | Kopfzeile „✦“ | T43.6 | inventar |
| G23 | Auftrag in Worten per Tastatur (nur PC) | Strg+K | T43.6 | inventar |
| G24 | Umschalter Projekte | Start → „Projekte“ | — | inventar |
| G25 | Umschalter Hosts | Start → „Hosts“ | — | inventar |
| G26 | Archiv | Start → Chip „Archiv“ | T43.3 | inventar |
| G27 | Sessions filtern (ab fünf Sessions) | Start → Filterfeld | T43.3 | inventar |
| G28 | Session öffnen | Start → Karte | — | inventar |
| G29 | Karte: Repo-Graph | Start → Symbol an der Karte (Maus: beim Überfahren) oder „⋯“ → „Repo-Graph“ | T43.3 | inventar |
| G30 | Karte: Anheften und Lösen | Start → „Anheften“ an der Karte (Maus: beim Überfahren) oder „⋯“ → „Anheften“ | T43.3 | inventar |
| G31 | Karte: Archivieren, Zurückholen, Löschen im Archiv | Start → „Archivieren“; Archiv → „Zurückholen“/„Löschen“ — an der Karte beim Überfahren/langem Drücken oder über „⋯“ | T43.3 | inventar |
| G32 | Verbindungsanzeige | Kopfzeile, immer sichtbar | T43.2 | inventar |
| G33 | Marke führt zur Übersicht | Kopfzeile „AncientVoid“ | — | inventar |
| G34 | Banner „Freigabe wartet“ führt zur Freigaben-Seite | Start, bei offener Freigabe | T43.3 | spec:workspace.spec.ts |
| G35 | Freigabe entscheiden (Erlauben/Ablehnen, Begründung, Passkey) | Freigaben-Seite bzw. Session | T43.3 | spec:harness.spec.ts |
| G36 | Abzeichen „eigenes Fenster“ holt das Fenster nach vorn (nur PC) | Karte in der Liste | — | spec:windows.spec.ts |
| G37 | Filter „nur wartende“/„nur aktive“ und sein Chip | Auftrag in Worten | — | spec:commands.spec.ts |
| G38 | Zuletzt bearbeitete Session ist markiert | Start | — | spec:navigation-desktop.spec.ts |
| G39 | Fehlerkarte „Erneut versuchen“, Offline-Stand | Start, ohne Verbindung | — | spec:qol.spec.ts |
| G40 | Anmeldung mit Geräte-Token | erster Start | — | spec:auth.spec.ts |
| G41 | Teilen aus einer anderen App füllt „Neue Session“ | Teilen-Menü des Systems | — | spec:share-target.spec.ts |
| G42 | Push einschalten und testen | Einstellungen → Benachrichtigungen | — | spec:push.spec.ts |
| G43 | Akzentfarbe wählen (mit Ähnlichkeitswarnung) | Einstellungen → Darstellung | T43.1 | spec:accent-color.spec.ts |
| G44 | Schrift und Schriftgröße wählen | Einstellungen → Schrift | T43.1 | spec:appearance-font.spec.ts |
| G45 | Neue Session: Projekt, Pfad, Adapter, Modell, Loop, Arbeitsort | Neue Session | — | spec:session.spec.ts |
| G46 | Eigene Modelle | Neue Session → Modell | — | spec:custom-models.spec.ts |
| G47 | Loops starten | Neue Session → Loop | — | spec:loops.spec.ts |
| G48 | Factory-Lauf | Neue Session → Loop „Factory“ | — | spec:factory.spec.ts |
| G49 | Gefundene Session übernehmen oder beobachten | Entdeckt | — | spec:discovery.spec.ts |
| G50 | Video analysieren und in Session verwenden | Medien | — | spec:media.spec.ts |
| G51 | Runs anlegen und verfolgen | Runs | — | spec:orchestration.spec.ts |
| G52 | Notiz anlegen, lesen, bearbeiten | Notizen | — | spec:vault.spec.ts |
| G53 | Automation anlegen, pausieren, jetzt senden | Automationen | — | spec:automations.spec.ts |
| G54 | Flotte: Sessions anderer Hosts | Start bzw. Hosts | — | spec:fleet.spec.ts |
| G55 | Projekt im Dateibaum öffnen | Start → Projekte → Karte | — | spec:project-explorer.spec.ts |
| G56 | Oberflächengröße (Strg +/−/0, Strg+Rad) | Tastatur bzw. Einstellungen | — | spec:oberflaeche.spec.ts |
| G57 | Querformat am Handy | Gerät drehen | — | spec:querformat.spec.ts |
| G58 | Neue Session: Skill oder Agent wählen | Neue Session → „+ Skill/Agent“ | — | inventar |
| G59 | Provider-Status über „Mehr“ (Handy, Tablet) | Dock „Mehr“ → „Provider-Status“ | — | inventar |
| G60 | Suchen im Dock (öffnet das Befehlsfeld) | Dock „Suchen“ | T43.6 | inventar |
| G61 | Freigabe auf der Karte entscheiden (Erlauben/Ablehnen) | Start → Karte unter „Du bist dran“ | — | spec:start-warteschlange.spec.ts |
| G62 | „Ruhig“ auf- und zuklappen | Start → Gruppenkopf „Ruhig“ | — | spec:start-warteschlange.spec.ts |
| G63 | Alle Freigaben zeigen | Start → „Du bist dran“ → „alle zeigen“ | — | spec:start-warteschlange.spec.ts |
| G64 | Schnellsuche: Springen zu Sessions, Projekten, Dateien, Werkzeugen, Befehlen | Strg+K bzw. Dock „Suchen“ → Treffer | T43.6 | spec:schnellsuche.spec.ts |
| G65 | Nyx: Gesamtzustand in der Kopfzeile; Blatt mit allen wartenden Freigaben und Fragen (Vorauswahl, Ja/Nein mit einem Tipp, Begründung/Passkey → Session); am PC auch als eigenes Fenster | Kopfzeile → Nyx | T43.8 | spec:nyx-blatt.spec.ts |

## Session

Ausgangspunkt ist die geöffnete Session. Am Handy und Tablet stehen die Reiter unten, am PC
als Leiste links in der Kachel.

Zusätzliche Chat-Regressionen (angehefteter Auftrag, große Denktexte und Werkzeugdetails):
[`chat-lesbarkeit.spec.ts`](../e2e/specs/chat-lesbarkeit.spec.ts).

| ID | Funktion | Weg heute | Ziel | Nachweis |
|---|---|---|---|---|
| S01 | Chat mit angepinntem letztem Auftrag (Klick springt zur Nachricht), aufklappbaren Denktexten und Werkzeugschritten | Reiter „Chat“ | T43.4 / K2, K7, K10 | inventar |
| S02 | Verlauf mit Filter Überwachen/Debuggen | „Mehr“ → „Verlauf“ → „Debuggen“ (am PC zusätzlich „Steuerung einblenden“) | T43.4 | inventar |
| S03 | Bericht | „Mehr“ → „Bericht“; auch unter dem Diff in „Änderungen“ | T43.5 | inventar |
| S04 | Diff | Reiter „Änderungen“ (mit Zahl der Dateien); ohne Änderungen „Mehr“ → „Änderungen“ mit Satz und „Zum Chat“ | T43.5 | inventar |
| S05 | Repo-Graph | „Mehr“ → „Graph“ | T43.4 | inventar |
| S06 | Datei | „Mehr“ → „Datei“; ohne geöffnete Datei Satz und „Dateibaum öffnen“ | T43.5 | inventar |
| S07 | GitLab | „Mehr“ → „GitLab“ | T43.4 | inventar |
| S08 | Suche | „Mehr“ → „Suche“ | T43.4 | inventar |
| S09 | Code | Reiter „Dateien“ | T43.5 | inventar |
| S10 | Umgebung | „Mehr“ → „Umgebung“ | T43.4 | inventar |
| S11 | Zurück zur Übersicht (Handy/Tablet) | „←“ im Kopf | — | inventar |
| S12 | Stop | Taste im Kopf | T43.4 | inventar |
| S13 | Umbenennen | „⋯“ → „Umbenennen“ | — | inventar |
| S14 | Anheften/Lösen | „⋯“ → „Anheften“ | — | inventar |
| S15 | Archivieren/Zurückholen | „⋯“ → „Archivieren“ | — | inventar |
| S16 | Löschen | „⋯“ → „Löschen“ | — | inventar |
| S19 | Kopf: Projekt, Adapter, Modell, Host, Zustand, Arbeitsort, Verbindung | immer sichtbar | T43.2/T43.4 | inventar |
| S20 | Tokens, Kontext, Kontingent, Kontextleiste | Statuszeile unter dem Kopf (nur Gemessenes); Kontingent und Fenster immer im Bericht | T43.4 | inventar |
| S21 | Antworten und Senden | Composer | T43.4 | inventar |
| S22 | Anhang | Composer → Büroklammer | T43.4 | inventar |
| S23 | Eingabe maximieren | Composer → „⤢“ | T43.4 | inventar |
| S24 | Spracheingabe | Composer → Mikrofon | T43.4 | inventar |
| S25 | Prompt verbessern | Composer antippen → „Verbessern“ | T43.4 | inventar |
| S26 | Slash-Commands | „/“ im Composer | — | inventar |
| S27 | Antwortvorlagen (Schnellantworten) | über dem Composer | T43.4 | inventar |
| S28 | Modus und Modell | über dem Composer | T43.4 | inventar |
| S29 | Entwurfsstatus | Zeile über dem Composer beim Tippen | T43.4 | inventar |
| S30 | Steuerung ein- und ausblenden | „▾“/„▴“ | T43.4 | inventar |
| S31 | Kopieren je Ereignis | Taste am Ereignis | T43.5 | inventar |
| S32 | Dateibaum | Reiter „Dateien“ → „Dateibaum“; ohne Session globales „Mehr“ → „Dateibaum“ (PC: Leiste) | T43.5 | inventar |
| S33 | Browser-Arbeitsplatz | „Mehr“ → „Browser“ | T43.4 | inventar |
| S34 | Graph in eigenes Fenster (nur PC) | Reiter „Graph“ → „⧉ Eigenes Fenster“ | T43.7 | inventar |
| S35 | Pause und „Weiter“ | Taste im Kopf, während ein Zug läuft | T43.4 | spec:pause-queue.spec.ts |
| S36 | Vormerken, Warteschlange, „Jetzt senden“, Streichen | Composer, während ein Zug läuft | T43.4 | spec:pause-queue.spec.ts |
| S37 | Planfortschritt und To-do-Liste des Agenten | Laufleiste, Antippen klappt auf | T43.4 | spec:progress.spec.ts |
| S38 | Freigabekarte mit Laya-Einschätzung und „Regeln“ | Session, bei offener Freigabe | T43.3 | spec:harness.spec.ts |
| S39 | Rückfrage des Agenten mit Optionen beantworten | Session, bei offener Frage | T43.8 | spec:harness.spec.ts |
| S40 | Ja/Nein-Rückfrage ohne Tippen | über dem Composer | T43.4 | spec:quick-confirm.spec.ts |
| S41 | Übergabe an einen anderen Adapter bei Provider-Ausfall | Leiste über dem Composer | — | spec:harness.spec.ts |
| S42 | Unterbrochene Session fortsetzen oder archivieren | Banner „unterbrochen“ | — | spec:interrupted-session.spec.ts |
| S43 | „Am PC öffnen“ und Host-Befehle | Hinweis über dem Composer, Bericht | — | spec:pc-offen.spec.ts |
| S44 | Ins Projekt übernehmen | Bericht bzw. Code | T43.5 | spec:deeplink.spec.ts |
| S45 | Arbeitsort Worktree/Projekt direkt | Neue Session, Abzeichen im Kopf | — | spec:session-workspace-mode.spec.ts |
| S46 | Code durchsuchen, Zeile öffnen, Zeilen-Deeplink | Reiter „Code“ | T43.5 | spec:code.spec.ts |
| S47 | Review-Notizen an Zeilen und Versand an den Agenten | Reiter „Diff“ | T43.5 | spec:review-feedback.spec.ts |
| S48 | Anhänge hochladen und senden | Composer | — | spec:attachments.spec.ts |
| S49 | Modus und Modell wechseln | über dem Composer | — | spec:modus-modell.spec.ts |
| S50 | Slash-Command ausführen | Composer | — | spec:slash-commands.spec.ts |
| S51 | Lokale Spracherkennung | Composer → Mikrofon | — | spec:voice-local.spec.ts |
| S52 | „Neu seit deinem letzten Besuch“ | Chat, nach Abwesenheit | — | spec:qol.spec.ts |
| S53 | Markieren kopiert in die Zwischenablage | Chat | — | spec:selection-copy.spec.ts |
| S54 | Dateien ansehen (Quelltext, Markdown, Bild, Diagnosen) | Dateibaum bzw. Reiter „Datei“ | T43.5 | spec:file-viewers.spec.ts |
| S55 | Browser bedienen, Element anmerken, Testfall | Browser-Arbeitsplatz | — | spec:browser-workspace.spec.ts |
| S56 | Umgebung starten, Vorschau, Aktionen | „Mehr“ → „Umgebung“ | — | spec:workspace-runtime.spec.ts |
| S57 | GitLab: MR, Pipeline, Review | „Mehr“ → „GitLab“ | — | spec:forge-review.spec.ts |
| S58 | Repo-Graph: Knoten, Suche, Datei öffnen | „Mehr“ → „Graph“ | P52 | spec:repo-graph.spec.ts |
| S59 | Loop-Steuerung | Loop-Session | — | spec:loops.spec.ts |
| S60 | Entwurf auf mehreren Geräten, Konflikt | Composer | — | spec:drafts.spec.ts |
| S61 | Antwort steuern, Schreibrecht übernehmen | Composer | — | spec:steer.spec.ts |
| S62 | Session per Link wieder öffnen | Deeplink | — | spec:deeplink.spec.ts |
| S63 | Wiederanlauf nach Hub-Neustart | — | — | spec:recovery.spec.ts |
| S64 | Leseposition bleibt beim Scrollen und Tippen | Chat | T43.4 | spec:session-scroll.spec.ts |
| S65 | Android-Testgeräte: Liste, Start/Stop, Lease, Standbild (EPIC-P42) | „Mehr“ → „Geräte“ | T43.5 | inventar |
| S66 | Android-Testgeräte in eigenes Fenster (PC) | Geräte → „⧉“ | T43.7 | inventar |
| S67 | Android-Testgeräte bedienen: Tippen, Wischen, Tasten, Ausrichtung, URL (mit Lease) | Geräte-Panel | — | spec:android-device.spec.ts |
| S68 | Chat in Zügen: Arbeit gefaltet, Schritte mit Ein- und Ausgabe | Reiter „Chat“ | T43.4 | spec:chat-zuege.spec.ts |
| S69 | Antwortfeld einzeilig bis zur Eingabe | Composer | T43.4 | spec:chat-zuege.spec.ts |

## PC-Arbeitsfläche

Nur ab 1280 px Breite.

| ID | Funktion | Weg heute | Ziel | Nachweis |
|---|---|---|---|---|
| P01 | Layoutwahl (sechs Layouts) | Leiste über den Kacheln | — | inventar |
| P02 | Fokus ‹ ›, Tauschen, Layout, Leeren | Leiste über den Kacheln | T43.6 | inventar |
| P03 | Liste einklappen | Leiste über den Kacheln | — | inventar |
| P04 | Tastaturhinweise | Zeile über den Kacheln | P51 T51.7 | inventar |
| P05 | Kachel in eigenes Fenster (Taste) | Kachelkopf „⧉“ | T43.7 | inventar |
| P06 | Kachel am Griff herausziehen | Kachelkopf „⠿“ | T43.7 | inventar |
| P07 | Kachel leeren | Kachelkopf „×“ | — | inventar |
| P08 | Statusleiste (Verbindung, Flotte, Zähler, fokussierte Kachel) | unterer Rand | T43.7 | inventar |
| P09 | Werkzeugseite: eigenes Fenster und Schließen | Kopf der Werkzeugseite | T43.7 | inventar |
| P10 | Ansichten im Kachelkopf | Kopf der Kachel: Griff, Titel, Zustand, Reiter, rechts Herauslösen („Änderungen“ nur mit Änderungen) | T43.6 | inventar |
| P11 | Weitere Kachel öffnen | Strg-Klick in der Liste | — | inventar |
| P12 | Eigene Fenster: Session, Werkzeugseite, Graph, Datei, Notiz, Browser, Android-Geräte; Zurückholen | „⧉“ an der jeweiligen Ansicht | T43.7 | spec:windows.spec.ts |
| P17 | Herauslösen: Änderungen, Dateien, Bericht, GitLab, Suche, Umgebung, Warteschlange als eigenes Fenster; Platzhalter mit „Fenster zeigen“/„Zurückholen“; Zähler „⧉ n Fenster“ (nur PC) | „⧉ Herauslösen“ im Kopf der Ansicht | T43.7 | spec:herausloesen.spec.ts |
| P13 | Kacheltastatur (Alt+1–4, Alt+Umschalt+1–4, Alt+L, Alt+W) | Tastatur | — | spec:workspace-tiles.spec.ts |
| P14 | Kachelgröße ziehen | Trenner zwischen Kacheln | — | spec:resize.spec.ts |
| P15 | Werkzeugseiten in der Detailspalte, Esc schließt | Dock | — | spec:tool-pane.spec.ts |
| P16 | Tablet: Sessions als Streifen (hoch) bzw. Spalte (quer) neben der Session; ab 1280 px Arbeitsfläche | Gerät drehen | T43.6 | spec:tablet-layout.spec.ts |

## Bekannte Lücken

Funktionen, für die es **keinen** E2E-Nachweis gibt. Sie bleiben im Blick, bis die genannte
Aufgabe sie belegt; „kein Nachweis“ zählt nie als Pass.

| Funktion | Stand | Aufgabe |
|---|---|---|
| „Heute: mind. $…“ (Tageskosten in Start) | kein E2E | T43.3 |
| „Alle N zeigen“ in „Zuletzt“ (ab 16 Sessions) | kein Test | T43.3 |
| Kontextleiste: Schimmer und Schwellen | Unit-Test `run-stats.test.ts`, kein E2E | T43.4 |
| Echtes Handy (Pixel), echtes Tablet | nur Emulation; `npm run test:phone` braucht das Gerät | T43.9 |

## Vorher-Bilder

Stand vor dem Umbau (Commit `4c37a81`, E2E-Hub mit Attrappen, dunkles Erscheinungsbild), je
Ansicht in den vier Breiten aus AC-P43-6. T43.9 legt die Nachher-Bilder daneben.

| Ansicht | 412 px | 800 px | 1280 px | 1600 px |
|---|---|---|---|---|
| Start | [Bild](assets/p43-vorher-start-412.webp) | [Bild](assets/p43-vorher-start-800.webp) | [Bild](assets/p43-vorher-start-1280.webp) | [Bild](assets/p43-vorher-start-1600.webp) |
| Session (Verlauf) | [Bild](assets/p43-vorher-session-412.webp) | [Bild](assets/p43-vorher-session-800.webp) | [Bild](assets/p43-vorher-session-1280.webp) | [Bild](assets/p43-vorher-session-1600.webp) |
| Session mit Freigabe | [Bild](assets/p43-vorher-freigabe-412.webp) | [Bild](assets/p43-vorher-freigabe-800.webp) | [Bild](assets/p43-vorher-freigabe-1280.webp) | [Bild](assets/p43-vorher-freigabe-1600.webp) |

Weitere Vorher-Bilder zu einzelnen Befunden stehen im [UX-Audit](2026-11-10_p43-ux-audit.md).

## Nachher-Bilder

Stand nach T43.1–T43.8 (Commit `05a6607`, E2E-Hub mit Attrappen, dunkles Erscheinungsbild, dieselben Breiten und
Bildgrößen wie oben). Dieselben drei Ansichten: Start mit wartender Freigabe, einer laufenden und einer ruhigen Session;
eine fertige Session (Verlauf); eine Session mit Freigabe.

| Ansicht | 412 px | 800 px | 1280 px | 1600 px |
|---|---|---|---|---|
| Start | [Bild](assets/p43-nachher-start-412.webp) | [Bild](assets/p43-nachher-start-800.webp) | [Bild](assets/p43-nachher-start-1280.webp) | [Bild](assets/p43-nachher-start-1600.webp) |
| Session (Verlauf) | [Bild](assets/p43-nachher-session-412.webp) | [Bild](assets/p43-nachher-session-800.webp) | [Bild](assets/p43-nachher-session-1280.webp) | [Bild](assets/p43-nachher-session-1600.webp) |
| Session mit Freigabe | [Bild](assets/p43-nachher-freigabe-412.webp) | [Bild](assets/p43-nachher-freigabe-800.webp) | [Bild](assets/p43-nachher-freigabe-1280.webp) | [Bild](assets/p43-nachher-freigabe-1600.webp) |

Aufgenommen mit einem temporären Spec (Playwright-Chromium, `deviceScaleFactor` 2, auf die Größe der Vorher-Bilder
verkleinert), der nicht committet ist — wie die Vorher-Bilder. Kein echtes Gerät (siehe Lücke „Echtes Handy“ oben).
