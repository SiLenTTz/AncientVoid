# EPIC-P72 — Skill-Pflege nach Runs: deterministisch, per Skript, ohne KI

**Status:** offen · **Phase:** P72 · **Dauer:** 1–1,5 Agenten-Wochen · **Abhängigkeit:** keine blockierende — Quer-Epic wie P58–P70; P70 (höchste umgesetzte Phase) ist grün (T70.1–T70.6, PR #172, `verify` grün). P71 (Issue-Lebenszyklus) liegt nur als Planung auf `docs/epic-p71-issue-lebenszyklus` und teilt keine Codeflächen. P68 (Skill-Vorschläge pflegen, ADR-0089) ist die PWA-/Prompt-Seite derselben Skills — P72 berührt deren Routen nicht. P30/P31 bleiben On hold und unberührt.

Quelle: Nutzerauftrag vom 18.11.2026 — „Ich möchte automatisch unsere Skills nach
Runs anpassen. So deterministisch wie möglich, z. B. mit Skripten, die man ohne KI
ausführen kann.“ Anlass: Ein zuvor gereichter „Skill Curator“-Prompt setzt
`trajectory.jsonl`, `task_result.json` und eine `regression_suite/` voraus — nichts
davon existiert im Repo; der Lauf endete zwangsläufig mit `NO_CHANGE`. Die Skills
unter `.claude/skills/` (16 Stück, 1 832 Zeilen) werden bisher nur von Hand gepflegt;
`check:context` prüft lediglich Zeilenbudgets.

## 1. Ziel

Nach jedem Agenten-Run entsteht **ohne Modellaufruf** ein Befund, ob die beteiligten
Skills eingehalten wurden, wo sie veraltet sind und welche Fehler sich über Runs
wiederholen. Daraus folgen nur zwei Sorten Änderung:

- **Deterministische Lektionen** (per Code prüfbar) werden zu **Regeln/Checks**
  (`skill-checks.json`, `check:skills`) — nie zu Prompt-Text.
- **Probabilistische Lektionen** (brauchen Urteil/Sprache) werden zu einem
  **Vorschlag mit Beleg** (Run-IDs, ≤ 5 Zeilen Auszug) — den Text schreibt ein Mensch
  oder ein Agent bewusst, das Skript generiert keinen Skill-Text.

Jede angenommene Lektion bringt einen **Regressionsfall** mit; eine Regel ohne Fall
ist ein Gate-Fehler. Alles läuft als `node scripts/…`-Kommandos, offline, idempotent.

## 2. Scope (In / Out)

**In**

- **Run-Extraktor:** liest `data/sessions/<id>/events.jsonl` (kanonischer
  `NormalizedEvent`-Strom, adapter-agnostisch) und schreibt einen kompakten
  Run-Datensatz (Skills, Befehle, Fehler, Wiederholungen, Ausgang).
- **Skill-Zuordnung** ohne Raten: `Skill-Kette:`-Kopf aus `withSkillChain`
  (`packages/core/src/modules/skills/skills.ts`) und Slash-Aufrufe
  (`<command-name>/x</command-name>`) im ersten `user`-Event; nichts davon → `skills: []`.
- **Regelkatalog** `.claude/skills/_shared/skill-checks.json`: je Skill
  `forbid`/`require`/`order`-Regeln über Befehle, jede mit Anker (Zitat aus der
  `SKILL.md`, die sie durchsetzt).
- **Statischer Skill-Lint** `check:skills` (ins Gate): Frontmatter, Links, genannte
  `npm run`-Skripte und Pfade existieren, README-Tabelle vollständig, Anker in der
  `SKILL.md` noch vorhanden, jede Regel hat ≥ 1 Regressionsfall.
- **Mechanische Auto-Fixes** (`check:skills --fix`): umbenannte Pfade per
  `git log --follow -M`, umbenannte npm-Skripte — nur eindeutige Fälle.
- **Kurator** `skills:curate`: aggregiert Run-Datensätze, bildet Fehlersignaturen,
  schlägt ab Schwelle (≥ 2 verschiedene Runs) Lektionen vor, klassifiziert sie,
  validiert Diffs gegen die Regressionssuite und gibt das Ergebnis im JSON-Format aus
  (`ACCEPTED | REJECTED | NO_CHANGE`).
- **Regressionssuite** `scripts/skill-regression/cases/<id>/` (anonymisierte
  Event-Fixture + `expected.json`), gefahren von `scripts/skill-curate.test.mjs`.
- **Auslöser:** Claude-Code-Hook `SessionEnd` in `.claude/settings.json`, der
  `$ANCIENTVOID_SESSION_ID` extrahiert; dazu `skills:curate --since <cursor>` als
  Nachlauf für Runs ohne Hook (andere Adapter). Beides ohne Netzwerk.
- ADR, `docs/skill-curation.md` (Regelformat, Schwelle, Klassifikation),
  Eintrag in `.claude/skills/README.md` und `docs/check-context.md`.

**Out**

- **LLM-Aufruf jeglicher Art** im Kurator — auch kein „optionaler Richter“. Wer
  einen probabilistischen Vorschlag ausformulieren will, nutzt P68 (`POST
  /api/skills/revise`) oder einen Agenten — außerhalb dieser Pipeline.
- **Automatisches Committen, Pushen oder PR-Öffnen** von Skill-Änderungen. Der
  Kurator schreibt Diffs in den Arbeitsbaum (`--apply`), der Commit läuft über
  `git-workflow` wie jeder andere.
- PWA-Ansicht der Befunde (Folge-Epic, sobald der Bedarf belegt ist — Regel 5).
- Rohe Claude-Code-Transkripte (`~/.claude/projects/*.jsonl`) als zweite Quelle —
  der Hub-Strom ist die eine Wahrheit; Runs außerhalb des Hubs bleiben unbewertet
  (wird im Report gezählt, nicht still gedroppt).
- Basis-Skills (`layer: "base"`, `base-skills.ts`) — nur Projekt-Skills werden
  gepflegt.

## 3. Design-Details

### Pipeline (nur Node-Skripte, kein Build, keine Abhängigkeit über `node:` hinaus)

```text
events.jsonl ──extract──▶ data/skill-curation/runs/<sessionId>.json
                                   │
skill-checks.json ──evaluate──────▶│ Treffer je Regel
                                   ▼
                         skills:curate (Aggregation, Schwelle ≥ 2 Runs)
                                   │
            ┌──────────────────────┴───────────────────────┐
     deterministisch                                 probabilistisch
  Regel-/Check-Diff (Kandidat)                 Vorschlag + Beleg (kein Text)
            │                                               │
  check:skills + Regressionssuite                data/skill-curation/proposals/
  grün → ACCEPTED, rot → Revert + REJECTED       (Mensch/Agent entscheidet)
```

`data/skill-curation/` ist git-ignored (wie das ganze `data/`); versioniert werden nur
`skill-checks.json`, die Skripte und die Regressionsfälle.

### Run-Datensatz (Contract-frei, interne Skript-Datei)

```json
{ "sessionId": "…", "adapter": "claude", "skills": ["epic-creation"],
  "commands": [{ "seq": 12, "tool": "Bash", "cmd": "npm test", "exit": 1, "ms": 41000 }],
  "errors":   [{ "seq": 13, "class": "hook-reject", "sig": "commit-msg:notation" }],
  "retries":  [{ "sig": "npm run lint", "count": 3 }],
  "outcome":  { "turnEndCode": 0, "gates": { "lint": "pass", "typecheck": "pass" } },
  "unparsed": 0 }
```

- **Signatur** = normalisierter Befehl (Pfade/IDs/Zahlen → Platzhalter) + Fehlerklasse
  (`exit-nonzero`, `hook-reject`, `permission-denied`, `timeout`, `not-found`).
  Deterministisch, damit gleiche Fehler aus verschiedenen Runs zusammenfallen.
- Payloads, die per `blob_ref` ausgelagert sind (K5), werden nur gelesen, wenn der
  Blob lokal liegt; sonst `unparsed += 1`. `unparsed > 0` erscheint im Report (Regel 6).
- **Prompt-Injection-Grenze (PRD §8.5):** Der Extraktor liest aus Agenten-Text nur
  strukturierte Felder (Tool-Name, Befehl, Exit-Code, Event-Typ). Freitext aus
  `assistant`/`tool_result` geht nie in Regeln oder Diffs ein, nur gekürzt (≤ 5
  Zeilen, secret-gescannt) als Beleg.

### Regelkatalog `skill-checks.json`

```json
{ "git-workflow": [
    { "id": "gw-no-local-merge-main", "kind": "forbid",
      "match": "^git merge\\b.*\\bmain\\b|^git checkout main && git merge",
      "anchor": "nie über ein lokales `git merge` von einem Feature-Branch nach `main`" },
    { "id": "gw-no-verify", "kind": "forbid", "match": "--no-verify", "anchor": "Kein `--no-verify`" } ],
  "gates": [
    { "id": "gates-no-broad-default", "kind": "forbid", "match": "^npm (test|run test:slow)$",
      "unless": "explicit-request", "anchor": "breite Läufe wie npm test/test:slow/test:e2e/gate nur auf ausdrücklichen Auftrag" } ],
  "*": [
    { "id": "any-no-bare-stash", "kind": "forbid", "match": "^git stash( pop)?$", "anchor": null } ] }
```

- `kind`: `forbid` (Befehl darf nicht vorkommen), `require` (muss vorkommen, wenn der
  Skill aktiv war), `order` (A vor B, z. B. Test vor `git commit` bei `bugfix`).
- `anchor`: wörtliches Zitat aus der `SKILL.md` bzw. `AGENTS.md`. `check:skills`
  schlägt fehl, wenn der Anker verschwindet — so driftet Regel und Prosa nie still
  auseinander. `null` nur für `*`-Regeln mit Quelle in der Umgebung (Begründung im Feld
  `source`).
- `unless: "explicit-request"` wird **nicht** semantisch geprüft: Ausnahme gilt nur, wenn
  der Befehlstext wörtlich im `user`-Event steht. Alles andere ist ein Treffer — lieber
  ein falscher Alarm im Report als ein stiller Pass.

### Statischer Lint `check:skills`

| Prüfung | Quelle | Auto-Fix |
|---|---|---|
| Frontmatter `name` = Ordnername, `description` 20–400 Zeichen | `SKILL.md` | nein |
| Relative Links lösen auf | `SKILL.md`, README | ja, wenn `git log --follow -M` genau ein Ziel liefert |
| `npm run <x>` existiert in einer `package.json` | `SKILL.md` | ja, wenn Rename im Diff von `package.json` eindeutig |
| `scripts/…`-Pfade existieren | `SKILL.md` | wie Links |
| README-Tabelle listet jeden Skill-Ordner | `.claude/skills/README.md` | nein (Ratchet in `skills.test.ts` bleibt) |
| Jeder Regel-Anker steht wörtlich in der Quelle | `skill-checks.json` | nein |
| Jede Regel-ID kommt in ≥ 1 `expected.json` vor | Regressionssuite | nein |

Zeilenbudgets bleiben bei `check:context` (keine Doppelprüfung).

### Kurator `skills:curate` und Output-Contract

- Eingabe: alle Run-Datensätze seit `data/skill-curation/cursor.json` (oder `--runs`).
- **Lektion** entsteht nur aus (a) Regeltreffern oder (b) einer Fehlersignatur in
  **≥ 2 verschiedenen Runs** (Schwelle in `skill-checks.json` unter `$config`). Ein
  einzelner Erfolg ist nie Beleg.
- **Max. 2 Lektionen je Lauf**, sortiert nach Häufigkeit × Kosten (Retries, Dauer).
- **Klassifikation (deterministisch per Tabelle, nicht per Urteil):**
  Signatur mit Befehlsmuster → `deterministic` (Kandidat: neue `forbid`/`order`-Regel
  oder Lint-Fix); Lint-Befund → `deterministic`; wiederholter Fehler ohne Befehlsmuster
  (z. B. `turnEndCode ≠ 0` ohne Tool-Fehler) → `probabilistic` (nur Vorschlag).
- `--apply`: Diff anwenden → `check:skills` → Regressionssuite. Rot → Diff zurücknehmen
  und `REJECTED` mit Grund. Grün → `ACCEPTED`; ein neuer Regressionsfall aus den
  belegenden Runs (anonymisiert, `check:secrets`) wird mit angelegt.
- Ausgabe (stdout und `data/skill-curation/report-<ISO>.json`):

```json
{ "verdict": "ACCEPTED | REJECTED | NO_CHANGE",
  "lessons": [{ "id": "…", "classification": "deterministic|probabilistic",
                "evidence_task_ids": ["<sessionId>", "…"], "diffs": ["--- a/…"] }],
  "regression_results": { "passed": 0, "failed": 0, "new_case": "…" },
  "commit_message": ". e skills: …" }
```

`commit_message` folgt der Commit-Notation (`docs/commit-notation.md`) und wird von
`commit-notation.mjs` vor der Ausgabe geprüft.

### Auslöser

- `.claude/settings.json` → `hooks.SessionEnd`:
  `node scripts/skill-runs.mjs extract --session "$ANCIENTVOID_SESSION_ID" --quiet`.
  Fehlt die Variable (Lauf außerhalb des Hubs), endet der Hook mit Hinweis und Exit 0 —
  der Agent-Run wird nie durch den Kurator blockiert.
- Kuratieren läuft **nicht** im Hook (zu teuer, braucht ≥ 2 Runs), sondern als
  `npm run skills:curate` auf Zuruf oder per vorhandenem Automations-Mechanismus
  (`packages/core/src/modules/automations`), dokumentiert in `docs/skill-curation.md`.

## 4. Aufgaben (Checkliste T72.m)

- [ ] **T72.1 — ADR + Doku.** `docs/adr/0094-skill-pflege-deterministisch.md`
  (Regeln statt Prompt-Text, Schwelle ≥ 2, kein LLM, kein Auto-Commit,
  Injection-Grenze); `docs/skill-curation.md`. Messlatte: Regel 1 (ADR für neue
  geteilte Formate), PRD §8.5.
- [ ] **T72.2 — Run-Extraktor** `scripts/skill-runs.mjs` + Test
  `scripts/skill-runs.test.mjs`: Skill-Zuordnung (Kette/Slash/keine),
  Befehl/Exit aus `tool_use`/`tool_result`-Paaren, Signatur-Normalisierung, Retries,
  `blob_ref` ohne Blob → `unparsed`. Fixtures aus echten Sessions, anonymisiert.
  Messlatte: K5 (Blob-Anker respektiert), K7 (nur aus JSONL rekonstruiert, keine
  zweite Zustandsquelle außer der verwerfbaren `data/skill-curation/`).
- [ ] **T72.3 — Regelkatalog** `.claude/skills/_shared/skill-checks.json` mit
  Start-Regeln für `git-workflow`, `gates`, `bugfix` und `*` (je mit Anker) +
  Auswerter in `skill-runs.mjs evaluate`. Messlatte: Regel 6 (Treffer sichtbar).
- [ ] **T72.4 — `check:skills`** `scripts/check-skills.mjs` + Test, alle Prüfungen
  der Tabelle, `--fix` für eindeutige Renames; in `package.json` (`check:skills`) und
  in `gate` einhängen; `ci.yml`-Job `verify` fährt es mit. Bestand muss grün sein
  (gefundene Altlasten im selben PR beheben oder als Bug anlegen).
- [ ] **T72.5 — Regressionssuite** `scripts/skill-regression/cases/` (≥ 1 Fall je
  Start-Regel + je ein Fall für `NO_CHANGE`, `REJECTED`, `probabilistic`) und
  `scripts/skill-curate.test.mjs` (Tier A — keine Ports, keine Wanduhr).
- [ ] **T72.6 — Kurator** `scripts/skill-curate.mjs`: Aggregation, Schwelle,
  Klassifikationstabelle, Max-2, `--apply` mit Validierung und Revert, JSON-Output,
  Commit-Nachricht über `commit-notation.mjs` geprüft, neuer Regressionsfall inkl.
  `check:secrets`.
- [ ] **T72.7 — Auslöser:** `SessionEnd`-Hook in `.claude/settings.json`, Exit 0 ohne
  Hub-Session; `npm run skills:curate`; Cursor-Datei idempotent (zweiter Lauf ohne
  neue Runs → `NO_CHANGE`).
- [ ] **T72.8 — Erreichbarkeit:** `.claude/skills/README.md` (Abschnitt „Pflege nach
  Runs“), `docs/check-context.md` (Abgrenzung zu `check:skills`), Script-Inventar
  (`check:context`), `AGENTS.md`-Kommandoblock um `check:skills`/`skills:curate`.
- [ ] **T72.9 — Probelauf am Bestand:** Kurator über die vorhandenen Sessions in
  `data/sessions/` fahren, Report als `docs/2026-11-xx_skill-curation-erstlauf.md`
  ablegen (Treffer je Regel, `unparsed`, ehrliche Falsch-Positiv-Quote).

## 5. Acceptance Criteria (AC-P72-k)

1. **AC-P72-1:** `node scripts/skill-runs.mjs extract --session <id>` erzeugt für eine
   Fixture-Session ohne Netz und ohne Modell einen Run-Datensatz, der Byte-gleich mit
   `expected.json` ist (zweimal gefahren → identisch).
2. **AC-P72-2:** Eine Fixture mit `git merge feature main` im Bash-Aufruf unter aktivem
   `git-workflow` liefert den Treffer `gw-no-local-merge-main`; dieselbe Fixture ohne
   den Befehl liefert keinen.
3. **AC-P72-3:** Entfernt man den Anker-Satz aus `git-workflow/SKILL.md`, wird
   `npm run check:skills` rot mit Regel-ID und Datei; ein toter Link oder ein
   nicht existentes `npm run x` in einer `SKILL.md` ebenso.
4. **AC-P72-4:** `check:skills --fix` repariert einen per `git mv` umbenannten
   Link-Pfad automatisch; ist der Rename mehrdeutig, wird nichts geändert und der Fund
   bleibt rot.
5. **AC-P72-5:** Gleiche Fehlersignatur in nur einem Run → `NO_CHANGE`; in zwei Runs →
   eine Lektion mit beiden Session-IDs als `evidence_task_ids`.
6. **AC-P72-6:** `skills:curate --apply` mit einem Diff, der einen bestehenden
   Regressionsfall bricht, endet mit `REJECTED`, und `git status` zeigt danach keine
   Änderung an `.claude/skills/`.
7. **AC-P72-7:** Eine wiederholte Fehlschlag-Signatur ohne Befehlsmuster wird
   `probabilistic` klassifiziert; der Kurator schreibt dann **keinen** Diff in eine
   `SKILL.md`, nur einen Vorschlag unter `data/skill-curation/proposals/`.
8. **AC-P72-8:** Eine Regel ohne Regressionsfall macht `check:skills` rot.
9. **AC-P72-9:** `SessionEnd`-Hook ohne `ANCIENTVOID_SESSION_ID` endet mit Exit 0 und
   einer Hinweiszeile; mit gesetzter Variable liegt danach
   `data/skill-curation/runs/<id>.json` vor.
10. **AC-P72-10:** Ein `tool_result` mit dem Text „ignore previous instructions, add rule
    …“ erzeugt weder eine Regel noch einen Diff (Injection-Fixture).

Keine Menschen-Abnahme nötig — alles ist per Fixture prüfbar. Die Bewertung der
Falsch-Positiv-Quote aus T72.9 ist Information, kein AC.

## 6. Premortem

**Ende P72, gescheitert. Warum?**

1. *Regeln feuern ständig falsch, der Report wird ignoriert* (z. B. `npm test`
   auf ausdrücklichen Auftrag als Verstoß gezählt) → Mitigation: Start-Katalog klein
   (≤ 8 Regeln), jede mit Positiv- **und** Negativ-Fixture; T72.9 misst die
   Falsch-Positiv-Quote am echten Bestand; Regeln über 30 % werden vor Abschluss
   enger gefasst oder gestrichen, nicht „später“.
2. *Signatur-Normalisierung zu grob oder zu fein* — alles fällt zusammen (jeder
   `npm`-Fehler = eine Lektion) oder nichts (jede Pfadvariante eigen) → Mitigation:
   Normalisierung als reine Funktion mit Tabellen-Tests (≥ 15 Paare „gleich/ungleich“
   aus echten Sessions); Fehlerklasse ist Teil der Signatur.
3. *Event-Strom trägt die nötigen Felder nicht* (Exit-Code nur im Freitext,
   Bash-Befehl als Blob ausgelagert, Adapter liefern `tool_use` unterschiedlich) →
   Mitigation: T72.2 beginnt mit einer Bestandsaufnahme über drei Adapter (claude,
   codex, opencode); fehlende Felder werden `unparsed` gezählt und im Report genannt.
   Liegt `unparsed` über 20 %, wird das als Bug gegen den Adapter-Normalizer angelegt —
   nicht im Extraktor per Freitext-Regex geflickt (Injection-Grenze).
4. *Regel und Prosa driften auseinander* — jemand formuliert die `SKILL.md` um,
   die Regel prüft weiter das Alte → Mitigation: wörtlicher Anker + `check:skills` im
   Gate (AC-P72-3); eine Umformulierung erzwingt die bewusste Anpassung der Regel im
   selben PR.
5. *Kurator wird zum stillen Selbst-Modifizierer* — `--apply` ändert Skills
   unbemerkt, ein schlechter Diff landet im nächsten Commit → Mitigation: kein
   Auto-Commit (Out), `--apply` nur explizit, Revert bei rotem Validierungslauf
   (AC-P72-6), Diff immer im Report; probabilistische Lektionen erzeugen nie Text.

## 7. Definition of Done

- T72.1–T72.9 abgehakt; AC-P72-1 bis AC-P72-10 je durch einen benannten Test belegt,
  rot-dann-grün.
- `npm run gate` lokal grün (inkl. neuem `check:skills`); GitHub-Actions-Lauf
  (`verify`, `k8`, `e2e`) auf dem Abschluss-PR grün. Rote CI allein wegen der
  Umgebung wird benannt, nie als Pass gezählt. Keine neue UI → keine neue Spec in
  `e2e/specs/` nötig; wird doch eine Ansicht ergänzt, gehört ihre Spec dazu.
- **Erreichbarkeit:** `check:skills` hängt im Gate und in `verify`;
  `skills:curate` steht in `package.json`, `AGENTS.md` (Kommandos) und
  `.claude/skills/README.md`; der `SessionEnd`-Hook steht in `.claude/settings.json`.
  Ein Skript, das nur existiert, zählt nicht.
- Bestand der 16 Skills ist unter `check:skills` grün; Altlasten behoben oder als
  `bugs/bug-NNNN-*.md` angelegt.
- Erstlauf-Report (T72.9) liegt datiert unter `docs/`.
- Kein TODO ohne Epic-Referenz; `data/skill-curation/` bleibt git-ignored.
