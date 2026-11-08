# EPIC-P43 — Aufgeräumte Arbeitsfläche, Navigation und Styling-Presets

**Status:** Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P43
**Dauer:** 2–3 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P42 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T43.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

AncientVoids vorhandene PWA-Oberfläche konsistenter und schneller bedienbar machen: klare Informationshierarchie, Kontextübergaben, schnelle Navigation und sichere Darstellungs-Presets. P34/P35 nicht nochmals bauen. K1/K2/K3/K5/K7/K10.

## 2. Scope (In / Out)

**In:** echter UX-Bestandslauf, Referenz-Mockups, einheitliche Status-/Toolbar-/Leer-/Fehlerzustände, kontextbewusste Schnellnavigation, Add-to-prompt für Dateibereich/Test/Review, Dichte/Abstände/Chatbreite, Theme-Presets und benannte Geräte-Layouts.
**Out:** Preact→React/Zustand-Migration, Pixelkopie von Orca, ungefragter Komplettumbau aller Seiten, neue native App, freie CSS/JS-Ausführung, Veränderung semantischer Statusfarben, Voidwarden-Sprach-/Companion-Funktionen.

## 3. Design-Details

### 3.1 Bestand statt Redesign aus dem Bauch
P34 hat Farbwähler/Fonts/Gerätefenster, P18 vier Kacheln, P35 Breiten-/Harnesskorrekturen. P46 besitzt rechte Datei-Sidebar, Viewer und Diagnosen; hier nur deren Gestaltung/Integration nachziehen, keinen zweiten Explorer bauen. Offene Live-Abnahmen bleiben unter deren AC-IDs. T43.1 dokumentiert reale Screenshots/Journeys Desktop/Pixel und benennt nur verbleibende Probleme. Orca-Poster sind Referenz, keine Belege für AV-Fehler. Vier Flows vergleichen: Session starten, Frage beantworten, Diff revidieren, fehlerhaften Browser-/CI-Test zurückgeben. Komponenten vor großem Umbau als kleine Mockups zeigen, Scope daraus dokumentieren.

### 3.2 Kontext und Navigation
Gemeinsames Kontextpaket aus P36/P37/P39: ausgewählte Dateistelle, Reviewnotiz, Screenshot/Testbefund als sichtbare Quellenchips im Composer, kein automatisches Absenden. Schnellsuche springt zu Projekten/Sessions/Tasks/Werkzeugen mit Tastatur und Touch; Suche ist kein neuer Volltextindex aller Provider-Transkripte. Fokusmanagement/Zurück/Popout erhalten Entwürfe und vermeiden WS-Remounts. Status fasst „wartet auf dich“/Blocker/letzte belegte Aktion zusammen; fachliche Notiz und Laufzeit-/Gate-Status bleiben getrennt. Nur vorhandene Information verwenden, keine erfundenen Restzeiten.

### 3.3 Styling
Bestehende Tokens/FontSettings/AppearanceSettings erweitern. Versionierte Presets: hell/dunkel, Dichte, Text-/Codegröße getrennt, Chatbreite, begrenzte Oberflächen-/Rahmen-/Radiuswerte und lokale statische Hintergrundbilder optional. Semantische ok/warn/err bleiben geschützt; Kontrastprüfung und Reset. Keine remote Fonts, URLs oder beliebigen CSS-Regeln in Importen. JSON-Export nur Geräteappearance/Layout, keine Tokens/Host-Secret-/Sessioninhalte. Benannte Layouts bauen auf tiles/windows auf; aus anderer Auflösung importierte Fenster begrenzen/wieder erreichbar machen. Vorhandene Vier-Kachel-Grenze bleibt, bis eigener Bedarf belegt ist.

### 3.4 Zuständigkeit
PWA-Fachbereiche `features/settings`, `shell`, `workspace`, `windows`, gemeinsame Bausteine `shared`; serverseitige Verträge nur wenn wirklich geteilt. Gerätelokale Darstellung nutzt versionierten lokalen Speicher mit Defaults/Migration; sie ist kein neuer kanonischer Session-State (K7-Trennung). Offline gleiche lokalen Fonts/Presets. Neue Toolbar-/Panel-Slots mit P44 abstimmen, aber keine Plugin-Runtime vorziehen. Browser-/Emulatorstreams sind nicht dauerhaft im Hintergrund aktiv, wenn verborgen.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [src/shared/plugins/artifacts/plugin-theme-artifact.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/plugins/artifacts/plugin-theme-artifact.ts) | Vorbild für kleine öffentliche Token-API; Orca-Tokenliste nicht zur AV-internen API machen. |
| [src/shared/terminal-themes/terminal-contrast-correction.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/terminal-themes/terminal-contrast-correction.ts) | Port-Kandidat für Kontrastberechnung nach Importprüfung; Terminalpalette nicht mit AV-Statusfarben gleichsetzen. |
| [docs/site/content/docs/model/quick-open.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/model/quick-open.mdx) | Schnellnavigation als Produktreferenz. |
| [docs/site/content/docs/agents/native-chat.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/agents/native-chat.mdx) | Referenz für Quellenübergabe/Composer; bestehende Queue/Slash/Modelle nicht neu bauen. |

## 4. Aufgaben (Checkliste T43.m)

- [ ] **T43.1** UX-Audit mit Vorher-Belegen, P34/P35-Abgleich und klarer verbleibender Problemliste; Mockups für vier Journeys, Änderungsumfang festhalten. **K1/K2/K3**.
- [ ] **T43.2** Gemeinsame Kontextchips/Add-to-prompt und konsistente Tool-/Fehler-/Leerzustände implementieren; immer Quellenvorschau, nie implizites Senden. **K3/K5**.
- [ ] **T43.3** Schnellnavigation, Fokus/Zurück und fachliche Statusnotizen integrieren; vorhandene Entwürfe/Popouts ohne Remountverlust. **K1/K2/K7**.
- [ ] **T43.4** Versionierte Theme-/Dichte-/Breiten-Presets, Kontrast-/Importprüfung, lokale Assets und Reset; vorhandene Farbwähler/Fonts wiederverwenden. **K2/K10**.
- [ ] **T43.5** Benannte Layout-Presets für Gerät/Fenstergröße samt sicherer Migration; P44-Tokens/Slots benennen. **K2/K7/K10**.
- [ ] **T43.6** `e2e/specs/workspace-ux.spec.ts` und `appearance-presets.spec.ts`, Screenshot-/Tastatur-/Pixel-Abnahme; Gate/PWA-Build/K2-Messlauf. **K1/K2/K3/K10**.

## 5. Acceptance Criteria (AC-P43-k)

- **AC-P43-1:** Vorher/Nachher zeigt vier komplette Journeys; dokumentierte UX-Probleme sind behoben statt nur anders eingefärbt.
- **AC-P43-2:** Quellen aus Code/Review/Browser/CI lassen sich im Composer prüfen und gezielt senden; Auswahl sendet nichts automatisch.
- **AC-P43-3:** Schnellnavigation funktioniert per Tastatur und Touch; Fokus/Zurück bewahrt Entwürfe und Sessionverbindungen.
- **AC-P43-4:** Presets/Import/Reset funktionieren offline; unzulässige URLs/CSS/Statusfarben und kaputte Versionen werden sichtbar abgelehnt.
- **AC-P43-5:** Benanntes Layout ist nach Reload nutzbar, auch auf kleinerer Anzeige; keine verlorenen Fenster.
- **AC-P43-6:** Approval bleibt einhändig erreichbar und K1/K2 unverändert nachweisbar; Voidwarden bleibt eigenständig.

## 6. Premortem (Failure-Modi + Mitigation)

1. Mehr Optionen verschlechtern Übersicht → kleine Presets, klare Defaults und Reset statt beliebiger CSS-Editor.
2. Optische Angleichung überschreibt Statusbedeutung → geschützte Status-Tokens und Kontrasttests.
3. Navigation verliert Draft/WebSocket → Views erhalten und Fokus-/Reconnect-Regression messen.
4. Gestaltung kopiert Orca-Abhängigkeiten → AV-Preact/Tokens behalten, nur Interaktionsmuster übernehmen.

## 7. Definition of Done

Alle T43.* und AC-P43-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.
