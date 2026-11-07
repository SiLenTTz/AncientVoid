# EPIC-P39 — Browser in der PWA: Tests, Inspektion und visuelles Feedback

**Status:** Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P39
**Dauer:** 3–5 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P38 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T39.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

Einen von AV verwalteten Browser pro Arbeitskontext in der PWA öffnen, bedienen und für reproduzierbare Webtests verwenden; Screenshots/DOM-/Style-Kontext gezielt an Agenten geben. PWA bleibt Client, Chromium läuft auf dem Ausführungshost. K1/K2/K5/K7/K8/K10; K3 für Review-Artefakte.

## 2. Scope (In / Out)

**In:** lokaler Browserdienst mit Playwright/Chromium als erster zu prüfender Engine, isolierte Profile, PWA-Browserpanel/Popout, Navigation/Eingabe, Screenshot, Console-/Netzfehler, strukturierte Testläufe und Design-Auswahl; mobile Viewports.
**Out:** eigene Browserengine, beliebige externe Seiten per iframe, persönliches eingeloggtes Browserprofil, Electron-/Native-App-Pflicht, physisches Android durch Viewport simulieren, uneingeschränkte Shell/CDP aus dem Client.

## 3. Design-Details

### 3.1 Architekturentscheidung vor Vollausbau
Spike vergleicht serverseitigen Chromium mit Screenshot-/Frame-Stream und Eingabekanal gegen kooperative instrumentierte Preview. Ziel ist ein eigener nutzbarer Browser in AV, auch für Seiten mit Frame-Sperren. Die PWA selbst kann keinen Chromium-Prozess starten. MVP: Host-Worker besitzt Browser/Context, PWA zeigt begrenzten Frame-Stream; kein öffentlicher CDP-Port. Bandbreite/Lesbarkeit/Input-Latenz auf Pixel/Tailscale messen; unbrauchbares Streaming blockiert Vollausbau und wird nicht als fertiger Browser gezählt. Headless-Modus zuerst; headed nur bei belegtem Bedarf.

### 3.2 Nähte und Trennung
P29 Preview bleibt bestehen. Browser-Service in eigenem `core`-Modul mit Worker-/Browser-Grenze, Contracts `contracts/src/browser/`, Routen `modules/browser/`, UI `features/browser/`. Ob Hilfspaket nötig ist, im ADR am Spike entscheiden. Keine Playwright-/Browser-Imports in Provider-Adaptern; Agenten nutzen registrierte Browseroperationen über Gateway/Hub. Registry verknüpft BrowserContext mit Host/Session/Arbeitsort aus P38 und P29-Service. Separater Context/Profile je Workspace; Testkontext und manuelle Nutzung nicht gleichzeitig unkontrolliert schreiben lassen.

### 3.3 Ziel- und Eingabekontrolle
Standardziele sind registrierte Workspace-Services. Weitere Test-Origins nur explizit konfigurieren/freigeben. Navigations-/Redirect-/Download-/WebSocket-Ziele, DNS-Rebinding und privilegierte lokale Endpunkte begrenzen; keine Browser-OS-/Hub-Admin-URL durch Agenten. P29-Proxy nicht zum allgemeinen Proxy erweitern. Cookies/Storage bleiben im Kontext, nicht AV-Gerätetoken; Browserprofil nie aus persönlichem Chromium importieren. Eingaben/Uploads als schema-validierte Operationen. Stop beendet Kontext/Worker nach Ownership, keine fremden Browser.

### 3.4 Tests und Design Mode
Benannte Testfälle mit Aktion/Assertion/Timeout/Viewport/URL; Status läuft/bestanden/fehlgeschlagen/abgebrochen/unbekannt. Ausgewählte lokale Playwright-Specs nur als ausdrücklich registrierte Testaktionen, kein beliebiger hochgeladener JS-Code. Screenshots/Trace/Console als begrenzte Blob-Artefakte. DOM-Auswahl im kontrollierten Browser via geprüfter Instrumentierung, inklusive Frame-Zuordnung, Selector, Ausschnitt, Style-Whitelist und optionaler Source-Map (nur wenn vorhanden). Passwort-/Secret-Felder auslassen; Nutzer prüft Kontext vor Senden über P36. Kein Claim, jede externe Seite erlaube Instrumentierung.

### 3.5 Recovery und Ressourcen
Journal hält Browser-/Testidentität und Artefakte; Seiten nach Crash nicht automatisch mit nebenwirkenden Eingaben wiederholen. Laufende Tests interrupted/unknown, neuer Kontext nach explizitem Resume. Browseranzahl, RAM, Frames/FPS, Trace-/Downloadquota hostweise begrenzen. Eventstore speichert nur Metadaten/Blob-Refs, niemals Video-Frames. Browserausfall darf Session-Restore <3 s und Not-Stopp nicht blockieren. Offline letztes Bild mit Zeitstempel und deaktivierter Eingabe.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [src/main/browser/element-grab/grab-guest-element-context-script.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/browser/element-grab/grab-guest-element-context-script.ts) | Port-Kandidat für Selector-/Style-Auszug; enthält freie Namen wie BUDGET/containsSecret/STYLE_PROPS, nur mit geprüftem Host-Wrapper übernehmen. |
| [docs/site/content/docs/browser/design-mode.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/browser/design-mode.mdx) | UX-Referenz für Element→Kontext→Feedback. |
| [src/main/runtime/browser-host/reconciliation/browser-host-page-reconciliation-orchestration.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/runtime/browser-host/reconciliation/browser-host-page-reconciliation-orchestration.ts) | Lifecycle-Referenz; Orcas Electron-/BrowserHost-Graph nicht kopieren. |

## 4. Aufgaben (Checkliste T39.m)

- [ ] **T39.1** Spike/ADR zu Engine, Worker, Streaming und Auth; Desktop/Pixel-Latenz und Lastbudget messen, explizites Go für vollständiges Browserpanel. **K1/K2/K7/K8**.
- [ ] **T39.2** Browser-/Test-/Artefakt-Contracts, isolierte Contexts und registrierte Ziel-/Aktionsgrenzen; Redirect-/Cookie-/CDP-/Origin-Negativtests. **K5/K7**.
- [ ] **T39.3** PWA-Panel/Popout mit URL, Reload/Zurück, Viewport, Input, Screenshot und sichtbarer Kontext-/Hostzuordnung bauen. **K1/K2/K10**.
- [ ] **T39.4** Registrierte Testjobs, Assertions, Status und Trace-/Console-Artefakte plus Abbruch/Quotas implementieren. **K3/K5/K7/K8**.
- [ ] **T39.5** DOM-/Style-/Ausschnitt-Auswahl mit Maskierung und manueller Feedbackvorschau über P36; ShadowDOM/Frames/fehlende Source-Map sichtbar behandeln. **K3/K5**.
- [ ] **T39.6** Recovery ohne Eingabe-Replay, Ownership-Cleanup und Agentenoperationen über bestehende Gateway-Policy prüfen. **K4/K7/K8**.
- [ ] **T39.7** `e2e/specs/browser-workspace.spec.ts` und `browser-feedback.spec.ts`: echte Scratch-Webapp/Chromium, Mobilansicht, Fehler, Restart, parallele Contexts; Gate/PWA-Build/Lastmessung. **K1/K2/K5/K7/K8/K10**.

## 5. Acceptance Criteria (AC-P39-k)

- **AC-P39-1:** Nutzer kann eine Scratch-Webapp innerhalb der PWA sehen, navigieren und bedienen; Desktop/Pixel und Authpfad sind real belegt.
- **AC-P39-2:** Zwei Sessions haben getrennte Cookies/Storage/Artefakte; fremder Session-Context/CDP ist nicht erreichbar.
- **AC-P39-3:** Echter Testfall meldet bestanden bei erfüllter Assertion und fehlgeschlagen bei Gegenprobe; mobile Viewport ist ausdrücklich kein Gerätesimulator.
- **AC-P39-4:** Design-Auswahl liefert nach menschlicher Vorschau Screenshot/Selector/Styles aus dem gewählten Kontext; Secrets werden nicht exportiert.
- **AC-P39-5:** Abbruch/Crash wiederholt keine Eingabe; Teststatus, Fehler und vorhandene Artefakte bleiben nachvollziehbar.
- **AC-P39-6:** Browser-Last hält K1/K2/K7/K8-Budgets ein; Frames/Traces landen nie als große Events im Stream.

## 6. Premortem (Failure-Modi + Mitigation)

1. PWA wird mit iframe-Browser verwechselt → echte Host-Engine und Frame/Input-Spike vor Produktausbau.
2. Chromium liest Hub/Admin/LAN-Secrets → begrenzte Origins, Netzwerk-/Redirectprüfung und getrenntes Profil.
3. Video/Trace flutet Stream → getrennte Binärübertragung/Blobs und feste Quotas.
4. Crash wiederholt Form-Submit → keine automatische Aktionswiederholung, unknown statt erfundenem Erfolg.
5. Tests und Mensch bedienen gleichzeitig → belegter Context-Eigentümer je Operation, separate Testcontexts.

## 7. Definition of Done

Alle T39.* und AC-P39-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.
