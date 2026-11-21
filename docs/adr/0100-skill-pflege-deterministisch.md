# ADR-0100 — Skill-Pflege deterministisch: einmaliges Laden, Regeln statt Prompt-Text, kein LLM

**Status:** akzeptiert (EPIC-P72; im Epic als „ADR-0094" geplant — Nummer war bei Umsetzung bereits vergeben) · **Betrifft:** `packages/contracts/src/harness/adapter.ts`, `packages/adapters/claude/src/index.ts`, `packages/core/src/modules/sessions/session-manager.ts`, `scripts/check-skills.mjs`, `scripts/skill-runs.mjs`, `scripts/skill-curate.mjs`, `.claude/skills/_shared/skill-checks.json`

**Messlatten:** K5 (Prompt-Größe), K7 (Rekonstruierbarkeit), PRD §8.5 (Injection-Grenze)

## Kontext

Claude expandiert `SKILL.md` nativ (`/<skill>`), und der Hub stellte zusätzlich
den Ketten-Block vor jeden Prompt — Doppel-Injektion bei jedem Folgeprompt.
Beschreibungen aller Skills (≈ 4 KB) lädt jede Session immer. Ein
LLM-gestützter „Skill Curator"-Lauf endete nutzlos (`NO_CHANGE`), weil er
Dateiformate voraussetzte, die es nicht gibt. Die Rohdaten der Runs existieren
(`events.jsonl`, `hub.db.turn_metrics`), nur in anderer Form. Detailmessung:
EPIC-P72 §0 und `docs/skill-curation.md`.

## Entscheidung

1. **Contract-Erweiterung `capabilities.nativeSkills?: boolean`** (optional,
   Default `false`): wer Skills nativ expandiert, setzt das Flag — bisher nur
   claude. Doppelte Injektion exists only once: bei `nativeSkills` injiziert
   der Hub die Kette nicht.
2. **Einmaliges Laden bei fortbestehendem Kontext:** Adapter mit
   `nativeResume ≠ "none"` erhalten den Ketten-Block nur im ersten Prompt,
   solange in dieser Laufzeit kein `session.skill_chain`-Event steht. Nach
   Neustart ohne Resume wird wieder injiziert — der Kontext ist dann neu.
3. **Regeln statt Prompt-Text:** Deterministische Lektionen werden Regeln im
   versionierten Katalog `.claude/skills/_shared/skill-checks.json`
   (`forbid`/`require`/`order`, je mit wörtlichem Anker, den
   `npm run check:skills` prüft), nie Prosa in `SKILL.md`. Eine Lektion wird
   erst ab `minRuns` (Default 2) verschiedenen Sessions zur Lektion; ein
   einzelner Erfolg ist nie Beleg. Probabilistische Lektionen erzeugen nur
   Vorschläge mit Beleg (≤ 5 Zeilen).
4. **Kein LLM im Kurator.** `scripts/skill-curate.mjs` ist ein reines Node-
   Skript (extract/evaluate/mine/classify). Wer einen Vorschlag ausformulieren
   will, nutzt P68 oder einen Agenten — außerhalb der Pipeline.
5. **Kein Auto-Commit.** `--apply` schreibt in den Arbeitsbaum, validiert mit
   `check:skills` + Regressionssuite, und nimmt bei Rot zurück
   (`REJECTED`). Commit folgt über `git-workflow`.
6. **Injection-Grenze (PRD §8.5):** Aus Agenten-Output werden nur Tool-Name,
   Befehl, `isError`, Exit-Zahl und Präfix-Klassen gelesen. Freitext aus
   Agenten-Output wird nie zur Regel — nur als gekürzter Beleg.
7. **K7:** `data/skill-curation/` ist git-ignored und verwerfbar; alle
   Datensätze sind aus `events.jsonl` + `hub.db` (read-only) neu erzeugbar.
   Versioniert sind nur Skripte, Regelkatalog und Regressionsfälle.

## Folgen

- `promptWithSkill`/Startpfad prüfen die Capability statt blind zu injizieren;
  Tests belegen 1×/0×/wieder-1× (AC-P72-1).
- `check:skills` wird Gate (CI `verify` + `npm run gate`); Altfälle
  (`factory`-Frontmatter, `git-workflow`-Budget) werden im selben Epic behoben.
- Normalizer-Lücken (maki/opencode: Shell-`tool_use` ohne `command`) bleiben
  bestehen und zählen in Auswertungen als `unparsed` — sie sind eigene Bugs,
  kein Ersatz aus `title`/Freitext (Injection-Grenze).
