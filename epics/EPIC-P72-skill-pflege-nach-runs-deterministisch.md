# EPIC-P72 — Skill-Pflege nach Runs: deterministisch, per Skript, wenig Tokens

**Status:** offen · **Phase:** P72 · **Dauer:** 1,5 Agenten-Wochen · **Abhängigkeit:** keine blockierende — Quer-Epic wie P58–P70; P70 (höchste umgesetzte Phase) ist grün (T70.1–T70.6, PR #172, `verify` grün). P71 (Issue-Lebenszyklus) liegt nur als Planung auf `docs/epic-p71-issue-lebenszyklus` und teilt keine Codeflächen. P68 (Skill-Vorschläge pflegen, ADR-0089) ist die PWA-/Prompt-Seite derselben Skills — P72 berührt deren Routen nicht, wohl aber `resolveSkillChain`/`withSkillChain` (T72.2). P30/P31 bleiben On hold und unberührt.

Quelle: Nutzeraufträge vom 18.11.2026 — „Ich möchte automatisch unsere Skills nach
Runs anpassen. So deterministisch wie möglich, z. B. mit Skripten, die man ohne KI
ausführen kann.“ und „prüfen, welche Informationen schon vorhanden sind und welche wir
auslesen können … damit wir am Ende nur sinnvolle Skills einbauen, die so wenig
Tokenkosten wie möglich brauchen und so deterministisch wie möglich ablaufen. Skripte
oder sonstige Aufrufe sind vorzuziehen; Skripte mit Markdown anzureichern ist ok.“
Anlass: Ein „Skill Curator“-Prompt setzte `trajectory.jsonl`, `task_result.json` und
eine `regression_suite/` voraus — nichts davon existiert; der Lauf endete mit
`NO_CHANGE`. Die Bestandsaufnahme unten zeigt: Die Rohdaten gibt es, nur in anderer
Form — und der größte Token-Hebel liegt nicht im Lernen aus Runs, sondern darin, wie
Skills heute geladen werden.

## 0. Bestandsaufnahme (gemessen am 18.11.2026, Hub-`data/` und Repo)

### Was lesbar ist

| Quelle | Inhalt | Bestand | Taugt für |
|---|---|---|---|
| `data/sessions/<id>/events.jsonl` | `NormalizedEvent`-Strom | 232 Sessions, 317 094 Events, 147 MB; davon 54 647 `system`/`stream_event` ohne Nutzwert | Grundlage aller Run-Auswertungen |
| `system` · `session.created` | `adapter`, `project`, `args.skill` | jede Session | Adapter-/Projekt-Filter |
| `system` · `session.skill_chain` | `names[]` (strukturiert) | **13 Sessions** (bug-report 10, factory 2, epic-creation 1) | Skill-Zuordnung |
| `tool_use` `name: "Skill"` (claude) | `input.skill` (strukturiert) | ~20 Aufrufe (git-workflow 6, epic-creation 3, pr-review 2, …) | Skill-Zuordnung |
| Slash-Aufruf im `user`-Text | `<command-name>` | **0 Treffer** — wird nicht als Text gespeichert | nichts |
| Shell-`tool_use` mit Befehl | `input.command` | claude `Bash` 4 861/4 861, codex `Shell`, pi/omp/deepseek `bash` | Befehlsregeln, Sequenzen |
| Shell-`tool_use` **ohne** Befehl | maki `bash` nur `title` (3 553), opencode `shell`/`bash` nur `cwd` (3 626) | ≈ 39 % aller Shell-Aufrufe | **nicht auswertbar** (Normalizer-Lücke, T72.5) |
| `tool_result.isError` + `toolUseId` | strukturiert | 1 138 Fehler, 1 116 einem `tool_use` zuordenbar | Fehlersignaturen |
| Exit-Code | **nur im Text**, 5 Formate (`exit code N`, `exit code: N`, `exited with code N`, `Process exited with code N`, `Exit code N`) | ≈ 580 Treffer | Fehlerklasse (nur die Zahl wird gelesen) |
| Ablehnung/Blockade | Textpräfixe („Permission … denied“, „Blocked: sleep …“, „Keine Freigabe innerhalb …“) | 11 / 6 / 3 | Fehlerklassen `permission-denied`, `blocked`, `approval-timeout` |
| `system` · `hook_response` | `exit_code`, `hook_name` (strukturiert) | 0 Fehlschläge im Bestand | Hook-Regeln (künftig) |
| `hub.db` · `turn_metrics` | je Turn `tokens`, `tokens_source`, `cost_usd`, `tool_calls`, `outcome`, `duration_ms` | 2 086 Turns | **echte Kosten je Skill-Run** (Join über `session_id`) |
| `claude.result.usage` | `input`/`output` | `input` ohne Cache-Tokens (z. B. 34 bei 19 394 Output) | nicht für Kosten |
| `hub.db` · `*_stat_facts` | Tool-/Session-Fakten | alle leer | nichts |

### Was die Skills heute kosten

- 16 `SKILL.md`, 83 917 Zeichen Body; **Beschreibungen zusammen 4 102 Zeichen** — die
  lädt jede Claude-Session immer.
- **Doppel-Injektion (belegt in dieser Session):** Für `adapter: "claude"` mit Skill
  schickt der Adapter `/<skill>` (Claude expandiert die `SKILL.md` selbst, `withSkill` in
  `packages/adapters/claude/src/index.ts`) **und** der Hub stellt den vollen
  Ketten-Block davor (`promptWithSkill` → `withSkillChain`,
  `packages/core/src/modules/sessions/session-manager.ts`). Das passiert bei **jedem**
  Folgeprompt erneut — hier 3 Prompts × 2 Kopien × ≈ 4 KB `epic-creation`.
- `git-workflow` hat 12 670 Zeichen > `CHAIN_BLOCK_MAX` (12 000): als Startskill wird es
  **abgeschnitten** („[Skill-Kette gekürzt]“).
- `factory/SKILL.md` hat **kein Frontmatter** (keine Beschreibung → kein Auto-Trigger) und
  fehlt in der Tabelle von `.claude/skills/README.md`.
- Von 16 Skills rufen nur wenige ein eigenes Skript auf; der Rest ist Prosa, die das
  Modell bei jedem Aufruf neu liest und ausführt.

### Folgerungen für den Zuschnitt

1. Der billigste, sicherste Gewinn ist **statisch und sofort**: Doppel-Injektion
   abstellen, Budgets prüfen, Skills auf „Markdown ruft Skript“ umbauen.
2. Skill-zugeordnete Runs sind selten (≈ 30 von 232). Lernen „pro Skill“ trägt kaum;
   Regeln gelten daher **nach Befehlsbereich für alle Runs eines Projekts** (ein
   `git merge … main` verletzt `git-workflow`, ob der Skill geladen war oder nicht).
3. Der wertvollste Run-Befund ist **wiederkehrende Befehlsfolgen** (Kandidaten für ein
   Skript) — rein deterministisch aus den Shell-Befehlen ableitbar.
4. Kein Hook nötig: Hub-Automationen kennen schon ein Skript-Ziel ohne KI
   (ADR-0080, `kind: "script"`, registrierte argv-Aktion; `npm run`-Skripte werden als
   Aktion erkannt). Das deckt alle Adapter ab, nicht nur Claude.

## 1. Ziel

Skills kosten so wenig Tokens wie möglich und laufen so deterministisch wie möglich.
Dafür drei Stufen, alle als `node scripts/…` offline, idempotent, **ohne Modellaufruf**:

1. **Laden billiger machen:** Jeder Skill wird genau einmal geladen. Budgets für
   Beschreibung und Body werden im Gate geprüft.
2. **Skript statt Prosa:** Ein Skill ist eine kurze Markdown-Hülle („wann, welcher
   Aufruf, wie die Ausgabe zu lesen ist“). Die Logik steckt in einem Skript, das eine
   kompakte Markdown-Zusammenfassung ausgibt (`--json` für Maschinen).
3. **Aus Runs lernen:** Nach Runs entstehen Befunde mit Beleg. **Deterministische
   Lektionen** werden zu Regeln/Checks oder Skript-Kandidaten, nie zu Prompt-Text.
   **Probabilistische Lektionen** werden nur zu Vorschlägen mit Beleg (Run-IDs, ≤ 5
   Zeilen). Jede angenommene Regel bringt einen Regressionsfall mit.

## 2. Scope (In / Out)

**In**

- **Token-Diät beim Laden (Core):** keine Ketten-Injektion, wenn der Adapter den Skill
  nativ expandiert; Ketten-Block bei Adaptern mit fortbestehendem Kontext
  (`capabilities.nativeResume` ≠ `"none"`) nur im ersten Prompt. Für alle Adapter ohne native
  Skills bleibt das heutige Verhalten.
- **Statischer Lint `check:skills`** (ins Gate): Frontmatter, Budgets, Links, genannte
  `npm run`-Skripte/Pfade, README-Vollständigkeit, Regel-Anker, Regel ↔ Regressionsfall;
  `--fix` nur für eindeutige Renames. Altlasten (`factory`, `git-workflow`) im selben
  Epic beheben.
- **Skript-Skill-Muster** in `_shared/skill-template.md` und als Pilot an höchstens
  **zwei** Skills, die der Erstlauf (T72.11) als teuerste mit Skript-Potenzial belegt.
- **Run-Extraktor** über `events.jsonl` + `turn_metrics` (Adapter-Normalisierung der
  Shell-Namen, Exit-Klasse, Skill-Zuordnung, Kosten-Join, `stream_event` übersprungen).
- **Regelkatalog** `skill-checks.json` (`forbid`/`require`/`order`, je mit wörtlichem
  Anker) und Auswertung.
- **Sequenz-Mining:** wiederkehrende normalisierte Befehlsfolgen über Runs →
  Skript-Kandidaten mit Häufigkeit und Belegen.
- **Kurator `skills:curate`** mit Schwelle, Max-2, Klassifikationstabelle,
  `--apply`-Validierung mit Revert, JSON-Ausgabe.
- **Regressionssuite** aus anonymisierten Fixtures.
- **Auslöser:** `npm run skills:curate` und eine dokumentierte Hub-Automation mit
  Skript-Ziel (ADR-0080) — keine neue Hub-Fläche.
- Bug-Dateien für die Normalizer-Lücken maki/opencode (Fix nicht hier).
- ADR, `docs/skill-curation.md`, Erreichbarkeit (README, `AGENTS.md`, Script-Inventar).

**Out**

- **LLM-Aufruf jeglicher Art** im Kurator. Wer einen probabilistischen Vorschlag
  ausformulieren will, nutzt P68 (`POST /api/skills/revise`) oder einen Agenten —
  außerhalb dieser Pipeline.
- **Automatisches Committen, Pushen oder PR-Öffnen.** `--apply` schreibt nur in den
  Arbeitsbaum; der Commit läuft über `git-workflow`.
- `SessionEnd`-Hook in `.claude/settings.json` — durch die Automation ersetzt (deckt alle
  Adapter ab, braucht keine Claude-Sonderlogik).
- Fix der maki/opencode-Normalizer (eigene Bugfixes; bis dahin zählt der Report diese
  Aufrufe als `unparsed`, statt sie still zu droppen).
- Rohe Claude-Code-Transkripte (`~/.claude/projects/*.jsonl`) als zweite Quelle.
- Token-Schätzung aus `claude.result.usage` (ohne Cache-Tokens unbrauchbar); es zählt
  `turn_metrics.cost_usd`/`tokens`.
- PWA-Ansicht der Befunde (Folge-Epic, sobald der Bedarf belegt ist — Regel 5).
- Basis-Skills (`layer: "base"`) und Massen-Umbau aller 16 Skills — nur Altlasten und
  ≤ 2 Piloten.

## 3. Design-Details

### Pipeline

```text
hub.db.turn_metrics ─┐
events.jsonl ──extract┴─▶ data/skill-curation/runs/<sessionId>.json
                                   │
skill-checks.json ──evaluate──────▶│  Regeltreffer
                  ──mine──────────▶│  Befehlsfolgen
                                   ▼
                         skills:curate (Schwelle, Max-2, Klassifikation)
            ┌──────────────────────┴───────────────────────┐
     deterministisch                                 probabilistisch
 Regel-Diff / Lint-Fix / Skript-Kandidat        Vorschlag + Beleg, kein Text
            │                                               │
  check:skills + Regressionssuite              data/skill-curation/proposals/
  grün → ACCEPTED, rot → Revert + REJECTED
```

`data/skill-curation/` ist git-ignored und verwerfbar (K7: aus `events.jsonl` +
`hub.db` jederzeit neu erzeugbar). Versioniert werden nur Skripte, `skill-checks.json`
und Regressionsfälle.

### Token-Diät beim Laden (T72.2)

- `withSkillChain` wird für Adapter übersprungen, die den Skill nativ laden. Dafür
  bekommt der Adapter eine Fähigkeit `capabilities.nativeSkills: true` (claude) — eine
  **Contract-Erweiterung** (optional, Default `false`), deshalb das ADR.
- `promptWithSkill` injiziert bei `nativeResume` nur, solange in der Session noch kein
  `session.skill_chain`-Event steht. Nach einem Neustart ohne Resume wird wieder
  injiziert, weil der Kontext dann neu ist.
- Messung ohne Modell: Länge des `session.prompt`-Texts vor/nach je Fixture-Session
  (AC-P72-1). Die Kostenwirkung belegt der Erstlauf anhand von `turn_metrics`.

### Statischer Lint `check:skills` (T72.3)

| Prüfung | Grenze | Auto-Fix |
|---|---|---|
| Frontmatter vorhanden, `name` = Ordner | — | nein |
| `description` | 40–300 Zeichen (immer geladen) | nein |
| Body je Skill | ≤ 8 000 Zeichen; Kette inkl. `extends` ≤ `CHAIN_BLOCK_MAX` (aus `skills.ts` gelesen, nicht kopiert) | nein |
| Summe aller Beschreibungen | Ratchet: darf nur sinken (Wert in `skill-checks.json` `$config`) | nein |
| Relative Links, `scripts/…`-Pfade | existieren | ja, wenn `git log --follow -M` genau ein Ziel liefert |
| `npm run <x>` | existiert in einer `package.json` | ja, wenn der Rename eindeutig ist |
| README-Tabelle | listet jeden Skill-Ordner | nein |
| Regel-Anker | steht wörtlich in der Quelle | nein |
| Regel-ID | kommt in ≥ 1 `expected.json` vor | nein |

Ausgabe: eine Zeile je Fund (`<skill> <prüfung> <ist>/<soll>`), am Ende eine
Budget-Tabelle (Zeichen und `≈ Tokens = Zeichen/4`, ausdrücklich als Schätzung markiert).
Zeilenbudgets bleiben bei `check:context`.

### Skript-Skill-Muster (T72.4)

```markdown
---
name: <name>
description: <wann, ≤ 300 Zeichen>
---
# <name>
Aufruf: `node scripts/<name>.mjs [--json]`
Lesen: <wie die Ausgabe zu deuten ist; was bei Exit ≠ 0 zu tun ist>
Regeln, die das Skript nicht prüfen kann: <≤ 5 Punkte>
```

Das Skript gibt standardmäßig ≤ 40 Zeilen Markdown aus (Tabelle/Liste, kein Fließtext)
und mit `--json` dieselben Daten maschinenlesbar. Exit-Code 0/1/2 = ok/Befund/Fehler.
Piloten: höchstens zwei Skills, ausgewählt nach dem Erstlauf (teuerste
`turn_metrics.cost_usd` je zugeordnetem Run × Anteil wiederkehrender Befehlsfolgen).
Kandidaten nach heutigem Stand: `gates` (gezielte Tests aus `git diff` bestimmen) und
`git-workflow` (über Budget; Notation/Branch/PR-Schritte sind schon skriptbar über
`commit-notation.mjs`).

### Run-Datensatz und Normalisierung (T72.6)

```json
{ "sessionId": "…", "adapter": "codex", "project": "AncientVoid",
  "skills": { "chain": ["bug-report"], "invoked": ["git-workflow"] },
  "commands": [{ "seq": 12, "cmd": "npm run lint", "error": "exit-nonzero", "exit": 1 }],
  "cost": { "usd": 1.67, "tokens": 19428, "source": "native", "turns": 2 },
  "unparsed": { "shellWithoutCommand": 0, "blobMissing": 0, "unknownShape": 0 } }
```

- Shell-Namen werden auf eine Tabelle abgebildet (`Bash`/`bash`/`shell`/`Shell` →
  `shell`); unbekannte Namen landen in `unknownShape`.
- Exit-Code: Nur die **erste Zeile** des `tool_result` wird gegen die fünf belegten
  Formate geprüft, und es wird nur die Zahl übernommen. Sonst gilt `isError` → `error`
  ohne `exit`.
- **Signatur** = normalisierter Befehl (Pfade, UUIDs, Zahlen, Quoted-Strings →
  Platzhalter; Pipes/`&&` in Einzelbefehle zerlegt) + Fehlerklasse.
- **Prompt-Injection-Grenze (PRD §8.5):** Aus Agenten-Text werden nur Tool-Name, Befehl,
  `isError`, die Exit-Zahl und Präfix-Klassen gelesen. Freitext geht nie in Regeln
  oder Diffs ein, nur gekürzt (≤ 5 Zeilen, `check:secrets`) als Beleg.

### Regelkatalog `skill-checks.json` (T72.7)

```json
{ "$config": { "minRuns": 2, "maxLessons": 2, "descriptionBudgetTotal": 4102 },
  "git-workflow": [
    { "id": "gw-no-local-merge-main", "kind": "forbid", "scope": "project",
      "match": "^git merge\\b.*\\bmain\\b",
      "anchor": "nie über ein lokales `git merge` von einem Feature-Branch nach `main`" },
    { "id": "gw-no-verify", "kind": "forbid", "scope": "project", "match": "--no-verify",
      "anchor": "Kein `--no-verify`" } ],
  "gates": [
    { "id": "gates-no-broad-default", "kind": "forbid", "scope": "project",
      "match": "^npm (test|run test:slow|run gate)$", "unless": "literal-in-user-prompt",
      "anchor": "breite Läufe wie npm test/test:slow/test:e2e/gate nur auf ausdrücklichen Auftrag" } ] }
```

- `scope: "project"`: Die Regel gilt für alle Runs des Projekts. `scope: "invoked"`: nur
  für Runs, in denen der Skill zugeordnet ist.
- `unless: "literal-in-user-prompt"` wird nicht semantisch ausgelegt: Die Ausnahme greift
  nur, wenn der Befehl wörtlich im `user`-Prompt steht. Lieber ein falscher Alarm im
  Report als ein stiller Pass.
- Start-Katalog ≤ 8 Regeln. Jede Regel hat eine Positiv- und eine Negativ-Fixture.

### Sequenz-Mining (T72.8)

- Je Run die Folge der Signaturen; daraus n-Gramme (n = 2–4) ohne Lesebefehle
  (`ls`, `cat`, `sed -n`, `grep`, `git status/log/diff`).
- Kandidat ab ≥ 3 Runs in ≥ 2 Sessions, sortiert nach Vorkommen × Ø Turn-Kosten.
- Ausgabe: Folge, Häufigkeit, Session-IDs und ein Vorschlag für den Skriptnamen, der
  deterministisch aus den Befehlen gebildet wird. Das Skript selbst schreibt ein
  Mensch oder Agent. Der Kurator meldet den Kandidaten nur.

### Kurator und Output-Contract (T72.10)

- Eingabe: Run-Datensätze seit `data/skill-curation/cursor.json` (oder `--runs`).
- Lektion nur aus Regeltreffern, Lint-Funden oder einer Signatur/Folge in
  **≥ `minRuns` verschiedenen Sessions**. Ein einzelner Erfolg ist nie Beleg.
- **Klassifikation per Tabelle:**

  | Befund | Klasse | Ergebnis |
  |---|---|---|
  | Lint-Fund mit eindeutigem Fix | deterministic | Diff |
  | Fehlersignatur mit Befehlsmuster | deterministic | Regel-Kandidat (`forbid`/`order`) |
  | Wiederkehrende Befehlsfolge | deterministic | Skript-Kandidat (kein Diff) |
  | Fehler ohne Befehlsmuster (`outcome ≠ ok`, kein Tool-Fehler) | probabilistic | Vorschlag mit Beleg |

- `--apply`: Diff anwenden → `check:skills` → Regressionssuite. Rot → zurücknehmen,
  `REJECTED` mit Grund. Grün → `ACCEPTED` plus neuer Regressionsfall aus den
  belegenden Runs (anonymisiert, `check:secrets`).
- Ausgabe (stdout als Markdown-Kurzfassung, Datei `report-<ISO>.json`):

```json
{ "verdict": "ACCEPTED | REJECTED | NO_CHANGE",
  "lessons": [{ "id": "…", "classification": "deterministic|probabilistic",
                "evidence_task_ids": ["<sessionId>", "…"], "diffs": ["--- a/…"] }],
  "regression_results": { "passed": 0, "failed": 0, "new_case": "…" },
  "commit_message": ". e skills: …" }
```

`commit_message` wird vor der Ausgabe mit `scripts/commit-notation.mjs` geprüft.

### Auslöser (T72.12)

- `npm run skills:curate` (manuell, mit `--since`/`--project`).
- Hub-Automation `kind: "script"` auf die erkannte Aktion `skills:curate` (ADR-0080),
  Preset täglich. Die Einrichtung ist in `docs/skill-curation.md` beschrieben, dafür ist
  kein neuer Code nötig. Ein Kurator-Fehler beendet nur die Automation mit
  `failed` und berührt keine Agenten-Session.

## 4. Aufgaben (Checkliste T72.m)

- [x] **T72.1 — ADR + Doku.** `docs/adr/0094-skill-pflege-deterministisch.md`
  (`nativeSkills`-Fähigkeit, einmaliges Laden, Regeln statt Prompt-Text,
  Schwelle, kein LLM, kein Auto-Commit, Injection-Grenze); `docs/skill-curation.md`
  (Bestandsaufnahme §0 als Ausgangsmessung). Messlatte: Regel 1 (Contract-Erweiterung
  braucht ADR), PRD §8.5.
- [x] **T72.2 — Token-Diät beim Laden.** `nativeSkills` in den Adapter-Capabilities
  (Contract, optional), claude setzt es; `session-manager.promptWithSkill` überspringt
  die Kette bei `nativeSkills` und injiziert bei `nativeResume` nur einmal. Tests in
  `packages/core/test/modules/sessions/` (rot-dann-grün: heute 2 Kopien je Prompt, danach
  1 bzw. 0). Messlatte: K5-Geist (kleinere Prompts), K7 (Neustart ohne Resume injiziert
  wieder).
- [x] **T72.3 — `check:skills`** `scripts/check-skills.mjs` + `.test.mjs`, alle Prüfungen
  der Tabelle, `--fix`; in `package.json`, `gate` und den `verify`-Job. Altlasten im selben
  PR: `factory` bekommt Frontmatter und einen README-Eintrag, `git-workflow` kommt unter
  das Body-Budget (Details in `docs/`/Skript, Verweis statt Kopie).
- [x] **T72.4 — Skript-Skill-Muster** in `_shared/skill-template.md` (Hülle + Ausgabe-
  Konvention ≤ 40 Zeilen/`--json`/Exit 0/1/2), Abschnitt in `.claude/skills/README.md`.
- [x] **T72.5 — Normalizer-Lücken als Bugs anlegen** (Skill `bug-report`): maki
  `bash` ohne `command` (nur `title`), opencode `shell`/`bash` ohne `command` (nur `cwd`)
  — jeweils mit Zählung aus §0 und Fixture-Hinweis. Messlatte: Regel 6.
- [x] **T72.6 — Run-Extraktor** `scripts/skill-runs.mjs extract` + Test: Shell-Tabelle,
  Exit-Formate, Fehlerklassen, Zuordnung (`session.skill_chain`, `Skill`-`tool_use`),
  `turn_metrics`-Join (read-only `node:sqlite`), `stream_event` übersprungen,
  `unparsed`-Zähler. Fixtures aus echten Sessions je Adapter (claude, codex, pi, maki,
  opencode), anonymisiert. Messlatte: K5 (`blobRef` respektiert), K7.
- [x] **T72.7 — Regelkatalog + `evaluate`**: `.claude/skills/_shared/skill-checks.json`
  (≤ 8 Startregeln für `git-workflow`, `gates`, `bugfix`, `*`), Positiv- und
  Negativ-Fixture je Regel.
- [x] **T72.8 — Sequenz-Mining** `scripts/skill-runs.mjs mine` + Tabellentests für
  Signatur-Normalisierung (≥ 15 Paare gleich/ungleich aus echten Befehlen).
- [x] **T72.9 — Regressionssuite** `scripts/skill-regression/cases/` (je Startregel +
  `NO_CHANGE`, `REJECTED`, `probabilistic`, Injection-Fall) und
  `scripts/skill-curate.test.mjs` (Tier A, keine Ports, keine Wanduhr).
- [x] **T72.10 — Kurator** `scripts/skill-curate.mjs`: Aggregation, Klassifikationstabelle,
  Max-2, `--apply` mit Validierung und Revert, Markdown- und JSON-Ausgabe, Commit-Nachricht
  geprüft, neuer Regressionsfall mit `check:secrets`.
- [ ] **T72.11 — Erstlauf am Bestand** (232 Sessions): Report
  `docs/2026-11-xx_skill-curation-erstlauf.md` mit Budget-Tabelle, Kosten je Skill aus
  `turn_metrics`, Regeltreffern, Top-10 Befehlsfolgen, `unparsed`-Quote je Adapter und
  ehrlicher Falsch-Positiv-Quote. Daraus die ≤ 2 Piloten festlegen und umsetzen
  (Skript + Hülle nach T72.4, Kosten vor/nach aus dem nächsten Lauf).
- [x] **T72.12 — Auslöser + Erreichbarkeit:** `skills:curate` und `check:skills` in
  `package.json`, `AGENTS.md` (Kommandos), `.claude/skills/README.md`, Script-Inventar
  (`check:context`); Automationsrezept in `docs/skill-curation.md`; Cursor idempotent.

## 5. Acceptance Criteria (AC-P72-k)

1. **AC-P72-1:** Für eine claude-Session mit Skill enthält der an den Adapter gelieferte
   Prompt den Skill-Body **0×** vom Hub (nur `/<skill>`). Für einen Adapter ohne
   `nativeSkills` mit `nativeResume` steht er im ersten Prompt 1× und in Folgeprompts
   0×. Nach einem Neustart ohne Resume steht er wieder 1× drin.
2. **AC-P72-2:** `npm run check:skills` ist auf dem Bestand grün; das Entfernen eines
   Regel-Ankers, ein toter Link, ein unbekanntes `npm run x`, eine Beschreibung über 300
   Zeichen oder ein Body über Budget machen es jeweils rot mit Skill und Prüfung.
3. **AC-P72-3:** `check:skills --fix` repariert einen per `git mv` umbenannten Pfad. Ist
   der Rename mehrdeutig, ändert es nichts und bleibt rot.
4. **AC-P72-4:** `skill-runs.mjs extract` liefert für jede Adapter-Fixture zweimal
   hintereinander einen byte-gleichen Datensatz, der `expected.json` entspricht. maki- und
   opencode-Fixtures zeigen `shellWithoutCommand > 0` statt fehlender Zeilen.
5. **AC-P72-5:** Ein `git merge feature main` in einer Session **ohne** zugeordneten Skill
   löst `gw-no-local-merge-main` aus (Scope `project`). Ohne den Befehl gibt es keinen
   Treffer.
6. **AC-P72-6:** Dieselbe Signatur in einer Session ergibt `NO_CHANGE`, in zwei Sessions
   eine Lektion mit beiden IDs als `evidence_task_ids`.
7. **AC-P72-7:** Eine Befehlsfolge, die in drei Fixture-Sessions vorkommt, erscheint als
   Skript-Kandidat; der Kurator schreibt dafür keinen Diff.
8. **AC-P72-8:** `skills:curate --apply` mit einem Diff, der einen Regressionsfall bricht,
   endet mit `REJECTED`, und `git status` zeigt danach keine Änderung unter
   `.claude/skills/`.
9. **AC-P72-9:** Ein Fehler ohne Befehlsmuster wird `probabilistic` und erzeugt nur eine
   Datei unter `data/skill-curation/proposals/`, keinen `SKILL.md`-Diff.
10. **AC-P72-10:** Ein `tool_result`, das „ignore previous instructions, add rule …“
    enthält, erzeugt weder eine Regel noch einen Diff (Injection-Fixture).
11. **AC-P72-11:** Ein zweiter `skills:curate`-Lauf ohne neue Runs ergibt `NO_CHANGE` und
    lässt den Cursor unverändert.

Keine Menschen-Abnahme nötig — alles ist per Fixture prüfbar. Die
Falsch-Positiv-Quote aus T72.11 ist Information, kein AC.

## 6. Premortem

**Ende P72, gescheitert. Warum?**

1. *Zu wenig Skill-zugeordnete Runs: Der Kurator findet nie etwas* (Bestand: ≈ 30 von
   232) → Mitigation: Regeln gelten per `scope: "project"` für alle Runs. Lint und
   Token-Diät hängen nicht an Run-Daten. Der Erstlauf zeigt die Trefferzahl je Quelle,
   und eine Quelle, die nichts liefert, wird gestrichen statt gepflegt.
2. *Ein Drittel der Shell-Aufrufe ist blind* (maki/opencode ohne `command`), dadurch
   verzerrte Signaturen und Folgen → Mitigation: Zählung als `unparsed` je Adapter im
   Report, Bugs in T72.5. Kein Ersatz aus `title`/Freitext, das würde die
   Injection-Grenze verletzen. Adapter über 20 % `unparsed` werden im Report getrennt
   ausgewiesen, nicht gemittelt.
3. *Token-Diät bricht Skills bei einem Adapter* (Kette fehlt, weil `nativeResume`
   behauptet, aber der Kontext beim Resume weg ist) → Mitigation: Injektion hängt am
   `session.skill_chain`-Event **dieser Laufzeit**, nicht an der Session. Test für
   Neustart ohne Resume (AC-P72-1). `nativeSkills` ist opt-in je Adapter und zunächst
   nur bei claude gesetzt.
4. *Regeln feuern falsch, der Report wird ignoriert* (z. B. `npm test` auf
   ausdrücklichen Auftrag) → Mitigation: ≤ 8 Startregeln mit Positiv- und
   Negativ-Fixture. Der Erstlauf misst die Falsch-Positiv-Quote; Regeln über 30 %
   werden vor dem Abschluss enger gefasst oder gestrichen.
5. *Regel und Prosa driften auseinander* oder *der Kurator ändert Skills unbemerkt* →
   Mitigation: wörtlicher Anker und `check:skills` im Gate. Kein Auto-Commit,
   `--apply` nur explizit, Revert bei Rot. Probabilistische Lektionen erzeugen nie
   Text.
6. *Skript-Piloten werden größer als die Prosa, die sie ersetzen* → Mitigation: höchstens
   zwei Piloten, ausgewählt nach gemessenen Kosten. Die Hülle muss das Body-Budget
   deutlich unterbieten, und ein Pilot ohne messbare Ersparnis im Folgelauf wird
   zurückgebaut.

## 7. Definition of Done

- T72.1–T72.12 abgehakt; AC-P72-1 bis AC-P72-11 je durch einen benannten Test belegt,
  rot-dann-grün.
- `npm run gate` lokal grün (inkl. `check:skills`); GitHub-Actions-Lauf (`verify`, `k8`,
  `e2e`) auf dem Abschluss-PR grün. Rote CI allein wegen der Umgebung wird benannt, nie
  als Pass gezählt. Keine neue UI → keine neue Spec in `e2e/specs/`; kommt doch eine
  Ansicht dazu, gehört ihre Spec dazu.
- **Erreichbarkeit:** `check:skills` hängt im Gate und in `verify`; `skills:curate` steht
  in `package.json`, `AGENTS.md`, `.claude/skills/README.md` und dem Script-Inventar; das
  Automationsrezept ist dokumentiert und einmal eingerichtet nachgewiesen (Automation-Lauf
  `succeeded` im Report). Ein Skript, das nur existiert, zählt nicht.
- Alle 16 Skills sind unter `check:skills` grün (auch `factory`, `git-workflow`). Die
  Summe der Beschreibungen liegt höchstens beim Ratchet-Wert.
- Erstlauf-Report (T72.11) liegt datiert unter `docs/`, mit Kosten je Skill vor/nach für
  die Token-Diät und die Piloten.
- Normalizer-Bugs (T72.5) liegen unter `bugs/`.
- Kein TODO ohne Epic-Referenz; `data/skill-curation/` bleibt git-ignored.
