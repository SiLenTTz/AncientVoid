# EPIC-P2 — Diff-Ansicht, Approval-Gates, Budgets, Messlatten im CI

**Status:** offen · **Phase:** P2 · **Dauer:** 1 Agenten-Woche · **Abhängigkeit:** P1 grün

---

## 1. Ziel

Der Hub wird vom Monitoring-Tool zum Governance-Tool: Agenten arbeiten in isolierten
git worktrees, Diffs werden serverseitig strukturiert gerendert und mobil review-bar,
Approvals laufen über drei Klassen inkl. Biometrie, und Budgets parken Sessions hart.
Gleichzeitig werden die PRD-Messlatten K1–K5 als automatisierte CI-Gates verankert.

## 2. Scope

### In
- Worktree-Isolation pro Session (`git worktree add`), `base_sha`-Tracking
- Diff-Engine: `git diff <base_sha>` → strukturiertes JSON (Dateiliste, Hunks,
  Funktions-Anker), serverseitig gerendert, Hunk-Kompression (K3)
- Diff-UI (S3): unified am Handy, Querformat side-by-side, Commit-Grenzen als Abschnitte
- Approval-Klassen: read frei / write bestätigungspflichtig / destruktiv biometrisch +
  Begründungsfeld (WebAuthn-Passkey)
- Approval-Queue (S4): globaler Posteingang mit Begründung, Auswirkung, Risiko-Level, Timeout
- BudgetState-Enforcement: hartes Cap pro Session und pro Tag; Überschreitung → Session
  parked + Push, niemals still weiter
- Audit-Trail: jede Handy-Aktion als Event im Session-JSONL (wer-wann-was)
- CI-Gates: K1 (Approve-Latenz), K2 (Tail-Lag), K3 (Diff-Payload), K5 (Event-Größe) als
  automatisierte Tests

### Out
- Copilot-Permission-Prompt-Integration — P3 (hängt am copilot-Adapter)
- Sprach-gesteuerte Approvals („approviere das") — P3

## 3. Design-Details

### Diff-Pipeline
1. Agent committet (Commit-Policy: Adapter erzwingt Commits pro logischem Schritt,
   Commit-Message = Task-Referenz).
2. Hub berechnet `git diff <base_sha>..HEAD` serverseitig → JSON mit Hunks.
3. Payload > 50 KB → „nur geänderte Funktionen"-Modus (Funktionsgrenzen via ctags/regex-
   Heuristik) + Expand-on-Tap.
4. Handy rendert Hunk-Karten; Tap → Vollkontext; Querformat → side-by-side.

### Approval-Modell (adSCAILE-TTY-Lektion, modern übersetzt)
| Klasse | Beispiele | Gate |
|---|---|---|
| read | Suche, Diff ansehen, Tail lesen | frei |
| write | Session starten, Steer-Prompt, Commit | Tipp-Bestätigung mit Zusammenfassung (was, wo, Modell, Budget) |
| destruktiv | force-push, Datei löschen außerhalb Worktree, Deploy | WebAuthn-Biometrie + Pflicht-Begründung + Audit-Event |

Wichtig: Der Approve-Button schreibt einen **signierten Eintrag** (Device-Token-Signatur)
— ein Agent kann niemals „in Prosa" eine Freigabe simulieren.

### BudgetState
- Pro Session: `budget_usd`, Verbrauch aus K1-Kosten-Tracking (codex: eigene Tabelle,
  claude: nativ).
- Bei 80 %: Push-Warnung. Bei 100 %: `session.parked`, Fortsetzung nur nach explizitem
  Budget-Top-up (write-Klasse).
- Tages-Cap pro Rechner zusätzlich (Schutz vor Loop-Agents).

## 4. Aufgaben

- [x] **T2.1** Worktree-Manager in SessionManager (create/cleanup, Konflikt-Strategie,
  Disk-Quota pro Worktree). `packages/core/src/worktree.ts` — echtes
  `git worktree add -b uacc/<sessionId> <path> <baseSha>` gegen ein reales
  Test-Repo (kein Mock), Branch pro Session als Konflikt-Strategie
  (eindeutige Session-UUID → nie kollidierende Branch-/Verzeichnisnamen).
  In `SessionManager.create()`/`stop()` verdrahtet: `AdapterContext.workdir`
  und `spawnWorker`'s `cwd` zeigen ab jetzt auf den Worktree-Pfad, nicht
  mehr auf `record.project` direkt; `record.worktreeSha` wird mit der
  echten HEAD-sha befüllt. Nicht-Git-Projekte (z. B. alle bisherigen
  Dummy-Tests) sind ein **ehrlicher, sichtbarer Fallback**
  (`session.no_worktree_isolation`-Event), kein stiller Bruch — bestehende
  167 Tests bleiben grün, weil `worktrees` ein optionaler Konstruktor-
  Parameter ist (Default: altes Verhalten). K7-Recovery rekonstruiert den
  deterministischen Worktree-Pfad (`WorktreeManager.pathFor`) statt neu
  anzulegen. **Disk-Quota ehrlich als Soft-Check umgesetzt**, nicht als
  OS-Quota: `du -sb` + `exceedsQuota(path, maxBytes)` — diese Umgebung hat
  keine xfs/btrfs-Projekt-Quotas ohne root, ein hartes Filesystem-Cap ist
  hier nicht erreichbar; das ist im Code-Kommentar so benannt, nicht
  stillschweigend als „Quota" verkauft. 9 neue Tests (7 in
  `packages/core/test/worktree.test.ts` gegen ein echtes Repo, 2 in
  `sessionmanager.test.ts` für die Verdrahtung inkl. echtem Cleanup-Beweis
  nach `stop()`), real im Hub verdrahtet (`packages/server/src/main.ts`).
  **Noch offen:** `exceedsQuota` wird aktuell nirgends periodisch
  aufgerufen (keine automatische Park-Aktion bei Überschreitung) — die
  Prüfung existiert und ist getestet, ist aber nicht in einen
  Hintergrund-Task eingehängt.
- [x] **T2.2** Diff-Engine + Funktions-Anker-Heuristik + K3-Kompression mit Fallback.
  `packages/server/src/diff.ts` real erweitert: diffed jetzt gegen den
  echten `worktreeSha` (T2.1) statt immer nur gegen `HEAD` — echte
  Route (`GET /api/sessions/:id/diff`) nutzt `sessions.workdirOf(id)` +
  `session.worktreeSha`, nicht mehr `session.project` direkt (sonst hätte
  T2.1s Isolation die Diff-Anzeige stillschweigend leer gemacht — real
  gefundene Regression, in derselben Änderung mitbehoben). Strukturierte
  Hunks pro Datei mit **Funktions-Anker aus gits eigener, echter
  Funcname-Heuristik** (Text nach dem zweiten `@@`), bewusst kein
  eigener ctags-/Regex-Parser — echt gegen git-Verhalten getestet (auch
  ein realer Fallstrick dabei entdeckt: dieser Rechner nutzt `c/`/`w/`
  statt `a/`/`b/`-Diff-Präfixe, ein präfix-ratender Parser wäre kaputt
  gewesen). K3: Payload > 50 KB kollabiert Hunk-Bodies auf eine 3-Zeilen-
  Vorschau (`collapsed: true`), neue Route
  `GET /api/sessions/:id/diff/hunk?path=…` liefert den vollen Hunk fürs
  Expand-on-Tap (`getSessionFileHunks`). 11 Tests
  (`packages/server/test/diff.test.ts`, alle gegen echte Git-Repos, u. a.
  ein echter > 50 KB-Diff, der das Kollabieren real auslöst). PWA-Typen
  (`packages/pwa/src/api.ts`) um `DiffHunk`/`baseRef`/`sessionDiffHunk()`
  erweitert — die tatsächliche Hunk-Karten-UI ist T2.3.
- [x] **T2.3** Diff-UI (S3): Hunk-Karten, Tap-Expand, Querformat side-by-side.
  Baut auf dem rohen Diff-Reiter aus P1.6 (T1.6-5) auf, ersetzt ihn durch
  echte Hunk-Karten pro Datei (`packages/pwa/src/SessionTail.tsx`,
  `HunkCard`/`DiffPane`) — Funktions-Anker aus T2.2 sichtbar im
  Karten-Header, kollabierte Hunks zeigen einen „ganzer Hunk"-Button, der
  `GET /api/sessions/:id/diff/hunk` real nachlädt. Querformat side-by-side:
  reines CSS (`@media (orientation: landscape) and (min-width: 640px)`),
  unified-Diff clientseitig in Links/Rechts-Zeilenpaare zerlegt
  (`pairHunkLines`, klassisches Lauf-Paarungsverfahren: aufeinanderfolgende
  `-`-Zeilen gegen aufeinanderfolgende `+`-Zeilen index-weise gepaart).
  Hält sich an bestehende Design-Tokens (`--ok`/`--err`/`--bg-elev`/
  `--radius` etc.) statt neuer Hex-Werte. **Live gegen den echten Hub
  verifiziert** (Playwright, kein Mock): echte Session mit einem > 50 KB-
  Diff in einem echten T2.1-Worktree erzeugt, Screenshots zeigen (1) den
  kollabierten Hunk im Portrait-Modus, (2) den vollständig geladenen Hunk
  nach Tap auf „ganzer Hunk", (3) denselben Hunk im Querformat als echtes
  Zwei-Spalten-Layout (rot/grün korrekt Seite an Seite). Kein PWA-eigenes
  Test-Framework eingeführt — diese Repo-Konvention verifiziert PWA-
  Änderungen bisher durchgängig per Playwright-Live-Check, nicht per
  Unit-Test (siehe z. B. T1.6-8s Glow-Verifikation).
- [x] **T2.4** Approval-Service: Klassen-Engine, Signatur, Timeout-Handling (Timeout =
  Reject, fail-closed), Begründungs-Pflicht-Validierung. Neuer Contract
  `packages/contracts/src/approval.ts` (ADR-0007), `ApprovalService`
  (`packages/core/src/approvals.ts`) + `approvals`-Tabelle (Migration 4).
  Signatur ist real, nur ehrlich eingeschränkt: `HMAC-SHA256(roher
  Device-Token, kanonisches Entscheidungs-Payload)` statt eines
  Bool-Flags — der rohe Token existiert nur im Request-Speicher des
  Decide-Aufrufs, nie persistiert (siehe ADR-0007 für die Begründung,
  warum das kein Behelfs-Downgrade ist). `destructive`-Entscheidungen
  werden **hart verweigert** (nicht simuliert), bis T2.5 eine echte
  WebAuthn-Assertion liefert. Timeout ist strukturell fail-closed: jeder
  Lesezugriff löst einen überfälligen `pending`-Eintrag zuerst in
  `timed_out` auf, bevor er zurückgegeben wird — kein Hintergrund-Timer
  nötig, kein Fenster, in dem „eigentlich abgelaufen" noch als "pending"
  sichtbar wäre. Real verdrahtet in `SessionManager.steer()`: ein
  `kind: "prompt"`-Steer wird bei konfiguriertem `ApprovalService` als
  `write`-Approval geparkt statt sofort weitergeleitet;
  `applyApprovedSteer()` leitet ihn erst nach echter Genehmigung weiter
  (von der Decide-Route aufgerufen). **Opt-in** über
  `hub.config.json`s neues `requireStepApprovals` (Default `false`) —
  die Queue/Routen sind immer real erreichbar, aber das Gate selbst
  ändert die Kern-Chat-Interaktion jeder bestehenden Session, deshalb
  bewusst kein stiller Default-Wechsel (gleiche Begründung wie T2.1s
  optionaler `worktrees`-Parameter). 11 Tests
  (`packages/core/test/approvals.test.ts`) + 5 reale Server-Tests
  (`packages/server/test/server.test.ts`, echter Ende-zu-Ende-Fluss:
  Steer geparkt → Queue zeigt Eintrag → Freigabe mit echter Signatur →
  Adapter empfängt den Prompt wirklich erst danach; Ablehnung verworfen;
  destruktiv 422).
- [x] **T2.5** WebAuthn-Registrierung + Gate-UI am Handy (Biometrie-Prompt).
  Server nutzt `@simplewebauthn/server` (nicht selbst gebaute CBOR/COSE/
  Signatur-Prüfung — bei Krypto-Korrektheit ist eine etablierte,
  geprüfte Bibliothek die richtige Wahl, kein Bastel-Risiko). Neue
  Tabellen `webauthn_credentials`/`webauthn_challenges` (Migration 5),
  `WebAuthnStore` (`packages/core/src/webauthn-store.ts`, reine
  Persistenz) + `packages/server/src/webauthn.ts` (die eigentliche
  Registrierungs-/Assertion-Prüfung, rpId/Origin aus `HubConfig.webauthn`
  — Defaults sind ausdrücklich nur für `localhost`, eine echte
  Tailscale-Bereitstellung **muss** `rpId`/`origin` auf den echten
  MagicDNS-Hostnamen setzen, sonst schlägt jede echte Prüfung fehl (das
  ist WebAuthns Phishing-Schutz, keine Formalität). Neue Routen:
  `GET /api/webauthn/status`, `POST /api/webauthn/register/{options,verify}`,
  `POST /api/approvals/:id/webauthn/{assert-options,decide}` — alle
  optional (501 ohne Konfiguration, wie T2.4s Approval-Routen).
  `ApprovalService.decideBiometric()` ist der **einzige** Pfad, der eine
  `destructive`-Freigabe tatsächlich erteilen kann; er verifiziert selbst
  nichts kryptographisch, sondern verweigert nur die falsche Klasse — die
  echte Prüfung ist bereits in der Route passiert, bevor er aufgerufen
  wird. PWA: „Passkey registrieren" in Einstellungen
  (`@simplewebauthn/browser`s `startRegistration`), „🔒 Mit Passkey
  freigeben" auf der destruktiven Queue-Karte (`startAuthentication`) —
  ersetzt den bisherigen Hinweistext aus T2.6.
  **Live gegen den echten Hub mit echtem Chromium-WebAuthn-Stack
  verifiziert** (Playwright + CDP `WebAuthn.addVirtualAuthenticator` —
  ein echter virtueller Authenticator in Chromium selbst, kein
  JS-Level-Mock): Passkey real registriert, eine echte destruktive
  Freigabe (direkt gegen dieselbe SQLite-Datei angelegt, da noch keine
  Route eine destruktive Aktion auslöst) über die echte Biometrie-
  Zeremonie auf `approved` gebracht, inkl. echtem Signatur-Fingerabdruck
  und Begründung — per `GET /api/approvals/:id` gegengeprüft, nicht nur
  am Screenshot behauptet. Dabei einen echten Client-Bug gefunden und
  behoben: Fastifys JSON-Body-Parser lehnt einen leeren Body bei
  gesetztem `content-type: application/json` ab (`FST_ERR_CTP_EMPTY_
  JSON_BODY`) — die beiden Options-Routen ohne Payload senden jetzt
  explizit `"{}"`.
  **Ehrlich unproven bleibt automatisiert:** die eigentliche Krypto-
  Zeremonie (Attestation/Assertion) lässt sich nicht sinnvoll in einem
  reinen vitest-Unittest ohne echten Browser/Authenticator abbilden, ohne
  Krypto-Bytes zu erfinden — genau das vermeidet diese Session konsequent.
  3 neue vitest-Tests decken das ab, was ohne echte Zeremonie ehrlich
  prüfbar ist (Options-Form, „kein Credential registriert"-Verweigerung,
  Status-Endpunkt); die eigentliche Ende-zu-Ende-Kryptoprüfung ist die
  Playwright-Live-Verifikation oben, nicht Teil der CI-Testsuite.
- [x] **T2.6** Approval-Queue (S4) mit Zeit-schleifen-Gruppierung und Risiko-Badges.
  `packages/pwa/src/Approvals.tsx` (`ApprovalQueuePane`) — neue Seite
  (`Page = "approvals"`), erreichbar über ein Banner auf dem Dashboard
  (`N Freigabe(n) warten auf dich`), **nicht** über einen fünften
  Dock-Slot (die vier Dock-Plätze entsprechen exakt dem T1.6-Mockup,
  EPIC-P2 hat nie einen fünften verlangt). Zeit-Gruppierung: „Wartet auf
  dich" (pending, mit Live-Countdown bis Timeout) / „Kürzlich
  entschieden" (< 10 Min) / „Älter". Risiko-Badges nach Klasse
  (Bestätigung=warn-Farbe, destruktiv=err-Farbe + Hinweistext „erfordert
  WebAuthn, noch nicht verfügbar" statt eines Buttons, der ohnehin immer
  422 zurückgäbe). Begründungsfeld erscheint nur, wenn
  `reasonRequired` real gesetzt ist; „Freigeben" bleibt disabled, bis
  eine Begründung eingetragen ist. **Live gegen den echten Hub mit
  `requireStepApprovals: true` verifiziert** (Playwright, kein Mock):
  Screenshot zeigt das echte Banner, die echte Queue-Karte mit
  Countdown, und nach Tap auf „Freigeben" den echten „approved"-Zustand
  mit Geräte-Label und Signatur-Häkchen — sowie über die Events-API
  bestätigt, dass der Prompt den Adapter erst nach diesem Klick
  tatsächlich erreicht hat.
- [x] **T2.7** BudgetState-Service + Park-Mechanik + Top-up-Flow + Tages-Cap.
  Real in `SessionManager` verdrahtet (kein separater Service nötig — die
  Logik gehört genau dorthin, wo `costUsd` ohnehin schon je Event
  akkumuliert wird, ADR-0003): `checkBudget()` warnt bei 80 % genau einmal
  (`session.budget_warning`) und parkt hart bei 100 %
  (`session.budget_exceeded` + echter `park()`-Aufruf, fail-closed — der
  Adapter bekommt danach wirklich keinen weiteren Aufruf mehr, nicht nur
  eine Statusanzeige). **Ehrlich markiert:** „Push-Warnung" aus dem
  Design-Dokument ist real als sichtbares System-Event umgesetzt, **nicht**
  als echter Mobile-Push — dieser Hub hat keine Push-Infrastruktur, das
  steht so im Code-Kommentar, nicht stillschweigend als erledigt geführt.
  Neues Feld `SessionRecord.parkReason` (ADR-0008,
  `"manual" | "budget" | "daily_cap"`) unterscheidet einen manuellen
  `park()` von einem automatischen — ein Top-up (`applyBudgetTopUp()`)
  setzt eine Session **nur** fort, wenn sie tatsächlich wegen Budget
  pausiert wurde, nie eine manuell geparkte (real getestet). Top-up-Flow
  ist die „Budget-Änderung"-write-Klasse aus T2.4: `POST
  /api/sessions/:id/budget` — ohne konfigurierten `ApprovalService` sofort
  angewendet, mit Service als Pflicht-Begründungs-Freigabe geparkt und
  erst nach echter Genehmigung angewendet (`applyApprovedBudgetTopUp`,
  dieselbe Route wie T2.4s Steer-Freigabe). Tages-Cap
  (`HubConfig.dailyCapUsd`) ist hub-weit über alle Sessions summiert
  (nicht pro Session) und parkt bei Überschreitung **jede** laufende
  Session, nicht nur die auslösende — echt getestet mit zwei Sessions,
  von denen eine nie selbst etwas ausgegeben hat.
  **Ein echter Async-Race beim Testen gefunden und dokumentiert** (kein
  Produktionsbug): `ctx.emit()` ist bewusst fire-and-forget, ein Test, der
  direkt nach `steer()` den Status abfragt, kann den noch laufenden
  Budget-Check verpassen — behoben durch Pollen (`waitFor`) statt
  sofortiger Assertion, wie an anderer Stelle in dieser Datei bereits
  etabliert.
  PWA: `BudgetTopUp`-Karte im Bericht-Tab, sichtbar nur bei
  `status === "parked" && parkReason === "budget"`. **Live gegen einen
  echten Hub verifiziert** (Playwright + eine echte kostentragende
  Test-Adapter-Instanz im selben Prozess wie ein echter Fastify-Server,
  da `hub.config.json`s registrierte Adapter keinen `cost:true` melden):
  echte Session real bei 100 % geparkt, echtes Top-up über die PWA
  ausgelöst, per direktem `GET /api/sessions/:id` bestätigt: `status`
  „working", `parkReason` `null`, `budgetUsd` verdoppelt.
  9 neue Tests (`packages/core/test/sessionmanager.test.ts`: Warnung,
  Auto-Park, Top-up-Selektivität, Tages-Cap; `packages/server/test/
  server.test.ts`: Route ohne/mit Approvals, Begründungspflicht).
- [ ] **T2.8** Audit-Events für alle Pfade (incl. verweigerter Aktionen)
- [ ] **T2.9** CI-Gate-Harness: K1 via Headless-Browser-Simulation, K3 via Fixture-Repo mit
  Riesen-Diff, K5 via Property-Test über alle Event-Typen
- [ ] **T2.10** Fail-closed-Review: jeder neue Code-Pfad, der externen State ändert, muss
  durch eine Klasse — Checkliste im PR-Template

## 5. Acceptance Criteria

- **AC-P2-1:** Session erzeugt 3 Commits in isoliertem Worktree → Diff-Ansicht zeigt 3
  Abschnitte, Basis ist exakt `base_sha`, Haupt-Repo bleibt unberührt.
- **AC-P2-2 (K3):** Diff mit 2 MB Änderungen → initiale Payload ≤ 50 KB, Expand liefert
  Rest korrekt nach.
- **AC-P2-3 (K1):** Biometrisches Approven eines force-push aus der Queue: Push →
  WebAuthn → Hub-Ack in < 5 s (95. Perzentil über 20 Messungen im Test).
- **AC-P2-4:** Budget-Cap 1 $, Agent erreicht es → Session parked automatisch, Push am
  Handy, kein weiterer Provider-Call (verifiziert via Mock-Billing).
- **AC-P2-5:** Destruktive Aktion ohne Begründung → 422 vom Server, kein Audit-Eintrag
  als „approved".
- **AC-P2-6:** Approval-Timeout (60 s konfigurierbar) → Reject, fail-closed, Push-Info.

## 6. Premortem

**Ende P2, gescheitert. Warum?**
1. *Funktions-Anker-Heuristik liefert Müll bei dynamischen Sprachen* → Diff-Ansicht
   unbrauchbar. Mitigation: Fallback = reine Hunk-Darstellung ist weiterhin nützlich;
   Heuristik ist Bonus, kein Gates-Kriterium.
2. *WebAuthn über Tailscale-PWA auf dem Ziel-Handy zickt* (Origin/RP-ID) → Mitigation:
   früher Smoke-Test auf echtem Gerät, nicht Emulator.
3. *Commit-Policy nervt Agents → sie umgehen sie* (große Sammel-Commits) → Mitigation:
   Adapter verweigert Session-Abschluss ohne Zwischen-Commits; Metric „Commits/Session"
   im Dashboard.
4. *Budget-Accounting für codex driftet* (eigene Preis-Tabelle veraltet) → Mitigation:
   Preis-Tabelle mit Datum + „unbekannt"-Fallback, niemals 0 anzeigen.

## 7. Definition of Done

Alle ACs + CI-Gates grün und blockierend + PR-Template mit Fail-closed-Checkliste aktiv +
Sicherheits-Walkthrough dokumentiert (Bedrohungsliste aus PRD §8 abgehakt).
