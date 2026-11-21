# Skill-Kuratierung: Pipeline und Betrieb (`npm run skills:curate`)

**Art:** referenz

Skills sollen wenig Tokens kosten und deterministisch laufen (ADR-0100,
EPIC-P72). Alles darunter läuft offline mit Node ohne Modellaufruf;
LLM-Aufwertung ist ausdrücklich außerhalb der Pipeline (P68 oder Agent).

## Pipeline

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

`data/skill-curation/` ist git-ignored und verwerflich (K7: jederzeit neu
erzeugbar). Versioniert: Skripte, `.claude/skills/_shared/skill-checks.json`,
Regressionsfälle unter `scripts/skill-regression/cases/`.

## Kommandos

```bash
npm run check:skills                                   # Lint: Frontmatter, Budgets, Links, Regel-Anker
npm run check:skills -- --fix                          # nur eindeutige Renames
node scripts/skill-runs.mjs extract [--since ISO] [--project P]   # Run-Datensätze schreiben
node scripts/skill-runs.mjs evaluate                          # Regeltreffer über den Bestand
node scripts/skill-runs.mjs mine                              # wiederkehrende Befehlsfolgen
npm run skills:curate -- [--since ISO] [--project P] [--apply] # Aggregation + Klassifikation
```

`--apply` wendet Diffs an, validiert mit `check:skills` +
`scripts/skill-regression/` (vitest), und nimmt bei Rot zurück. Ein einzelner
Erfolg ist nie Beleg: eine Lektion braucht ≥ `minRuns` (Default 2)
verschiedene Sessions; maximal zwei Lektionen pro Lauf. Exit 0/1/2 = ok /
Befund / Fehler. `--json` liefert dieselben Daten maschinenlesbar.

## Startregeln und Muster

Regelkatalog: `.claude/skills/_shared/skill-checks.json` (`forbid`/`require`/
`order`; `scope: "project"` = alle Runs des Projekts, `scope: "invoked"` =
nur Runs mit zugeordnetem Skill). Jede Regel hat einen wörtlichen Anker (von
`check:skills` gegen die Quelle geprüft) und je eine Positiv- und
Negativ-Fixture. Ausnahmen per `unless: "literal-in-user-prompt"` greifen nur
bei wörtlichem Fund im User-Prompt — lieber ein falscher Alarm als ein stiller
Pass.

Skript-Skill-Muster (neue Skills): kurze Markdown-Hülle („wann, welcher
Aufruf, wie die Ausgabe zu lesen ist"), Logik im Skript, Ausgabe ≤ 40 Zeilen
Markdown bzw. `--json`; Vorlage `_shared/skill-template.md`. Piloten nur nach
gemessenen Kosten (EPIC-P72 §3).

## Auslöser (Automation, ADR-0080)

Manuell: `npm run skills:curate`. Geplant täglich: Hub-Automation mit
Skript-Ziel (keine neue Hub-Fläche):

```bash
hubctl automation create --name "skills-curate" --preset daily \
  --kind script --argv "npm,run,skills:curate"
```

Ein Kurator-Fehler beendet nur die Automation mit `failed` und berührt keine
Agenten-Session. Die Injection-Grenze (PRD §8.5) gilt durchgängig: Aus
Agenten-Output werden nur Tool-Name, Befehl, `isError`, Exit-Zahl und
Präfix-Klassen gelesen.

## Ausgangsmessung (EPIC-P72 §0, 18.11.2026)

232 Sessions / 317 094 Events / 147 MB; Skill-Zuordnung über
`session.skill_chain` (13 Sessions) und `Skill`-`tool_use` (~20 Aufrufe);
≈ 39 % der Shell-Aufrufe nicht auswertbar (maki/opencode-Normalizer-Lücke,
BUG-0247/BUG-0248); `turn_metrics` liefert echte Kosten (2 086 Turns).
16 `SKILL.md`, 83 917 Zeichen Body, Summe Beschreibungen 4 102 Zeichen
(Ratchet-Wert in `skill-checks.json` `$config`). Detailtabelle: EPIC-P72 §0.
