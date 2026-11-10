# EPIC-P44 — Plugin-Erweiterungen für Panels, Aktionen und Themes

**Status:** Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P44
**Dauer:** 2–3 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P43.5 mit nachweislich grünen Exit-Kriterien (seit 10.11.2026; Tokens/Slots liefert P43, Presets P43.5); wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T44.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

P30s installierbare Adapter/Sinks um klar begrenzte UI-Erweiterungen ergänzen: eigene Panels und deklarative Themes aus nachvollziehbarer Quelle. Ein gemeinsamer Plugin-Lifecycle bleibt maßgeblich. K1/K2/K4/K5/K7/K10.

## 2. Scope (In / Out)

**In:** additive Manifest-Gattungen theme/panel, sichtbare Capabilities, sandboxed lokale Panel-Assets, enger versionierter Bridge-Vertrag, registrierte Aktionsanforderungen und zwei Beispiele.
**Out:** zweite Plugin-Registry/Installation, beliebiger Node-Code aus einem Panel, ungeprüftes Remote-JavaScript, öffentliche Marketplace-/Cloud-Pflicht, heimlicher Tokenzugriff, direkte Hub-Interna oder Layout-DOM-Manipulation.

## 3. Design-Details

### 3.1 Bestehende Planung bewahren
P30 installiert/verifiziert/aktiviert Adapter und Sinks mit Hash/Contract-Nachweis. P44 erweitert dessen Manifest/Inventar/Versionen additiv, keine alternative package.json-Discovery. Vor Umsetzung P30-Implementierung prüfen; Schemaänderung ADR und alte Manifestversionen testen. P43 stellt die begrenzten Theme-Tokens und Slots bereit. UI-Plugins sind keine neuen Coding-Provider; P31 bleibt Providerkatalog. Vertragsprüfung ist kein Sicherheitszertifikat für Backend-Plugins.

### 3.2 Panels und Befugnisse
Panel-Assets aus gepinntem lokalen Paket, eigener sandboxed iframe-Kontext/Origin ohne Zugriff auf PWA-Storage. Bridge mit noncegebundener Instanz, Schema/Version, begrenzten Request-IDs, Quellen-/Instanzprüfung und Teardown bei Disable. Bei opaque Origin genügt origin-String nicht: tatsächliches contentWindow/MessagePort und Instanzbindung prüfen. Nur explizit freigegebene Lesedaten (z.B. reduzierte Session-Metadaten) und registrierte Aktionsanforderungen; keine Device-/Fleet-/Provider-Tokens, keine freien URLs/Shell. Jede schreibende Aktion durch normale Actor-/Approval-Policy, Panel kann keine Freigabe für sich beantworten. Netzwerkberechtigung standardmäßig aus, keine beliebigen Fetch-Proxy-Ziele. Hostseitiger Quota/Timeout und Abschalten fehlerhafter Panels.

### 3.3 Themes und Lifecycle
Themes deklarieren erlaubte P43-Tokens/Assets; kein freies CSS/JS. Bilder/Fonts müssen lokal, begrenzt und validiert sein; kein Auslesen über CSS-URLs. Exportierte API klein und versioniert. Theme-/Panel-Update braucht neue Hash-Aktivierung. Disable entfernt UI/Bridge-Abos, Reset stellt native Darstellung wieder her. Fehlendes/manipuliertes Paket sichtbar broken, keine automatische Netzreparatur. K7: aktive Plugin-/Grant-/Version-Zuordnung und Status aus P30-Journal/Snapshot; private Panel-UI-Zustände separat mit begrenztem Schema, niemals zweite Session-Wahrheit.

### 3.4 Beispiele und Einbau
Neues Panel zeigt read-only Test-/Run-Metadaten aus freigegebenem Context, optionale Startanforderung bleibt bestätigt. Theme-Beispiel verändert nur erlaubte Oberflächen. Modulgrenzen aus P30 nutzen; PWA `features/plugins/` plus vorhandene Tool-/Popout-Slots. Keine Orca React/Zustand/Electron-APIs kopieren. Voidwarden ist externe Anwendung und wird nicht durch ein AV-Panel ersetzt.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [src/shared/plugins/manifest/plugin-manifest-fields.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/plugins/manifest/plugin-manifest-fields.ts) | Port-Kandidat für ID-/Pfad-Schema-Ideen; Hilfsimports/Reservierungen auf AV anpassen. |
| [src/shared/plugins/capabilities/plugin-capabilities.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/plugins/capabilities/plugin-capabilities.ts) | Capability-Vokabular als Referenz, keine pauschale Berechtigungsübernahme. |
| [src/main/plugins/panels/plugin-frame-theme-snapshot.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/plugins/panels/plugin-frame-theme-snapshot.ts) | Kleine Schema-/Sanitization-Referenz; AV nutzt P43-Token-Whitelist statt rohem CSS. |
| [src/shared/plugins/artifacts/plugin-theme-artifact.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/plugins/artifacts/plugin-theme-artifact.ts) | Versionierte additive Token-API und Testfälle als Port-Vorlage. |

## 4. Aufgaben (Checkliste T44.m)

- [ ] **T44.1** P30/P43-Bestand, Manifest-/Bridge-/Capability-ADR und Upgrade-Regeln; alte Plugins weiterhin laden. **K5/K7**.
- [ ] **T44.2** Deklarative Theme-Artefakte über bestehenden Installer prüfen und aktivieren; URL/CSS/Traversal/Assetbudgets testen. **K2/K5/K10**.
- [ ] **T44.3** Panel-Host und nonce-/instanzgebundene MessageBridge mit begrenztem Lesekontext und Operationsweitergabe implementieren. **K1/K4/K5**.
- [ ] **T44.4** Grant-/Disable-/Crash-/Update-/Restore-Lifecycle integrieren, fremde Frames und alte Ports nach Disable verweigern. **K5/K7**.
- [ ] **T44.5** Lokale Theme-/Panel-Beispiele mit Autorendoku und Contract-/Bridge-Tests, keine Zugangstokens im Frame. **K4/K5/K10**.
- [ ] **T44.6** `e2e/specs/plugin-panels.spec.ts`: Installation → Auswahl → Aktion → Update/Disable → Restart; Gate/PWA-Build/Archcheck. **K1/K2/K5/K7/K10**.

## 5. Acceptance Criteria (AC-P44-k)

- **AC-P44-1:** P30-Adapter/Sink-Pakete bleiben kompatibel; Theme/Panel teilen dieselbe Installation und Hash-Versionierung.
- **AC-P44-2:** Ein lokales Beispielpanel und Theme sind ohne Hub-Fork erreichbar und nach Restart korrekt zugeordnet.
- **AC-P44-3:** Panel erhält weder PWA-Storage noch Tokens; fremde/alte Instanz und übergroße Requests werden zurückgewiesen.
- **AC-P44-4:** Schreibende Panel-Aktion braucht normale serverseitige Freigabe; kein Panel kann eigene Approval beantworten.
- **AC-P44-5:** Disable/Update beendet Bridge/Abos, fehlendes Paket ist sichtbar broken; native Oberfläche bleibt bedienbar.
- **AC-P44-6:** Theme bleibt offline nutzbar und verändert keine geschützten Statusfarben oder Netz-/Script-Befugnisse.

## 6. Premortem (Failure-Modi + Mitigation)

1. Zweite Pluginplattform driftet → P30 erweitern, ein Installer/Inventar/Journal.
2. iframe fühlt sich isoliert an, Bridge ist Admin → minimale Daten, instanzgebundene Schemas und serverseitige Actor-Policy.
3. Theme exfiltriert über CSS/URL → deklarative Tokens/lokale geprüfte Assets, keine freien Regeln.
4. Update hinterlässt lebende Ports → Instanzgeneration und harte Revocation/Disable-Negativtests.

## 7. Definition of Done

Alle T44.* und AC-P44-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.
