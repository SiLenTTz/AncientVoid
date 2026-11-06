# EPIC-P29 — Worktree-Workspaces mit Manifest, Setup und Services

**Status:** in Umsetzung — T29.1 abgeschlossen (06.11.2026), T29.2 wartet auf
Abnahme von ADR-0051 und Contracts · **Phase:** P29
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

- [x] **T29.1** Bestands-/P26-Abgleich, ADR, Manifest-/Status-/API-Verträge
  und Migrationsregel spezifizieren; Fixtures für altes Verhalten. **K5/K7**.
  *Abgeschlossen 06.11.2026:* [ADR-0051](../docs/adr/0051-workspace-manifest-runtime.md)
  (Manifest v1, Hash-Freigabe über Actor-Policy, Zustände, Ports/Ownership,
  K5/K7, Migrationsregel, P26-Regel), Contracts
  [`workspace/manifest.ts`](../packages/contracts/src/workspace/manifest.ts) +
  [`workspace/runtime.ts`](../packages/contracts/src/workspace/runtime.ts)
  (19 Tests), Fixture
  [`manifest-absent.test.ts`](../packages/core/test/modules/workspace/manifest-absent.test.ts)
  pinnt das alte Verhalten; Bestandsabgleich unten.
- [x] **T29.2** Manifest-Resolver + Hash-Freigabe + sichere Dateikopie bauen;
  Tests für fehlendes Manifest, ungültige Version, Symlink, Traversal,
  Secret-Redaktion und geänderten Hash. **K5/K7**, PRD §8.5.
  *Abgeschlossen 06.11.2026:* Resolver liest an der Basis-SHA
  ([`manifest-resolver.ts`](../packages/core/src/modules/workspace/manifest-resolver.ts),
  Arbeitsverzeichnis-Änderungen wirkungslos), Hash-Freigabe pro Projekt in
  SQLite-Tabelle `workspace_manifest_approvals` (Migration 27,
  [`manifest-approval.ts`](../packages/core/src/modules/workspace/manifest-approval.ts),
  Gate `gateManifest`), sichere Übernahme
  ([`include-copy.ts`](../packages/core/src/modules/workspace/include-copy.ts):
  reguläre+gitignorierte Dateien, kein Symlink/Traversal/`.git`/`data`, kein
  Überschreiben Verfolgter, Anzahl/Byte-Budget, Bericht ohne Inhalte). 16 neue
  Tests; Details unten.
- [x] **T29.3** Setup/Retry/Teardown als persistente Operationen integrieren;
  Timeout, Teilfehler, Crash vor/nach externem Effekt und manuelle
  Auflösung testen, kein blindes Re-Run. **K7/K8**.
  *Abgeschlossen 07.11.2026:* `WorkspaceRuntime`
  ([`workspace-runtime.ts`](../packages/core/src/modules/workspace/workspace-runtime.ts),
  Journal-Migration 28) führt Setup-Schritte sequenziell mit Frist aus
  (argv, kein Shell); Fehler nennen Schritt/Exitcode/Timeout + Log-Blob
  (K5). SessionManager: Gate nach Worktree-Anlage — Freigabe über die
  bestehende Approval-Queue (Operation `workspace.setup`, ADR-0019:
  höchstens einmal, Crash-Dispatch → uncertain), Setup vor dem Agenten
  (AC-P29-3), Guards gegen Prompts/Resume/Continue in unvorbereiteten
  Workspaces, Recovery faltet Phase aus Events (K7) und markiert hängen
  gebliebene Journalzeilen `needs_attention` (genau ein Event, idempotent,
  nie Auto-Re-Run). Retry nur menschlich. Teardown-Engine steht, Archiv-
  Anbindung folgt mit T29.5. 12 neue Tests; Details unten.
- [x] **T29.4** Service-Worker, Port-Vergabe/Readiness und begrenzte Logs;
  zwei echte Prozesse parallel, belegter Fixport, Bind-Race, fehlende
  Readiness und fremder Prozess als Negativfälle. **K2/K5/K8**.
  *Abgeschlossen 07.11.2026:* `ServiceSupervisor`
  ([`workspace-services.ts`](../packages/core/src/modules/workspace/workspace-services.ts),
  Tabelle `workspace_services`, Migration 29) startet detached Prozesse mit
  Datendatei-Logs und Umgebungsmarker; Auto-Port über Loopback-Vergabe mit
  Nachtest (begrenztes Retry), Fixport-Kollision = Fehler ohne jeden Kill;
  Readiness als HTTP-2xx/3xx-Sonde (ohne Pfad: am Leben nach Settle);
  Ownership = pid+argv+Marker über `/proc` — nicht Beweisbares wird nie
  angefasst. `workspace.ready` erst, wenn alle Dienste bereit (Services
  laufen in der Runtime-Operation zwischen Setup und ready). K7-Adoption:
  nach Neustart `probing`, Prüfung asynchron, Restore unblockiert. Stop auf
  session stop/delete (nur eigene); Logs als gekapzte Schwänze + Blob (K5).
  8 neue Tests mit echten Prozessen; Details unten.
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

## Umsetzung T29.1 — Bestandsabgleich und Verträge (06.11.2026)

### Vorgängercheck mit Code-/Test-Evidenz (vor T29.1, wie gefordert)

| Prüfling | Evidenz am Code (nicht Statuszeile) | Konsequenz für P29 |
|---|---|---|
| P28 grün | Retro mit 3 SHA-gebundenen Läufen am Stand `8895473`; Gate am aktuellen Trunk `69f834b` (test/lint/typecheck) im Zuge dieses Tasks grün gelaufen | Epic-Start freigegeben |
| P2/T2.1 WorktreeManager | `packages/core/src/modules/workspace/worktree.ts` (create/remove/hasWork/apply/Quota/Reap) + `worktree.test.ts`, `session-manager.test.ts` (T2.1-Test) | bleibt unangetastet; P29 hängt daran an |
| P14 Hygiene | `worktree-hygiene.ts` (prunable nur clean+ungenutzt+beendet), `worktree-hygiene.test.ts`, `apps/hubctl/test/worktrees.test.ts` | P14 bleibt letzte Löschbarriere; Archivierung läuft durch P14-Prüfungen |
| ADR-0016 Apply | `worktree.ts:apply()` + `worktree-apply.test.ts` | unverändert; ersetzt nicht den MR-Workflow |
| P19/P26-Integrationsstand | Guard `session-manager.ts:526` (`isLoopAdapter`/`workInProject`/`adoptsInPlace` → kein Worktree); `loops.test.ts` („loop works in its own project"), `factory.integration.test.ts` (Treiber-`worktreeSha` null), `factory.routes.ts` (Policy `factory.start`, nur Menschen) | Workspace-Setup nur an worktree-isolierten Sessions; Beobachter/Treiber lösen nie ein zweites Setup aus (ADR-0051 §8) |

### Gelieferte Verträge

- **ADR-0051** (vorgeschlagen; Abnahme vor T29.2): Manifest
  `ancientvoid.workspace.json` v1 strict, argv-Schritte mit Frist, Include als
  relative Liste, Services mit Fixport/`"auto"` + Readiness-Pfad; Lesen an
  der Basis-SHA; menschliche Hash-Freigabe über die Actor-Policy (ADR-0021);
  `needs_attention` statt blindem Re-Run (ADR-0019-Muster); Loopback-Bind,
  Ownership per pid+argv+`ANCIENTVOID_WORKSPACE_SESSION_ID` — Portnummer
  allein ist kein Eigentumsnachweis; Preview nur authentifiziert auf
  registrierte Services, bis zur Abnahme blockiert.
- **Contracts** `packages/contracts/src/workspace/{manifest,runtime}.ts`:
  Manifest-Schema (strict, Grenzen für argv/Timeouts/Ports/Anzahlen, Include-
  Pfadform ohne Traversal/Globs/`.git`/`data`), Zustands-/Event-Vertrag
  (`workspace.*`, K5-gekapselte `WorkspaceFailure` mit Log-Blob-Referenz),
  `WorkspaceStatus`/Ownership (K7-Faltung), Freigabe-Payload (strict, nie
  Dateiinhalte), API-Pfade (Status/Retry/Logs/Preview).
- **Migrationsregel (verbindlich):** keine Migration bestehender
  `data/worktrees/<sessionId>`; ohne Manifest gilt der T2.1-Pfad unverändert;
  bestehende Sessions erhalten keinen Workspace-Status.
- **Fixtures für altes Verhalten:**
  `packages/core/test/modules/workspace/manifest-absent.test.ts` — Git-Projekt
  ohne Manifest → Worktree wie seit T2.1, kein `workspace.*`-Event, Cleanup
  bei Stop; Nicht-Git-Projekt → `session.no_worktree_isolation` mit Grund.
  Die Fixture iteriert `WORKSPACE_EVENT_KINDS` und bleibt damit auch für
  später hinzugekommene Event-Kinds scharf (AC-P29-5).

### Ausstehend

T29.2 startet erst nach ausdrücklicher Abnahme von ADR-0051 und den Contracts
(DoD); die Feldnamen sind damit verbindlich, Änderungen nur additiv bzw. über
eine neue `schemaVersion`.

**Abnahme 06.11.2026 (Jan):** ADR-0051 und die Contracts sind ohne Änderungen
angenommen — T29.2 freigegeben.

### Umsetzung T29.2 — Resolver, Freigabe, Übernahme (06.11.2026)

- **Resolver** (`manifest-resolver.ts`): `git show <baseSha>:…` statt
  Arbeitsverzeichnis — nachträglich umgeschriebene Manifeste ändern das
  Verhalten laufender Workspaces nicht (Test pinnen das). Fehlendes Manifest
  = `{status:"none"}` (alter T2.1-Pfad, kein Fehler); ungültige Version,
  kaputtes JSON, unbekannte Felder, > 64 KiB = `invalid` mit gekappter
  Ursache (fail loud, K5-tauglich). Hash = sha256 des exakten Inhalts.
- **Hash-Freigabe** (`manifest-approval.ts` + Migration 27): Schlüssel
  `(project, manifestHash)` — gleicher Inhalt keine zweite Zustimmung,
  geänderter Hash genau eine neue (Tests: ohne Freigabe, mit Freigabe,
  geänderter Hash, anderes Projekt, Neustart-Persistenz). `gateManifest()`
  liefert `invalid | approval_required (Anzeige-Payload, nie Inhalte) | ok`;
  `approve()` ist ein von Route/Policy (Mensch, ADR-0021) aufrufbarer
  Baustein — kein Ereignis-Konsument, Agentenausgaben registrieren nichts.
- **Sichere Übernahme** (`include-copy.ts`): Pfadform aus dem Vertrag
  (Traversal/Globs/absolut/`.git`/`data`), lstat verlangt reguläre Datei,
  Symlinks abgelehnt, realpath-Kontainment verhindert Ausbrechen über
  Symlink-Verzeichnisse, verfolgte Worktree-Dateien werden nie überschrieben
  (Check vor der Ignore-Prüfung — Git meldet getrackte Dateien nie als
  „ignored", so nennt der Fund die schärfere Ursache), `git check-ignore`
  verlangt opt-in, Anzahl/Byte-Budget (256/32 MiB, überschreibbar im Test).
  Bericht führt Pfade+Bytes, nie Inhalte (Secret-Redaktion getestet, PRD §8.5).
- **Gefundene Git-Semantik** (für T29.3+ festgehalten): `git add -A`
  überspringt ignorierte Dateien (Fixtures müssen erzwingen), und getrackte
  Dateien gelten für `check-ignore` nie als ignoriert.

### Umsetzung T29.3 — persistente Setup-Operationen (06.–07.11.2026)

- **Engine** (`WorkspaceRuntime`, Journal-Tabelle `workspace_operations`,
  Migration 28): Reihenfolge fest verdrahtet — erst die dauerhafte
  `dispatching`-Marke, dann das Event, dann der Effekt. Fehler-Events
  tragen `WorkspaceFailure` (Schritt, exit/timeout, Exitcode, gekappter
  Ausgaben-Schwanz, Log-Blob-Referenz — K5). Teardown läuft als eigene
  Operation (`tearing_down` → `cleanup_failed`); Archiv-Anbindung T29.5.
- **Start-Flow** (`session-manager.ts`): mit Manifest an der Basis-SHA
  läuft Freigabe → Include-Kopie → Setup VOR dem Agentenstart; der Agent
  startet nie in einem unvorbereiteten Workspace (AC-P29-3). Freigabe über
  die bestehende Approval-Queue (write-Klasse, Aktion `workspace.setup`,
  24-h-Frist) mit Operationssatz inkl. Original-StartSpec — die Entscheidung
  setzt nach einem Hub-Crash sauber fort (ADR-0019-Catch-up führt eine
  genehmigte, nie gestartete Operation genau einmal aus). Include-Kopie
  schlägt komplett fehl (fail loud), wenn ein Eintrag abgelehnt wird.
- **Crash-Semantik (K7):** Recovery faltet die Workspace-Phase aus den
  Events (`foldWorkspaceState`) und markiert hängen gebliebene
  Journalzeilen `uncertain` + `workspace.needs_attention` — idempotent,
  nie Auto-Re-Run; der ADR-0019-Teil (Operation `dispatching` → uncertain)
  greift zusätzlich. Auf Manifest-Freigabe wartende Sessions bleiben nach
  Recovery steuerbar (kein „observed"), abgelehnte/abgelaufene Freigaben
  werden laut `workspace.failed`.
- **Guards:** Prompts (steer), natives Resume und Continue gestoppter
  Sessions verweigern bei Phase ≠ ready mit Grund; nach Worktree-Neuanlage
  (EPIC-P14-Prune/Archiv) läuft das genehmigte Setup erneut (gleicher Hash,
  Journal-Art `retry`), ein geändertes Manifest verlangt einen neuen Start.
  `retryWorkspaceSetup` nur nach `failed`/`needs_attention`, danach
  steuerbar (stopped), kein Fake-working.
- **Tests:** Engine (Erfolg, Exit, Timeout, Teilfehler, Teardown-Fehler,
  Journal, Crash-Idempotenz, Faltung) + Integration über den echten
  Freigabe-Pfad (decide → applyApproved): warten ohne Agent, Setup im
  Worktree + Include + Start erst bei ready, genau-einmal, Fehler + Retry
  mit menschlichem Fix, ungültiges Manifest ohne Freigabe-Anfrage,
  Hard-Kill mitten im Dispatch mit Recovery-Verifikation. Gates: 1239
  Unit-/Integrationstests (180 Dateien), E2E 299 passed / 2 skipped,
  typecheck/lint/check:arch grün (Lauf 07.11.2026).

### Umsetzung T29.4 — Services, Ports, Readiness (07.11.2026)

- **Lifecycle in einer Operation:** Include-Kopie, Setup-Schritte und
  Services laufen jetzt gemeinsam in der Runtime-Operation (Journal deckt
  auch Services); `workspace.ready` feuert erst, wenn alle deklarierten
  Dienste bereit sind — der Agent startet nie früher (AC-P29-3).
- **Supervisor** (`workspace-services.ts`, Migration 29): detached
  Prozesse, stdio in Datendatei-Logs (`data/services/<sid>/<svc>.log`),
  Umgebungsmarker `ANCIENTVOID_WORKSPACE_SESSION_ID` + Port-Übergabe über
  `ANCIENTVOID_WORKSPACE_PORT`. Auto-Port: Loopback-Bind-Vergabe mit
  Nachtest (3 Versuche); Fixport belegt → `service_failed {kind:"port"}`
  ohne jeden Kill. Readiness: HTTP 2xx/3xx-Poll bis Frist; ohne Pfad gilt
  „nach 500 ms noch am Leben" als bereit.
- **Ownership (ADR-0051 §4):** pid + argv + Marker, gelesen über `/proc`.
  Nicht nachweisbar eigen ⇒ nie adoptieren, nie stoppen (Linux-Only ehrlich:
  ohne `/proc` gibt es keine Adoption). K7-Restore: Zeile → `probing`,
  Prüfung asynchron, kein Blocken; Adoptions-Test mit echtem Server und
  zweitem Supervisor auf derselben DB.
- **Negativfälle alle echt getestet:** zwei parallele Dienste mit
  getrennten Ports und eigenen Antworten; belegter Fixport (fremder
  Listener bleibt unberührt und antwortet weiter); 404-Readiness →
  `timeout` mit Log-Blob und <4-KB-Event (K5); sofortiger Exit → `exit`;
  Ownership-Zeile auf fremden `sleep` → nie getötet.
- **Integration:** `stop()` und `delete()` beenden eigene Services, bevor
  der Worktree geprüft/entfernt wird (ihr cwd würde jede Entsorgung als
  „in Benutzung" blocken); `workspaceStatus()` liefert die K7-Projektion
  (Phase gefaltet, Service-Zeilen) — Route/Anzeige folgt in T29.6.
- Gates: 1247 Unit-/Integrationstests (181 Dateien), E2E komplett grün
  (299 passed / 2 skipped von 301 gesamt — ein erster Lauf zeigte 297 ohne
  Fehlschlag, vollständiger Zweitlauf mit korrekter Gesamtzahl grün),
  typecheck/lint/check:arch grün (Lauf 07.11.2026).
