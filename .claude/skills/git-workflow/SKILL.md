---
name: git-workflow
description: Commit-Notation (docs/commit-notation.md), Branch-Naming feat/fix/docs (ein Branch pro Aufgabe), GitHub-PR via gh, Co-Author-Trailer, Post-Merge-Hygiene. Aktiv bei commit, branch, PR anlegen, Aufräumen. Merge nur über gh pr merge/GitHub-UI, nie lokal nach main. Kein Force-Push, kein Commit auf main.
---

# Skill: git-workflow

Querschnitts-Regeln: [`CONTRIBUTING.md`](../../../CONTRIBUTING.md). Gates:
[`gates`](../gates/SKILL.md). Review: [`pr-review`](../pr-review/SKILL.md).

## Zweck

Commit, Branch und PR sehen jedes Mal gleich aus — ausführbare Form von
`CONTRIBUTING.md` (Regelquelle).

## Wann benutzen (Trigger)

- commit, branch anlegen, PR öffnen, Commit-Notation, Co-Author.

**Nicht:** Epic-Struktur (`epic-creation`); Bugfix-Ablauf (`bugfix`).

## Hard Rules

- ✅ Commit-Notation `<Risiko> <Absicht> <bereich>: <Satz>` —
  [`docs/commit-notation.md`](../../../docs/commit-notation.md). Risiko ehrlich
  nach Beleg: `^` nur mit grünem Gate **und** Tests, die das geänderte
  Verhalten abdecken; nur live belegt → `!`; Zwischenstand → `@` (nie als
  PR-Titel). Eine Verhaltensänderung pro Commit.
- ✅ Branch: `feat/<scope>-<slug>` · `fix/<problem>` · `docs/<scope>` —
  granular pro Aufgabe: ein Task/Bugfix/Doc-Abschluss = ein Branch = ein PR,
  kein Bündeln unabhängiger Aufgaben.
- ✅ Co-Author-Trailer bei KI-Commits.
- ✅ Never invents scope beyond what wurde angewiesen — aber unter einer
  stehenden Anweisung, ein Epic/eine Aufgabe autonom durchzuarbeiten, ist
  **ein Branch pro Aufgabe** genau das, was diese Anweisung verlangt. „Ohne
  Anweisung" heißt: keine Branches für Arbeit, die niemand verlangt hat.
- ✅ **Der einzige Ort, an dem ein Feature-/Fix-/Docs-Branch mit `main`
  zusammengeführt wird, ist der Pull Request** (`gh pr merge` oder UI) — nie
  ein lokales `git merge`/`git merge --ff-only` von `feat/*` nach `main`
  (realer Fehlerfall 2026-09-18).
- ✅ **Remote nicht erreichbar ist kein Grund, den Merge lokal nachzubauen.**
  Branch bleibt offen, ungemerged, ungelöscht; `main` bewegt sich nicht, bis
  der PR real gemerged ist; bei mehreren wartenden Branches strikt in
  Entstehungsreihenfolge pushen/mergen.
- ❌ Never force-push, never rewrite published history, never commit auf `main`.
- ❌ **Never** `git merge`/`git rebase` von einem Feature-Branch auf `main`
  als Ersatz für einen echten PR — auch nicht bei Selbst-Merge (Solo-Projekt
  erlaubt Self-Merge des PRs, nicht das Überspringen des PRs selbst).
- ❌ Never `--no-verify`.
- ✅ Nach jedem Merge: Source-Branch lokal löschen, remote nachziehen,
  `git fetch --prune`. Gemergte Branches nicht als Archiv liegen lassen —
  der PR ist der Log.
- ✅ PR-Ziel ist `main`. Lange Integrations-Branches nur als kurze Epic-Kette,
  die zeitnah nach `main` kommt.

## Kadenz — wann commit, wann push, wann PR (deterministisch)

Diese Momente sind fest, keine Ermessenssache:

| Ereignis | Aktion |
|---|---|
| Task/Aufgabe (`T<n>.<m>`) einer Epic abgeschlossen | commit (lokal, auf dem laufenden `feat/`-Branch) |
| Bugfix abgeschlossen (`bugfix`-Skill, Finalize) | commit **+ push + PR** (`gh pr create`) |
| Epic abgeschlossen (alle AC grün, `retro` gelaufen) | commit **+ push + PR** für den Epic-/Feature-Branch nach `main` |
| Vor jedem Abschluss-Commit eines Epics: Statuszeile, Checkboxen und `epics/README.md` auf echten Stand bringen — `npm run check:epics` muss grün sein | Pflicht-Schritt der Kadenz, kein Ermessen |

Solo-Projekt: Self-Merge des eigenen PRs ist zulässig (Prüfungsmaßstab siehe
[`pr-review`](../pr-review/SKILL.md)); der PR bleibt Pflicht — er ist der
Log-Eintrag. Kaltstart-Ausnahme gilt nicht mehr.

## Phasen/Prozess

### 1. Branch

`git checkout -b feat/<scope>-<slug>` — kein Push direkt auf `main`; ein Branch
pro Aufgabe (Hard Rules).

### 2. Pre-Commit Checks

Dieselben Gates wie [`gates`](../gates/SKILL.md): `npm test && npm run lint
&& npm run typecheck`. Lokale Hooks: `.githooks/commit-msg` (Notation) und
`pre-push` (Lint, Typecheck); `npm run gate` prüft zusätzlich alle Commits
des Branches (`check:commits`).

### 3. Commit

```text
^ F adapter-local-llm: Stream des llama.cpp-Servers lesen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

Zusammenfassung ≤ 100 Zeichen, Bereich = Paket/Modul. Keine Secrets.

### 4. PR (GitHub) — push, öffnen, CI abwarten, mergen

```bash
git push -u origin feat/adapter-local-llm    # erst sichern, dass Push und PR wirklich existieren
gh pr create --base main --title "^ F …" --body-file pr-desc.md   # Vorlage: .github/pull_request_template.md
gh pr checks --watch                          # blockiert bis grün — NICHT mit sleep-Schleifen pollern
gh pr merge <nr> --merge --delete-branch \
  --subject "$(gh pr view <nr> --json title -q .title)"   # Self-Merge zulässig (Solo-Projekt)
```

- **Auto-Merge-Standard:** PRs mit belegten lokalen Gates werden mit
  `gh pr merge --auto --merge --delete-branch --subject …` eingestellt —
  GitHub wartet auf grünes `verify` (`check:commits`,
  [`docs/commit-notation.md`](../../../docs/commit-notation.md)).
- Status: `gh pr view <nr>`, `gh pr checks <nr>`; roter Lauf →
  [`docs/ci-runbook.md`](../../../docs/ci-runbook.md) (`gh run view --log-failed`).
- Branch-Protection auf `main` verlangt die CI-Checks; `gh pr merge`
  scheitert, solange sie rot oder ausstehend sind — nicht mit
  Admin-Override umgehen.
- **Warten ist Produktivzeit:** `gh pr checks --watch` kehrt zurück, sobald
  `verify` grün wird; `sleep`-Schleifen sind der Fehler, nicht die Vorsicht.
- Body: Warum, Testplan, Issue-Link (`Fixes #<nr>` — Pflicht für jeden
  Defekt-PR, auch Epic-Task-PRs; Standard `docs/issues.md`).

### 4.1 PR-Pipeline — CI überlappt die nächste Aufgabe (Standard)

1. **Push + PR öffnen, dann sofort weiterarbeiten** — nächste Aufgabe, eigener
   Branch. CI nicht-blockierend abfragen (`gh pr checks`); `--watch` nur wenn
   *dieser* Merge jetzt gebraucht wird; niemals `sleep`-Schleifen.
2. **Merges en bloc:** mehrere grüne PRs nacheinander mergen, danach **ein**
   Live-Zweig-Merge, **ein** Frontend-Bau, **höchstens ein** Hub-Neustart pro
   Stapel (Rezept: Skill `ancientvoid-live-hub`).
3. **Was „fertig" heißen darf:** lokal verifizierte Tests **+ grüner Gate** =
   abgeschlossen. „Code fertig, CI läuft" ist ein ehrlicher Zwischenstand.
4. **Ohne grünen Gate wird nicht gemerged** (Ruleset `main-gate`).

### 5. Post-Merge Cleanup (Pflicht nach jedem Merge)

```bash
git checkout main && git pull && git branch -d feat/mein-feature
git push origin --delete feat/mein-feature 2>/dev/null || true
git fetch --prune
```

Ohne diesen Schritt bleiben lokale und stale Remote-Tracking-Branches liegen.

### 6. Branch-Hygiene (laufend)

- **PR-Ziel = `main`**, außer bei einer bewusst kurzen Epic-Kette (Stacked
  PRs) — muss zeitnah nach `main`, sonst driftet `main`.
- Draft-PRs ohne Fortschritt schließen; Unique-Commits ohne PR entweder PR
  öffnen oder Branch löschen (kein „vielleicht später"-Friedhof).
- `ancientvoid/*`-Worktrees gehören zum Hub-Session-Lifecycle — nicht mit
  `git branch -D` wegräumen, solange die Session lebt.
- Periodisch: `git branch -a`, alles ohne offenen PR und ohne Commits vor
  `main` löschen. Regelquelle: `CONTRIBUTING.md` § Branches and pull requests.

## Output-Format

```text
Branch: <name oder „nicht angelegt, keine Anweisung">
Commit: <subject>
PR: <url oder Entwurf>
Checks: npm test / lint / typecheck <ok|pending> · CI (gh pr checks) <grün|rot: Ursache|pending>
Cleanup: post-merge lokal+remote (+ fetch --prune) <done|pending|n/a>
```

## Determinismus-Checkliste

- [ ] Branch-Schema `feat/*` · `fix/*` · `docs/*`, ein Branch pro Aufgabe;
      kein Branch für nicht angewiesene Arbeit.
- [ ] Pre-Commit-Bezug konkret (`npm test/lint/typecheck`, nicht „irgendwelche Checks").
- [ ] Merge nur über `gh pr merge --merge`/UI; bei Remote-Ausfall: Branch
      offen und ungelöscht, Block klar benannt.
- [ ] CI nicht blockierend abgewartet, außer der Merge wird sofort benötigt;
      Merges und Deployment en bloc.
- [ ] Nach Merge: Source-Branch lokal gelöscht, remote nachgezogen, `git fetch --prune`.
- [ ] PR zielt auf `main` (oder dokumentierte kurze Epic-Kette).

## Verweise

- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)
- [`gates`](../gates/SKILL.md)
- [`bugfix`](../bugfix/SKILL.md)
