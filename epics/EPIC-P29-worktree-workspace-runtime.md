# EPIC-P29 — Worktree-Workspaces mit Manifest, Setup und Services

**Status:** Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P29
**Dauer:** 3–5 Agenten-Wochen (ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P28-Exit-Kriterien grün; P2/P14/ADR-0016 sowie P19/P26-Integrationsstand geprüft.

Quelle: [Vergleichsanalyse vom 05.11.2026](../docs/2026-11-05_paseo-vs-ancientvoid.md), §5; [Planungsgrundlage und Quellen](../docs/2026-11-05_paseo-umsetzungsplanung.md).

**Planungsauftrag:** Der Nutzer hat am 05.11.2026 ausdrücklich detaillierte
Epics zu den Verbesserungen der Paseo-Analyse beauftragt. Das erlaubt diese
Planung vor grünen Vorgängern, aber keinen Implementierungsstart. Vor T*.1
Vorgänger-AC mit aktueller Code-/Test-Evidenz prüfen; historische Statuszeilen
reichen nicht. Keine neue Ausnahme von AGENTS.md durch diesen Entwurf.

## 1. Ziel

Zwei parallele Sessions desselben Projekts erhalten unabhängig nutzbare
Entwicklungsumgebungen: deklaratives Setup, ausgewählte lokale Dateien und
Services mit getrennten Ports. Vom Handy sind Bereitschaft, Fehler und
Service-Zugang sichtbar. Bestehende Session-Isolation wird erweitert.
Messlatten: K2/K5/K7/K8/K10; Diff-Übergabe bleibt K3-begrenzt.

## 2. Scope (In / Out)

**In:** versioniertes `ancientvoid.workspace.json`, explizite Dateiübernahme,
Setup/Teardown, verwaltete Services, Port-Zuordnung, Status/Logs in PWA und
hubctl, Recovery und sichere Archivierung. MVP bleibt ein Worktree pro Session.

**Out:** mehrere Sessions mit gemeinsam beschreibbarem Worktree, beliebige
Shell vom Handy, Editor/Terminal-Monolith, PR-Erstellung/Auto-Merge,
Container-Orchestrator, beliebige Port-Proxies oder fremde Port-Allocator-Skripte.
Keine Layout-Migration bestehender `data/worktrees/<sessionId>`.

## 3. Design-Details

### 3.1 Bestand und Einbauorte

`WorktreeManager` in `packages/core/src/modules/workspace/worktree.ts` erstellt
bereits Branch/Worktree, bestimmt Basis-SHA, übernimmt Arbeit und prüft Quota.
`worktree-hygiene.ts` schützt schmutzige, aktive und unklare Worktrees vor Prune.
`apps/hub/src/main.ts` verdrahtet den Manager. P14 und ADR-0016 bleiben zuständig
für Cleanup bzw. bestehende Übernahme. Deren lokale Merge-Funktion ist **kein**
Ersatz für den vorgeschriebenen MR-Workflow dieses Repos.

Geteilte Schemas unter `packages/contracts/src/workspace/`, Domäne im bestehenden
Workspace-Modul (nur `index.ts` öffentlich), Routen im Workspace-Routenmodul,
UI unter `apps/pwa/src/features/`. Prozesse über Worker-Abstraktion. ADR vor
Event-/Worker-/Adapter-Contract-Änderungen; kein Workspace-Zugriff aus Adaptern
auf Hub-Internas.

### 3.2 Manifest und Vertrauensgrenze

Entwurf v1: `schemaVersion`, `setup`/`teardown` als benannte argv-Schritte mit
Timeout, `include` als relative Dateiliste, `services` mit ID, argv, optionalem
Port und HTTP-Readiness-Pfad. Exakte Feldnamen per Contract-Task festlegen.
Manifest aus der gewählten, festgehaltenen Basis-SHA lesen; Änderungen daran
wechseln nicht unbemerkt das Verhalten aktiver Workspaces. Ohne Manifest bleibt
der bisherige Session-Start unverändert. Unbekannte Version/Felder fail loud.

Vor erster Ausführung bestätigt ein Mensch Projekt/Basis/Manifest-Hash und
Schritte über bestehende Actor-/Approval-Policy. Ein geänderter Hash braucht
neue Zustimmung. Agentenausgabe kann keine Schritte registrieren. Keine Shell-
Interpolation; Shell nur als explizit genehmigtes Programm mit Argumenten.

Include ist opt-in: nur reguläre, gitignorierte Dateien innerhalb des
Quellprojekts; keine Symlinks/Traversal/absoluten Pfade, keine `.git`/`data/`,
kein Überschreiben verfolgter Zieldateien. `.env` nur nach Dateifreigabe, Inhalt
nie im Event/Log. Kopieren vor Setup; Dateianzahl/Bytes begrenzen und testen.

### 3.3 Laufzeit und Ports

Zustände: preparing → ready oder failed; Archivierung separat mit
tearing_down → archived oder cleanup_failed. Start/Retry haben persistente
Operation-ID. Setup läuft sequenziell mit Frist/Exitcode, Services erst danach;
Agent erst bei ready. Keine unkontrollierten Wiederholungen von Setup nach Crash.
Unklarer Nebenwirkungszustand wird als Klärungsbedarf angezeigt.

Ports sind je Host vergeben; optionaler Fixport führt bei Belegung zu Fehler,
Auto-Port zu begrenztem Retry bei Bind-Race. Zuweisung persistieren, gestarteten
Prozess samt Ownership/Startmarker und Readiness prüfen. Portnummer allein ist
kein Eigentumsnachweis. Dienste binden an Loopback. Zugriff vom Handy nur über
eine authentifizierte Route auf genau den registrierten HTTP-Service, mit
Host-/Origin-Prüfung, WS-Upgrade-Regeln und Pfadbegrenzung; kein Open Proxy.
Falls das nicht sicher abnehmbar ist, bleibt mobiler Service-Zugang blockiert.

### 3.4 Recovery und Aufräumen

JSONL+Snapshot enthalten Basis-SHA, Manifest-Hash/Referenz, Phase,
Operation-ID, Service-Ownership und Ports. Blobs halten große Logs (K5).
K7 rekonstruiert Projektionen <3 s; Readiness-Probes laufen danach asynchron,
blockieren nicht den Session-Restore und markieren bis dahin „wird geprüft“.
Nur nachgewiesene eigene Prozesse adoptieren/stoppen; fremde Prozesse nie töten.
Archivieren stoppt Services, führt genehmigten Teardown aus und nutzt dann
P14-Prüfungen. Bei Dirty/Unknown/Teardown-Fehler bleibt Worktree mit Grund erhalten.
Factory-Beobachter dürfen kein zweites Setup im Projekt auslösen (P26).

## 4. Aufgaben (Checkliste T29.m)

- [ ] **T29.1** Bestands-/P26-Abgleich, ADR, Manifest-/Status-/API-Verträge
  und Migrationsregel spezifizieren; Fixtures für altes Verhalten. **K5/K7**.
- [ ] **T29.2** Manifest-Resolver + Hash-Freigabe + sichere Dateikopie bauen;
  Tests für fehlendes Manifest, ungültige Version, Symlink, Traversal,
  Secret-Redaktion und geänderten Hash. **K5/K7**, PRD §8.5.
- [ ] **T29.3** Setup/Retry/Teardown als persistente Operationen integrieren;
  Timeout, Teilfehler, Crash vor/nach externem Effekt und manuelle
  Auflösung testen, kein blindes Re-Run. **K7/K8**.
- [ ] **T29.4** Service-Worker, Port-Vergabe/Readiness und begrenzte Logs;
  zwei echte Prozesse parallel, belegter Fixport, Bind-Race, fehlende
  Readiness und fremder Prozess als Negativfälle. **K2/K5/K8**.
- [ ] **T29.5** Recovery + Archivierung mit P14 verbinden; Hard-Kill mit
  laufendem Service und dirty Worktree prüfen, keine fremden Prozesse
  beenden, keine neue Setup-Ausführung. **K7/K8**.
- [ ] **T29.6** Authentifizierten mobilen HTTP-Service-Zugang samt
  PWA-Status/Logs/Retry und hubctl-Befehlen liefern; Token/Origin/
  Pfad-/Host-Isolation sowie Offline-Zeitstempel testen. **K2/K5/K10**.
- [ ] **T29.7** `e2e/specs/workspace-runtime.spec.ts` für Start → bereit →
  Preview → Fehler → Retry → Neustart → Archivieren; manifestloser Start
  und P26-Beobachter als Regression. Last-/Restore-Messlauf. **K3/K7/K8/K10**.

## 5. Acceptance Criteria (AC-P29-k)

- **AC-P29-1:** Zwei Sessions eines Testprojekts zeigen unterschiedliche
  Worktrees, Ports und getrennte Dateiinhalte; beide Services liefern ihre
  eigene Workspace-ID über authentifizierte Handy-Route.
- **AC-P29-2:** Nicht genehmigtes/geändertes Manifest startet keinen Prozess;
  Negativfälle aus T29.2 verlassen nie die Projektwurzel und leaken keine Inhalte.
- **AC-P29-3:** Setup-/Servicefehler nennen Schritt, Exitcode/Timeout und
  Logreferenz; Agent startet nicht fälschlich als bereit. Fixport-Kollision
  beendet keinen fremden Dienst und ist in PWA/hubctl sichtbar.
- **AC-P29-4:** Hard-Kill/Restart rekonstruiert alle Workspace-Projektionen
  <3 s (K7); Probes danach, keine doppelten Services/Setups und kein Event >4 KB.
- **AC-P29-5:** Archivierung beendet eigene Dienste und entfernt nur saubere,
  ungenutzte Worktrees; unklare/dirty Daten bleiben auffindbar. Kein Manifest
  erhält das bisherige Verhalten, Factory-Beobachter keinen zweiten Runtime-Start.
- **AC-P29-6:** 20 Sessions × 30 Events/s ohne Eventverlust; Services/Logansicht
  verursachen keinen K2-Verstoß. K3-Diff-Fenster und K10-Offline weiterhin grün.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Repo liefert manipuliertes Setup:** Hash-Freigabe an Basis-SHA, Actor-Policy,
   kein automatischer Trust durch Agentenausgaben.
2. **Crash wiederholt Migration/Seed:** persistente Phasen, explizit unklarer
   Zustand und menschlicher Retry statt angeblicher Exactly-once-Shell.
3. **Port vom Nachbarprozess übernommen:** Readiness mit Ownership verknüpfen,
   begrenzt neu vergeben, keine Prozesssuche nur nach Port.
4. **Teardown löscht unübernommene Arbeit:** P14 bleibt letzte Löschbarriere;
   Fehlzustände und Worktree sichtbar behalten.
5. **Preview wird SSRF-/Auth-Bypass:** fest registrierte Loopback-Ziele,
   Auth/Origin/Pfad-Negativtests, kein freier URL-Parameter.

## 7. Definition of Done

Alle Aufgaben/AC nachgewiesen, ADR und Contracts vor Implementierung abgenommen.
`npm run gate`, PWA-Build und K8-Lasttest grün; Pipeline-Job `e2e` grün bzw.
Infrastrukturfehler gemäß AGENTS.md gesondert bewertet, nie als Pass.
Jede neue UI-Funktion/jeder Ablauf mit Spec in `e2e/specs/`, mobiler Live-Lauf
und Recovery-Probe dokumentiert. Manifest-Beispiel ohne Secrets, PWA-Einstieg,
hubctl-Hilfe und Konfig-Dokumentation erreichbar; keine alten Worktrees migriert.
