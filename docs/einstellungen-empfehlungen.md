# Einstellungen: was es gibt, was sinnvoll wäre

**Stand:** 2026-10-27 · gehört zu [EPIC-P20](../epics/EPIC-P20-oberflaeche-feinschliff.md) T20.4.
Das hier ist eine **Empfehlungsliste**. Umgesetzt ist nur, was in der Spalte „Stand“ steht.

## Heute vorhanden

Die Seite besteht aus vier Karten (`apps/pwa/src/app/App.tsx`, Seite `settings`):

| Karte | Inhalt | Quelle |
|---|---|---|
| Allgemein | Erscheinungsbild (Hell/Dunkel), Pinch-Zoom, „Erreichbar über“, Geräte-Token (nur Anzeige), Projekt-Wurzeln (Zähler), Passkey, Token wechseln | `features/settings/Settings.tsx` |
| Flotte | Hosts hinzufügen/entfernen, Einladungscode | `features/fleet/` |
| Benachrichtigungen | Push an/aus und welche Ereignisse | `features/settings/PushSettings.tsx` |
| Gemini | Schlüssel (nur schreibbar), lokale Auslese | `features/settings/GeminiSettings.tsx` |

Mit EPIC-P20 kommt in „Allgemein“ dazu: **Zoom der Oberfläche** (70–200 %, Strg + Mausrad,
Strg + `+`/`−`/`0`) und **Schimmer der Kontextleiste** (an/aus, folgt „Bewegung reduzieren“).

## Empfehlungen

Priorität: **A** = klarer Nutzen, klein · **B** = nützlich, mittel · **C** = später.
Jede Einstellung ist pro Gerät (`localStorage`), außer sie ändert den Hub (dann Server-Konfiguration).

### Darstellung

| Einstellung | Warum | Prio |
|---|---|---|
| Erscheinungsbild „System“ (zusätzlich zu Hell/Dunkel) | Handy und PC wechseln den Modus von selbst. Heute nur zwei Zustände, die der Nutzer pflegen muss. | A |
| Dichte (kompakt / normal) | Auf dem 2560-px-Bildschirm mit vier Kacheln zählt jede Zeile. Ersatz für „viele kleine Zoom-Schritte“. | B |
| Zeitformat (Uhrzeit / relativ „vor 3 min“) | Der Verlauf zeigt nur Uhrzeiten, bei langen Läufen ist „vor …“ lesbarer. | C |
| Chat-Schrift (Mono / Proportional) | Lange Antworten sind in Proportionalschrift leichter lesbar. Code bleibt Mono. | C |

### Verlauf und Chat

| Einstellung | Warum | Prio |
|---|---|---|
| Standardfilter (Überwachen / Debuggen / Lesen) | Steht heute in `localStorage` (`uacc.filter`), aber nur über die Tabs änderbar. | A |
| Thinking und Tool-Ausgaben standardmäßig eingeklappt | Bei pi/claude sind Verläufe mit Dutzenden Tool-Aufrufen sonst lang. Seit BUG-0065 zeigt pi sie vollständig. | A |
| Markdown-Darstellung an/aus („Rohtext“) | Wer Antworten kopieren und prüfen will, braucht den Rohtext. Seit BUG-0067 wird gerendert. | B |
| Anzahl gehaltener Zeilen (Standard 500, Hintergrund-Kachel 150) | Speicher und Rendering (K2) bei vier Kacheln. | C |

### Desktop

| Einstellung | Warum | Prio |
|---|---|---|
| Standard-Layout der Kacheln (1, 2, 1+2, 2×2) und Start mit eingeklappter Liste | Heute merkt sich der Browser nur den letzten Zustand. | B |
| Diff-Ansicht (nebeneinander / untereinander), Zeilenumbruch | Ab 1280 px nebeneinander, bei langen Zeilen ist Umbruch besser. | A |
| Tastenkürzel an/aus | Alt+1–4, Alt+L, Strg+`+`/`−` können mit Fenstermanager-Kürzeln kollidieren (Omarchy/Hyprland). | B |

### Benachrichtigungen

| Einstellung | Warum | Prio |
|---|---|---|
| Ruhezeiten (z. B. 22–7 Uhr nur Freigaben) | Push ist heute an/aus je Ereignisart. Nachts stören „fertig“-Meldungen. | B |
| Ton/Vibration getrennt | Am PC Ton, am Handy Vibration. | C |

### Sicherheit

| Einstellung | Warum | Prio |
|---|---|---|
| Geräte-Token: Label und Ablaufdatum anzeigen | Heute nur „•••• aktiv“. Man sieht nicht, welches Gerät welches Token hat. | A |
| Passkey auch für „Loop starten“ bzw. Betriebsartwechsel (nach ADR-0038) | Außenwirkung (Merge, Commit) soll eine bewusste Handlung sein. | B |
| Automatische Sperre nach Inaktivität (Token-Seite) | Handy liegt offen herum. | C |

### System und Hilfe

| Einstellung | Warum | Prio |
|---|---|---|
| Hub-Info: Version/Commit, Host-ID, Laufzeit, Adapter | `GET /api/health` liefert es schon. So sieht man nach dem Ausrollen sofort, ob der Hub aktuell ist. | A |
| Verbindungstest und „Cache leeren / neu laden“ (Service Worker) | Nach einem Update zeigt die PWA gelegentlich den alten Stand. | A |
| Export/Import der Geräte-Einstellungen | Neues Gerät in einer Minute eingerichtet. | C |

### Nicht empfohlen

- Eigene Farbthemen: das Design-System (`docs/design-system.md`) ist bewusst eng, mehr Varianten kosten Pflege ohne Nutzen.
- Einstellungen, die Server-Verhalten ändern (Kontextgröße je Modell, Standardmodell): gehören in `hub.config.json`
  (ADR-0032), nicht in die Oberfläche, weil sie für alle Geräte gelten.

## Reihenfolge für eine spätere Umsetzung

1. A-Punkte „Hub-Info“, „Cache leeren“, „Erscheinungsbild System“, „Standardfilter“ (zusammen ca. ein Tag, alles in
   `features/settings/`).
2. Diff-Ansicht (hängt an T20.1).
3. B-Punkte nach Bedarf. Jeder braucht einen Spec in `e2e/specs/` und die Mobile-Prüfung (AC-P8-5).
