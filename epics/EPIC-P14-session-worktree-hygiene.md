# EPIC-P14 — Session-Worktree-Hygiene (Archivieren räumt saubere Worktrees auf)

**Status:** abgeschlossen mit einem Rest in [EPIC-P35 Endabnahme-Block](EPIC-P35-harness-paritaet-fortsetzen-provider.md): produktiver `prune --apply` (Entscheidung Jan, löscht Daten) → T35.15; Code seit 2026-10-08 fertig · **Phase:** P14 · **Dauer:** 0,5 Agenten-Wochen · **Abhängigkeit:** fachlich keine (BUG-0027 ist behoben, `WorktreeManager.hasWork()` existiert). Läuft neben der blockierten P12; T12.5 (24-h-Dauerlauf) profitiert davon, setzt es aber nicht formal voraus.

Auslöser: Statusreport vom 2026-10-08. `data/worktrees/` hält 24 Verzeichnisse
(309 MB).

## 1. Ziel

Worktrees ohne Arbeit liegen nicht dauerhaft herum — und Arbeit geht dabei nie
verloren. Wer sehen will, was auf der Platte liegt, bekommt es per `hubctl`
angezeigt und kann Sauberes gezielt entfernen.

**Messbefund (read-only gegen `data/hub.db`, 2026-10-08):** von 24 Worktree-
Verzeichnissen gehören 22 zu **archivierten** Sessions (18 `idle`, 2 `stopped`,
2 `waiting_approval`), 2 zu aktiven `idle`-Sessions. Der Aufräumpfad hängt nur
an `SessionManager.stop()` (`session-manager.ts:991`, `:1027`) und am
Orphan-Reaper (`WorktreeManager.reapOrphans`, nur ohne Session-Zeile). Eine
Session, die archiviert statt gestoppt wird, behält ihren Worktree für immer
(`setArchived`, `session-manager.ts:295`, berührt den Worktree nicht).
Per `git status` und `rev-list <worktreeSha>..HEAD` über alle 24 Verzeichnisse:
**20 sauber, 4 mit uncommitteten Änderungen (alle 4 archiviert, 2 davon
`stopped` — dort hat BUG-0027 die Arbeit bewusst behalten), keiner mit Commits
vor seinem Basis-SHA.** Die 4 sind Arbeit, die **nie** automatisch verschwinden
darf. Die Verzeichnisse hängen an vier Repos (`--git-common-dir`): 15 `AncientVoid`,
7 `securesight-harnez`, je 1 `harnez_test_moorhuhn-harness` und
`tetris-reloaded`.

## 2. Scope (In / Out)

**In:**
- `setArchived(true)` entfernt den Worktree, wenn `hasWork()` false ist; mit
  Arbeit bleibt er und die Session meldet `session.worktree_kept` (Muster aus
  BUG-0027).
- `hubctl worktrees`: Liste mit Session-Status, archiviert, Größe, Zustand
  (`clean` / `dirty` / `ahead`).
- `hubctl worktrees prune`: Trockenlauf als Standard; `--apply` entfernt nur
  **saubere** Worktrees archivierter oder gestoppter Sessions.
- Runbook-Abschnitt in `docs/operations-runbook.md`.

**Out:** automatisches Löschen von Worktrees mit Arbeit; Zeit-Retention
(„älter als N Tage“) — erst nach Messung; Änderungen am Adapter-/Event-
Contract; PWA-Oberfläche (reine CLI/Operator-Funktion).

## 3. Design-Details

- **Eine Wahrheit für „hat Arbeit“:** `WorktreeManager.hasWork()` (uncommittete
  Dateien oder Commits seit `worktreeSha`). Archivieren und Prune benutzen
  dieselbe Prüfung wie `stop()`; keine zweite Heuristik.
- **Reversibel, solange keine Arbeit existiert:** Beim Weiterführen legt der
  Hub einen fehlenden Worktree neu an (`session-manager.ts` um `:636`,
  `worktrees.create`), Basis ist dann der **aktuelle** Projekt-HEAD, nicht mehr
  der alte `worktreeSha`. Ohne Arbeit geht dabei nichts verloren, nur der
  Ausgangspunkt wandert mit.
- **`setArchived` ist synchron, das Entfernen asynchron.** T14.1 muss die
  Signatur bzw. den Aufrufer (Route) anpassen oder das Aufräumen nach dem
  Persistieren anstoßen — das Archivieren selbst darf nie am Aufräumen scheitern.
- **Fail loud (Regel 6):** schlägt die Prüfung oder das Entfernen fehl, bleibt der
  Worktree und ein Event `session.worktree_cleanup_failed` nennt den Grund.
- **K7:** Der Worktree ist keine State-Quelle (Zustand kommt aus JSONL +
  Snapshot); Entfernen ändert den Recovery-Pfad nicht. Nur `worktreeSha` im
  Record bleibt erhalten.
- **hubctl-Prune** liest dieselbe DB wie der Hub und greift nur über
  `WorktreeManager`, nie per `rm -rf`. Es arbeitet **pro `record.project`**,
  weil die Worktrees an mehreren Repos hängen (§1); `git worktree remove` und
  `branch -D` laufen im jeweiligen Projekt-Repo.

## 4. Aufgaben

- [x] **T14.1 — Archivieren räumt saubere Worktrees auf.** `SessionManager.archive()` (Route nutzt es) räumt nur, wenn die Session zwischen zwei Zügen steht (`idle`/`stopped`/`error`/`parked`), **kein langlebiger Worker** den Worktree als cwd hat (`persistentWorker`, ACP/app-server) und `hasWork()` false ist; sonst bleibt er und `session.worktree_kept` nennt den Grund (`running`/`worker`/`work`). Vor jedem Prompt stellt `ensureWorkdir()` einen fehlenden Worktree wieder her (gleicher Pfad, `ctx.workdir` bleibt gültig). Zwei Integrationstests mit echtem git. K7.
  - **Folge für die Zahlen aus §1:** 12 der 22 archivierten Sessions sind ACP-/Cursor-Adapter (langlebiger Worker) und bleiben bei T14.1 stehen — sie räumt T14.3, sobald kein Prozess mehr im Verzeichnis steht.
- [x] **T14.2 — `hubctl worktrees` (Liste).** Lokal wie `workers`, liest `--db <hub.db>`; je Worktree Session-Status, archiviert, Zustand (`clean`/`work`/`unknown`), Größe, ob ein Prozess seinen cwd darin hat (`/proc`), und ob er entfernbar ist. Logik in `packages/core/src/modules/workspace/worktree-hygiene.ts` (`scanWorktrees`), Tests dort und in `apps/hubctl/test/worktrees.test.ts`. K8.
- [x] **T14.3 — `hubctl worktrees prune`.** Trockenlauf als Standard, `--apply` entfernt nur Worktrees mit Zustand `clean`, ohne Prozess im Verzeichnis, von Sessions die archiviert oder `stopped`/`error` sind und nicht laufen. Vor jedem Entfernen erneute `hasWork`-/Prozess-Prüfung (Spätschreiber). Ersetzt die in T14.1 offene Lücke für Sessions mit persistentem Worker: ihr Prozess ist am cwd erkennbar, auch über Hub-Neustarts. K7.
- [x] **T14.4 — Doku und Abschluss.** Runbook-Abschnitt „Session-Worktrees aufräumen“, P12-Checkliste verlinkt das Epic, `epics/README.md` aktualisiert, Abschlussreport unten.

## 5. Acceptance Criteria

- **AC-P14-1:** Archivieren einer Session mit sauberem Worktree entfernt ihn; ohne Fix ist der Test rot.
- **AC-P14-2:** Archivieren mit uncommitteter Datei **oder** Commit lässt Worktree und Branch unverändert und meldet `session.worktree_kept`.
- **AC-P14-3:** `hubctl worktrees prune` ohne `--apply` ändert nichts auf der Platte (Test prüft Verzeichnisliste vorher/nachher).
- **AC-P14-4:** `prune --apply` entfernt keinen Worktree mit Arbeit und keinen einer laufenden Session.
- **AC-P14-5 (erfüllt 2026-10-08, Trockenlauf/Liste, nichts entfernt):** `hubctl worktrees --db data/hub.db` zeigt 24 Worktrees (249 MiB nach `du -sb`), 20 `clean`, 4 `work` (alle archiviert), 8 mit aktivem Prozess, 11 entfernbar (59,6 MiB). Damit deckt sich die Liste mit §1.
- *(ursprüngliche Formulierung)* **AC-P14-5:** Gegen den echten Datadir (Trockenlauf) zeigt `hubctl worktrees` dieselben Zahlen wie der Messbefund in §1.

## 6. Premortem

1. **Arbeit geht verloren (schlimmster Fall).** Mitigation: nur über `hasWork()`; Tests für uncommitted/Commit/sauber; `prune` standardmäßig Trockenlauf; Fehler im Check = nichts löschen.
2. **Un-Archivieren trifft fehlenden Worktree.** Mitigation: bestehender Pfad legt frisch an (`session-manager.ts` um `:636`); Test „archivieren → un-archivieren → Weiter“ in T14.1.
3. **Race: Archivieren während ein Zug läuft.** Mitigation: nur Sessions ohne laufenden Zug räumen; sonst `session.worktree_kept` mit Grund `running`.
4. **Agent legt nach Archivieren noch Dateien ab (Spätschreiber).** Mitigation: `remove` nutzt `git worktree remove` **ohne** `--force` im neuen Pfad; eine nicht-saubere Prüfung bricht ab und behält den Worktree.
5. **Messbefund veraltet bis zur Umsetzung.** Mitigation: AC-P14-5 vergleicht gegen den dann aktuellen Datadir, nicht gegen die Zahlen aus §1.

## 7. Definition of Done

- Tests + Lint + Typecheck grün; `npm run gate` grün (Pipeline-Job `e2e` nur lokal belegbar, CI-Quota — siehe `docs/testing-e2e.md`).
- Neue Logik in `packages/core/src/modules/workspace/` bzw. `modules/sessions/`, hubctl-Befehl in `apps/hubctl/`; `npm run check:arch` grün.
- Kein Contract-Bruch: das neue Event ist additiv; falls der Event-Contract es verlangt, ADR in `docs/adr/`.
- Erreichbarkeit: `hubctl worktrees` in `hubctl --help` und im Runbook.
- Kein TODO ohne Epic-Referenz.

## 8. Abschlussreport (2026-10-08)

| AC | Beleg |
|---|---|
| AC-P14-1 | `session-manager.test.ts` „EPIC-P14 T14.1“ — rot ohne `archive()` (`manager.archive is not a function`), grün mit Fix |
| AC-P14-2 | derselbe Test: uncommittete Datei und Commit lassen Worktree stehen, Event `session.worktree_kept` mit `reason`; zweiter Test: `reason: "worker"` |
| AC-P14-3 | `worktree-hygiene.test.ts` (Trockenlauf: alle sechs Verzeichnisse danach noch da) und `hubctl/test/worktrees.test.ts` |
| AC-P14-4 | `worktree-hygiene.test.ts`: Arbeit, Prozess im Verzeichnis, laufende und nicht archivierte Session bleiben; Re-Check kurz vor dem Entfernen |
| AC-P14-5 | Liste gegen den echten Datadir, siehe oben |

**Ehrliche Lücken:**
- `prune --apply` wurde gegen die Produktivdaten **nicht** ausgeführt: 11 Worktrees (59,6 MiB) wären entfernbar. Das löscht Verzeichnisse und Branches und braucht deine ausdrückliche Freigabe.
- `/proc` gibt es nur unter Linux; ohne `/proc` meldet `cwdInside` „in Benutzung“ (nichts wird entfernt).
- Nicht archivierte `idle`-Sessions räumt nichts auf, bewusst: der Nutzer kann sie jederzeit fortsetzen.
- Neuer Worktree nach Entfernen basiert auf dem aktuellen Projekt-HEAD, nicht auf dem alten Basis-SHA.
- Kein neuer E2E-Spec: Archivieren hat dieselbe UI wie bisher (bestehender Spec `workspace.spec.ts` läuft grün), `hubctl` ist reine CLI.
