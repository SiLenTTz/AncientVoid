# EPIC-P43.5 — Quellenchips, Darstellungs-Presets und benannte Layouts

**Status:** Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P43.5
**Dauer:** 1,5–2 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P43 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T43.5-1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.
**Abtrennung 10.11.2026 (Jan):** Dieser Entwurf war bis dahin EPIC-P43 „Arbeitsfläche/Styling“. UX-Bestandslauf, Mockups, Zustands-/Leer-/Fehlerzustände, Informationshierarchie und Schnellnavigation sind in das neu gefasste [EPIC-P43](EPIC-P43-ux-next-level.md) übergegangen ([Design-Review](../docs/2026-11-10_ux-next-level-designreview.md)). Hier bleibt, was P43 nicht abdeckt. Belege: [UX-Audit vom 10.11.2026](../docs/2026-11-10_p43-ux-audit.md), Befunde #8, #9 und #12.

## 1. Ziel

Auf dem Gestaltungsfundament aus P43 drei Dinge ergänzen: Quellen aus Code, Review, Browser und CI gezielt in den Prompt übergeben, die Darstellung über sichere Presets anpassen und Fenster-/Kachel-Anordnungen benennen und wiederherstellen. P34/P35/P43 nicht nochmals bauen. K2/K3/K5/K7/K10.

## 2. Scope (In / Out)

**In:** Add-to-prompt für Dateibereich/Test/Review als sichtbare Quellenchips, Dichte/Chatbreite, versionierte Theme-Presets mit Import/Export/Reset und benannte Geräte-Layouts.
**Out:** alles aus P43 (Fundament, Zustandssprache, Start, Züge, Herauslösen, Nyx-Blatt, Schnellsuche), Preact→React/Zustand-Migration, Pixelkopie von Orca, ungefragter Komplettumbau aller Seiten, neue native App, freie CSS/JS-Ausführung, Veränderung semantischer Statusfarben, Voidwarden-Sprach-/Companion-Funktionen.

## 3. Design-Details

### 3.1 Bestand
P43 liefert Tokens, Skalen, Bausteine und die Fensterziele; dieses Epic baut darauf auf und ändert sie nicht. P34 hat Farbwähler/Fonts/Gerätefenster, P18 vier Kacheln, P35 Breiten-/Harnesskorrekturen. P46 besitzt rechte Datei-Sidebar, Viewer und Diagnosen; hier nur deren Gestaltung/Integration nachziehen, keinen zweiten Explorer bauen. Offene Live-Abnahmen bleiben unter deren AC-IDs. Orca-Poster sind Referenz, keine Belege für AV-Fehler.

### 3.2 Kontext und Navigation
Gemeinsames Kontextpaket aus P36/P37/P39: ausgewählte Dateistelle, Reviewnotiz, Screenshot/Testbefund als sichtbare Quellenchips im Composer, kein automatisches Absenden. Die Schnellsuche aus P43 bekommt die Quellen als Sprungziele, keinen neuen Volltextindex. Fokusmanagement/Zurück/Popout erhalten Entwürfe und vermeiden WS-Remounts. Status fasst „wartet auf dich“/Blocker/letzte belegte Aktion zusammen; fachliche Notiz und Laufzeit-/Gate-Status bleiben getrennt. Nur vorhandene Information verwenden, keine erfundenen Restzeiten.

### 3.3 Styling
Bestehende Tokens/FontSettings/AppearanceSettings erweitern. Versionierte Presets: hell/dunkel, Dichte, Text-/Codegröße getrennt, Chatbreite, begrenzte Oberflächen-/Rahmen-/Radiuswerte und lokale statische Hintergrundbilder optional. Semantische ok/err, Ruf- und Info-Farbe (P43) bleiben geschützt; Kontrastprüfung und Reset. Keine remote Fonts, URLs oder beliebigen CSS-Regeln in Importen. JSON-Export nur Geräteappearance/Layout, keine Tokens/Host-Secret-/Sessioninhalte. Benannte Layouts bauen auf tiles/windows auf; aus anderer Auflösung importierte Fenster begrenzen/wieder erreichbar machen. Vorhandene Vier-Kachel-Grenze bleibt, bis eigener Bedarf belegt ist.

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

## 4. Aufgaben (Checkliste T43.5-m)

- [ ] **T43.5-1** Gemeinsame Kontextchips/Add-to-prompt implementieren; immer Quellenvorschau, nie implizites Senden. **K3/K5**.
- [ ] **T43.5-2** Fachliche Statusnotizen und Quellen als Sprungziele der Schnellsuche; vorhandene Entwürfe/Popouts ohne Remountverlust. **K1/K2/K7**.
- [ ] **T43.5-3** Versionierte Theme-/Dichte-/Breiten-Presets, Kontrast-/Importprüfung, lokale Assets und Reset; vorhandene Farbwähler/Fonts wiederverwenden. **K2/K10**.
- [ ] **T43.5-4** Benannte Layout-Presets für Gerät/Fenstergröße samt sicherer Migration, darunter ein Browser-Fenster-Preset „Handy“ (Audit #8); P44-Tokens/Slots benennen. **K2/K7/K10**.
- [ ] **T43.5-5** Funktionsinventar aus P43 um die neuen Einträge erweitern; `e2e/specs/quellenchips.spec.ts` und `appearance-presets.spec.ts`, Screenshot-/Tastatur-/Pixel-Abnahme; Gate/PWA-Build/K2-Messlauf. **K1/K2/K3/K10**.

## 5. Acceptance Criteria (AC-P43.5-k)

- **AC-P43.5-1:** Quellen aus Code/Review/Browser/CI lassen sich im Composer prüfen und gezielt senden; Auswahl sendet nichts automatisch.
- **AC-P43.5-2:** Quellen sind über die Schnellsuche per Tastatur und Touch erreichbar; Fokus/Zurück bewahrt Entwürfe und Sessionverbindungen.
- **AC-P43.5-3:** Presets/Import/Reset funktionieren offline; unzulässige URLs/CSS/Statusfarben und kaputte Versionen werden sichtbar abgelehnt.
- **AC-P43.5-4:** Benanntes Layout ist nach Reload nutzbar, auch auf kleinerer Anzeige; keine verlorenen Fenster.
- **AC-P43.5-5:** Approval bleibt einhändig erreichbar und K1/K2 unverändert nachweisbar; das Funktionsinventar aus P43 bleibt grün.

## 6. Premortem (Failure-Modi + Mitigation)

1. Mehr Optionen verschlechtern Übersicht → kleine Presets, klare Defaults und Reset statt beliebiger CSS-Editor.
2. Optische Angleichung überschreibt Statusbedeutung → geschützte Status-Tokens und Kontrasttests.
3. Navigation verliert Draft/WebSocket → Views erhalten und Fokus-/Reconnect-Regression messen.
4. Gestaltung kopiert Orca-Abhängigkeiten → AV-Preact/Tokens behalten, nur Interaktionsmuster übernehmen.

## 7. Definition of Done

Alle T43.5-* und AC-P43.5-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.
