# EPIC-P14 — Session-Worktree-Hygiene (Archivieren räumt saubere Worktrees auf)

**Status:** offen (Planung 2026-10-08) · **Phase:** P14 · **Dauer:** 0,5 Agenten-Wochen · **Abhängigkeit:** fachlich keine (BUG-0027 ist behoben, `WorktreeManager.hasWork()` existiert). Läuft neben der blockierten P12; T12.5 (24-h-Dauerlauf) profitiert davon, setzt es aber nicht formal voraus.

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
darf. Die Verzeichnisse hängen an vier Repos (`--git-common-dir`): 15 `mobile-hub`,
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

- [ ] **T14.1 — Archivieren räumt saubere Worktrees auf.** `setArchived(true)` prüft `hasWork()`; ohne Arbeit `remove()`, mit Arbeit `session.worktree_kept`. Integrationstest mit echtem git (Vorbild BUG-0027: uncommitted, Commit, sauber). K7.
- [ ] **T14.2 — `hubctl worktrees` (Liste).** Zustand je Worktree, Größe, Session-Status. Unit-Test der Zustandsklassifikation + CLI-Test. K8 (Plattenbedarf bei 20 Sessions sichtbar).
- [ ] **T14.3 — `hubctl worktrees prune`.** Standard Trockenlauf, `--apply` nur saubere Worktrees nicht-aktiver Sessions; nie `dirty`/`ahead`. Test: mit Arbeit bleibt alles stehen. K7.
- [ ] **T14.4 — Doku und Abschluss.** Runbook-Abschnitt, `docs/p12-abnahme-checkliste.md` verlinkt dieses Epic, Retro-Eintrag, `epics/README.md` auf „abgeschlossen“.

## 5. Acceptance Criteria

- **AC-P14-1:** Archivieren einer Session mit sauberem Worktree entfernt ihn; ohne Fix ist der Test rot.
- **AC-P14-2:** Archivieren mit uncommitteter Datei **oder** Commit lässt Worktree und Branch unverändert und meldet `session.worktree_kept`.
- **AC-P14-3:** `hubctl worktrees prune` ohne `--apply` ändert nichts auf der Platte (Test prüft Verzeichnisliste vorher/nachher).
- **AC-P14-4:** `prune --apply` entfernt keinen Worktree mit Arbeit und keinen einer laufenden Session.
- **AC-P14-5:** Gegen den echten Datadir (Trockenlauf) zeigt `hubctl worktrees` dieselben Zahlen wie der Messbefund in §1.

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
