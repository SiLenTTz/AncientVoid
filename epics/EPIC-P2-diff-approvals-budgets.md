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
- [ ] **T2.2** Diff-Engine + Funktions-Anker-Heuristik + K3-Kompression mit Fallback
- [ ] **T2.3** Diff-UI (S3): Hunk-Karten, Tap-Expand, Querformat side-by-side.
  Baut auf dem rohen Diff-Reiter aus P1.6 (T1.6-5) auf und hält sich an
  [`docs/design-system.md`](../docs/design-system.md) statt neuer Hex-Werte.
- [ ] **T2.4** Approval-Service: Klassen-Engine, Signatur, Timeout-Handling (Timeout =
  Reject, fail-closed), Begründungs-Pflicht-Validierung
- [ ] **T2.5** WebAuthn-Registrierung + Gate-UI am Handy (Biometrie-Prompt)
- [ ] **T2.6** Approval-Queue (S4) mit Zeit-schleifen-Gruppierung und Risiko-Badges
- [ ] **T2.7** BudgetState-Service + Park-Mechanik + Top-up-Flow + Tages-Cap
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
