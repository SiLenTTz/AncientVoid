# EPIC-P30 — Installierbare Adapter- und Reporting-Sink-Plugins

**Status:** Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P30
**Dauer:** 2–3 Agenten-Wochen (ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P29-, P34- und P35-Exit-Kriterien grün (Index-Kette seit 07.11.2026); bestehende Adapter-/Reporting-Verträge geprüft.

Quelle: [Vergleichsanalyse vom 05.11.2026](../docs/2026-11-05_paseo-vs-ancientvoid.md), §5; [Planungsgrundlage und Quellen](../docs/2026-11-05_paseo-umsetzungsplanung.md).

**Planungsauftrag:** Der Nutzer hat am 05.11.2026 ausdrücklich detaillierte
Epics zu den Verbesserungen der Paseo-Analyse beauftragt. Das erlaubt diese
Planung vor grünen Vorgängern, aber keinen Implementierungsstart. Vor T*.1
Vorgänger-AC mit aktueller Code-/Test-Evidenz prüfen; historische Statuszeilen
reichen nicht. Keine neue Ausnahme von AGENTS.md durch diesen Entwurf.

## 1. Ziel

Ein vertrauenswürdiges Adapter- oder Sink-Paket ist mit nachvollziehbarer
Version installierbar, prüfbar und wieder entfernbar, ohne Hub-Fork.
Bestehende Registries und Contracts bleiben der Integrationsweg. Messlatten:
K5/K7/K8, für neue Provider zusätzlich bestehende Capability-Nachweise.

## 2. Scope (In / Out)

**In:** deklaratives Manifest v1, lokale/Git-Quelle, gepinnter Installationsstand,
hubctl `plugin add/list/inspect/check/enable/disable/remove`, Kompatibilitäts-
und Testkit-Nachweise; zwei Beispiele (Adapter und Sink).

**Out:** öffentliche Registry, Marketplace, beliebige UI-Plugins/Hooks,
Auto-Updates, ungefragte Downloads, sichere Sandbox für beliebigen Fremdcode,
Hot-Swap laufender Sessions oder neue Loop-Plugin-Gattung.

## 3. Design-Details

### Orca-Abgleich vom 08.11.2026

P30 bleibt auf Adapter-/Sink-Installation und Lifecycle begrenzt. Nutzer möchte
auch UI-/Theme-Plugins; diese erweitern später denselben Installer in
[P44](EPIC-P44-plugin-panels-themes.md), kein zweites Plugin-System.
Konkrete gepinnte Referenzen: [Manifestfelder](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/plugins/manifest/plugin-manifest-fields.ts)
und [begrenztes Manifestlesen](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/plugins/plugin-manifest-file.ts).
ID-/Pfadvalidierung und Read-Budget sind kleine Port-Kandidaten; Orcas generiertes
Manifest-/Electron-/UI-System nicht übernehmen. Imports/Unterlizenzen vor Port
prüfen und MIT-Notice erhalten, siehe [Übernahmerezept](../docs/2026-11-08_orca-epic-planung.md).
P35s konfigurierbare Modelle bleiben Fundament für P31. Keine Scope-Erweiterung
oder neue Startfreigabe für P30 durch diese Referenzen.

### 3.1 Vorhandene Nähte

`AdapterRegistry.loadAll` lädt bereits externe Modulregistrierungen;
`loadReportingSinks` und `ReportingSink` existieren. Beispiele unter
`examples/adapters/openai-compat/` und `examples/reporting-sinks/webhook/`.
Das neue Format beschreibt diese Exporte; es ersetzt weder Factory-Interface
noch best-effort-Sink-Verhalten (ADR-0009). Adapter kennen nur AdapterContext.

Manifest-Schema unter `packages/contracts/src/plugins/`, Installationsdomäne
unter `packages/core/src/modules/plugins/` mit `index.ts`; CLI in hubctl,
Verdrahtung im Hub. ADR vor neuem geteilten Plugin-/Event-Vertrag. Keine
pauschale Vergrößerung des AdapterContext wegen Plugins.

### 3.2 Installation und Aktivierung

Entwurf `ancientvoid.plugin.json`: schemaVersion, eindeutige ID, Version,
Contract-Kompatibilitätsbereich, kind `adapter|reporting-sink`, relativer
Entry-Point, Konfig-Schema/Referenz. Details vor Implementierung versionieren.
Manifest lesen/validieren **vor** dynamischem Import; Import führt Code aus.

`add` legt unveränderliche Kopie im lokalen Datadir ab: Git-Quelle auf volle
Commit-SHA auflösen, lokale Quelle mit Inhaltshash erfassen. Keine Symlinks
außerhalb des Pakets, keine Entry-Point-Traversal, keine Kollision mit Builtins.
Quell-URL vor Logs von Credentials bereinigen. Abhängigkeiten per Lockfile;
Lifecycle-Skripte standardmäßig aus. Benötigt ein Paket Build/Install-Skripte,
bleibt es deaktiviert mit konkreter Anleitung zur separat genehmigten Vorbereitung.
Kein Server-Build-Schritt eingeführt.

`check` führt vereinbarte Contract-Suite in separatem Prozess mit temporärem
Datadir, Timeout und bereinigter Umgebung aus. Das ist Fehlerisolation,
**keine** Security-Sandbox: auch Import und Tests sind nur für vertrauenswürdigen
Code nach menschlicher Auswahl zulässig. Testkit prüft Adapter-Semantik,
keine Vertrauenswürdigkeit; Skips werden gesondert angezeigt. Fehlender Nachweis
verhindert Status „geprüft“. Sinks bekommen eigenen engen Export-/Fehler-Test.

`enable` bestätigt ID/Hash/Quelle und schreibt Registrierung atomar. Änderungen
wirken erst nach kontrolliertem Hub-Neustart. Bei unvereinbarem Paket bleibt
alte Konfiguration aktiv; Disable/Remove eines von aktiven Sessions genutzten
Pakets wird verweigert. Updates sind neue Stände mit expliziter Aktivierung.

### 3.3 Recovery

Installationsinventar und Aktivierungsoperationen mit Hash/Phase sind aus
Snapshot+Journal rekonstruierbar; Paketdateien liegen als referenzierte
Artefakte vor. Fehlende/manipulierte Artefakte: Plugin disabled/broken samt
sichtbarem Grund, bestehende Sessions nicht heimlich auf andere Version umbiegen.
Konfiguration enthält nur Secret-Referenzen. Entfernen löscht keine Session-
Events oder Konfig-Secrets. Netzwerk-Sinks bleiben opt-in; Fehler blockieren
den Sessionabschluss gemäß bestehendem Vertrag nicht.

## 4. Aufgaben (Checkliste T30.m)

- [ ] **T30.1** Registry-/Sink-Inventar, ADR und Manifest-/Installationsvertrag
  mit IDs, Kompatibilität, Besitz und Recovery definieren. **K5/K7**.
- [ ] **T30.2** `add/inspect/list` mit Git-Pin, lokaler Kopie, Hash,
  atomarem Staging und Pfadprüfung; Tests für Credential-URL, Duplikat,
  Symlink, abgebrochenen Download und inkompatible Version. **K5/K7**.
- [ ] **T30.3** `check` und maschinenlesbaren Testkit-/Sink-Bericht liefern;
  Timeout/Throw/Skip/fehlenden Export nachweisen, keine Importausführung
  bereits durch `inspect`. **K5/K8**.
- [ ] **T30.4** `enable/disable/remove` samt menschlicher Auswahl, aktiver
  Nutzungssperre und Neustart-Verhalten implementieren; Crash zwischen
  Staging und Registrierung und fehlende Artefakte testen. **K7/K8**.
- [ ] **T30.5** Beide Beispiele paketierbar dokumentieren und mit frischem
  Test-Datadir installieren; `e2e/specs/plugin-lifecycle.spec.ts` startet
  installierten Adapter im Hub und beobachtet Sink-Ausgabe. **K5/K7/K8**.

## 5. Acceptance Criteria (AC-P30-k)

- **AC-P30-1:** Ein lokaler Beispieladapter und ein Git-Testpaket werden nach
  ID/Hash reproduzierbar aufgelistet, geprüft und nach expliziter Aktivierung
  vom echten Hub geladen; kein manueller Eingriff in Hub-Quellcode.
- **AC-P30-2:** Ungültiger Pfad, Kollision, inkompatibler Contract oder
  fehlgeschlagene Suite verändert keine aktive Registrierung. Skip ≠ Pass.
- **AC-P30-3:** Paket-Hashwechsel ist neue Freigabe; Restart nach unterbrochener
  Installation erhält den letzten gültigen Stand, fehlende Dateien sind sichtbar.
- **AC-P30-4:** Aktive Nutzung verhindert Entfernen; Deaktivierung unbenutzter
  Pakete nach Neustart wirksam; Beispiel-Sink-Fehler stört keine Sessions.
- **AC-P30-5:** Adapter-Testkit und Architekturcheck grün, Events ≤4 KB;
  keine Secrets in Manifest, Ausgabe oder Journal, kein impliziter Netzwerk-Sink.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Testkit wird als Sicherheitszertifikat missverstanden:** UI/CLI nennen
   Quelle und Code-Ausführungsrisiko; nur Contract-Prüfung attestieren.
2. **Git-Tag wird verschoben:** volle SHA plus Inhaltshash speichern,
   automatische Aktualisierung ausgeschlossen.
3. **Import scheitert während Hub-Start:** kompatiblen aktiven Stand behalten,
   konkreten Ladefehler melden, kein stiller Fallback auf anderen Adapter.
4. **Remove bricht Resume:** aktive Referenzen prüfen; Artefaktversion für
   Sessions erhalten, bis Nutzung beendet ist.

## 7. Definition of Done

Alle Aufgaben/AC belegt; `npm run gate` inklusive Architekturcheck und
Adapter-Testkit grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfehler gemäß
AGENTS.md separat belegt. Jeder neue Ablauf mit Spec in `e2e/specs/`, neue
UI-Funktionen ebenso. CLI-Hilfe und beide Beispiele erreichbar, alter
Konfig-Ladeweg unverändert nutzbar, keine Registry/Publikation vorausgesetzt.
