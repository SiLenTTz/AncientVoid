---
name: git-workflow
description: Commit-Notation (Arlo, docs/commit-notation.md), Branch-Naming feat/fix/docs (ein Branch pro Aufgabe), GitHub-PR via gh, Co-Author-Trailer, Post-Merge Branch-Hygiene. Aktiv bei commit, branch, PR anlegen, Branch-Aufräumen. Merge NUR über gh pr merge/GitHub-UI, nie lokal per git merge nach main. Never force-push, never commit auf main.
---

# Skill: git-workflow

Querschnitts-Regeln: [`CONTRIBUTING.md`](../../../CONTRIBUTING.md). Gates:
[`gates`](../gates/SKILL.md). Review: [`pr-review`](../pr-review/SKILL.md).

## Zweck

Commit, Branch und PR sehen jedes Mal gleich aus. Dieser Skill ist die
ausführbare Form; `CONTRIBUTING.md` bleibt die Regelquelle.

## Wann benutzen (Trigger)

- commit, branch anlegen, PR öffnen, Commit-Notation, Co-Author.

**Nicht:** Epic-Struktur (`epic-creation`); Bugfix-Ablauf (`bugfix`).

## Hard Rules

- ✅ Commit-Notation `<Risiko> <Absicht> <bereich>: <Satz>` —
  [`docs/commit-notation.md`](../../../docs/commit-notation.md). Risiko ehrlich
  nach Beleg: `^` nur mit grünem Gate **und** Tests, die das geänderte
  Verhalten abdecken; nur live belegt → `!`; Zwischenstand → `@` (nie als
  PR-Titel). Eine Verhaltensänderung pro Commit.
- ✅ Branch: `feat/<scope>-<slug>` · `fix/<problem>` · `docs/<scope>` — real
  Konvention aus diesem Repo, granular pro Aufgabe: `feat/p2-t2.5-webauthn`,
  `fix/k7-recovery-race-under-load`, `docs/epic-p0-retro`. Ein
  Task/Bugfix/Doc-Abschluss = ein Branch = ein PR, kein Bündeln mehrerer
  unabhängiger Aufgaben auf einen Branch, außer sie sind so eng gekoppelt
  wie `T1.5-4/T1.5-5` es waren.
- ✅ Co-Author-Trailer bei KI-Commits.
- ✅ AI **never** invents scope beyond what wurde angewiesen — aber unter
  einer stehenden Anweisung, eine bestimmte Aufgabe/ein bestimmtes Epic
  autonom durchzuarbeiten, ist das Anlegen **eines Branches pro Aufgabe**
  genau das, was diese Anweisung verlangt (siehe Kadenz-Tabelle) — das ist
  keine zweite, separate Anweisung wert. „Ohne Anweisung" heißt: keine
  Branches für Arbeit, die niemand verlangt hat, nicht „für jede einzelne
  Aufgabe erst nachfragen".
- ✅ **Der einzige Ort, an dem ein Feature-/Fix-/Docs-Branch mit `main`
  zusammengeführt wird, ist der Pull Request auf GitHub** (`gh pr merge`
  oder Klick im UI) — niemals ein lokales `git merge`/`git merge --ff-only` von
  `feat/*` nach `main`. Ein lokaler Merge ist kein Ersatz für Push+PR, egal
  wie sicher der Code ist, egal wie dringend die Arbeit „ankommen" soll.
  **Das war 2026-09-18 real der Fehler**, der zu dieser Regel geführt hat:
  mehrere Feature-Branches wurden lokal per `git merge --ff-only` nach
  `main` gezogen und sofort per `git branch -d` gelöscht — real getestet,
  real committet, aber ohne jede MR-/Branch-Spur (damals GitLab), sobald
  der Branch weg war.
  Sah aus wie direktes Arbeiten auf `main`, obwohl technisch kurz ein
  Branch existiert hatte.
- ✅ **Remote nicht erreichbar (z. B. Forge-Ausfall) ist kein Grund, den
  Merge lokal nachzubauen.** Branch bleibt offen, ungemerged, ungelöscht.
  Weiterarbeiten auf dem nächsten Branch ist erlaubt (er baut auf dem
  vorigen auf, exakt wie bei einer normal laufenden PR-Kette) — aber
  `main` bewegt sich nicht, bis der PR real gemerged werden kann. Push
  regelmäßig neu versuchen; sobald erreichbar: jeden Branch einzeln pushen,
  PR öffnen, mergen (`gh pr merge`), `git pull`, nächster Branch.
- ❌ Never force-push, never rewrite published history, never commit auf `main`.
- ❌ **Never** `git merge`/`git rebase` von einem Feature-Branch auf `main`
  als Ersatz für einen echten PR — auch nicht „nur lokal, wird ja eh
  gepusht". Auch nicht bei Selbst-Merge (Solo-Projekt erlaubt Self-Merge
  des PRs, nicht das Überspringen des PRs selbst).
- ❌ Never `--no-verify`.
- ✅ Nach jedem Merge: Source-Branch lokal löschen, remote nachziehen,
  `git fetch --prune`. Gemergte Branches nicht als Archiv liegen lassen —
  der PR ist der Log.
- ✅ PR-Ziel ist `main`. Lange Integrations-Branches nur als kurze
  Epic-Kette, die zeitnah nach `main` kommt (sonst driftet `main`).

## Kadenz — wann commit, wann push, wann PR (deterministisch)

Diese Momente sind fest, keine Ermessenssache:

| Ereignis | Aktion |
|---|---|
| Task/Aufgabe (`T<n>.<m>`) einer Epic abgeschlossen | commit (lokal, auf dem laufenden `feat/`-Branch) |
| Bugfix abgeschlossen (`bugfix`-Skill, Finalize) | commit **+ push + PR** (`gh pr create`) |
| Epic abgeschlossen (alle AC grün, `retro` gelaufen) | commit **+ push + PR** für den Epic-/Feature-Branch nach `main` |
| Vor jedem Abschluss-Commit eines Epics: Statuszeile, Checkboxen und `epics/README.md` auf echten Stand bringen — `npm run check:epics` muss grün sein | Pflicht-Schritt der Kadenz, kein Ermessen |

Solo-Projekt, kein zweiter Reviewer: Self-Merge des eigenen PRs ist zulässig.
Der "Nicht self-merge"-Grundsatz aus [`pr-review`](../pr-review/SKILL.md)
gilt der fachlichen Prüfung (PR-Beschreibung nennt Repro/Root-cause/
Testplan, lokale Gates und GitHub-Actions-CI sind grün) — nicht einem
erzwungenen zweiten Menschen. Der PR bleibt trotzdem Pflicht: sie ist der Log-Eintrag der Historie, nicht die
Freigabe.

**Ausnahme:** Die ersten Commits (Kaltstart, initiale Tooling-Übernahme aus
custom-rag) gingen einmalig direkt auf `main`, bevor diese Kadenz-Regel
existierte. Ab hier gilt sie ausnahmslos — auch für kleine Fixes.

## Phasen/Prozess

### 1. Branch

```bash
git checkout -b feat/adapter-local-llm
```

Kein Push direkt auf `main`. Ein Branch pro Aufgabe (siehe Hard Rules oben
für die Granularität) — unter einer stehenden Autonomie-Anweisung für eine
Aufgabe/ein Epic ist das Anlegen dieses Branches bereits durch diese
Anweisung gedeckt.

### 2. Pre-Commit Checks

Dieselben Gates wie [`gates`](../gates/SKILL.md): `npm test && npm run lint
&& npm run typecheck`. Einziger lokaler Hook ist `.githooks/commit-msg`
(Commit-Notation, von `npm install` eingerichtet); `npm run gate` prüft
zusätzlich alle Commits des Branches (`check:commits`); der `pre-push`-Hook
erzwingt Lint und Typecheck.

### 3. Commit

```text
^ F adapter-local-llm: Stream des llama.cpp-Servers lesen

^ B eventstore: harter Neustart verliert keine Tail-Events (BUG-0003)

. d adr: Kontext für den Swarm-Adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

Zusammenfassung ≤ 100 Zeichen, Bereich = Paket/Modul. Keine Secrets.

### 4. PR (GitHub) — push, öffnen, CI abwarten, mergen

```bash
git push -u origin feat/adapter-local-llm
gh pr create --base main --title "^ F adapter-local-llm: Stream des llama.cpp-Servers lesen" --body-file pr-desc.md
gh pr checks --watch                       # blockiert bis grün — NICHT mit sleep-Schleifen pollern
gh pr merge <nr> --merge --delete-branch \
  --subject "$(gh pr view <nr> --json title -q .title)"   # Self-Merge zulässig (Solo-Projekt)

# Vor dem Warten absichern, dass Push und PR wirklich existieren:
git ls-remote --heads origin <branch>          # Push bewiesen (nicht aus dem Ausgang annehmen)
gh pr create … | rg -o "pull/[0-9]+"          # PR-Nummer abnehmen; ohne Nummer nicht pollen
```

- **Auto-Merge-Standard (seit 2026-11-18, Nutzerauftrag; PR #169 stellte ihn ein,
  sein `verify` wurde nachträglich grün; Ruleset-Bedingung auf `main` seither gesetzt):**
  PRs mit belegten lokalen Gates werden mit `gh pr merge --auto --merge
  --delete-branch --subject …` eingestellt — GitHub wartet auf grünes `verify`
  (`check:commits`, [`docs/commit-notation.md`](../../../docs/commit-notation.md)).
- `--body-file` nimmt eine vorbereitete Beschreibungsdatei (alternativ
  `--body "$(cat …)"`); die Vorlage liegt in `.github/pull_request_template.md`.
- Status: `gh pr view <nr>`, `gh pr checks <nr>`; roter Lauf →
  [`docs/ci-runbook.md`](../../../docs/ci-runbook.md) (`gh run view --log-failed`).
- Branch-Protection auf `main` verlangt die CI-Checks; `gh pr merge` scheitert,
  solange sie rot oder ausstehend sind — nicht mit Admin-Override umgehen.
- **Warten ist Produktivzeit:** das Ruleset `main-gate` verlangt `verify`, darum bleibt
  Warten unvermeidbar — aber es ist das bewachte Warten: `gh pr checks --watch` kehrt in
  dem Augenblick zurück, in dem `verify` grün wird (Schleifen mit `sleep 25/85` kosten pro
  PR 25–90 s und sind der Fehler, nicht die Vorsicht). Gemessene Gate-Länge nach der
  Tempobeschleunigung (PR #131/#134/#135/#136/#137): 3:41 → 2:12; Ausgangslage war 5:14.

Body: Warum, Testplan, Link Issue (`Fixes #<nr>` — Pflicht für jeden Defekt-PR, auch Epic-Task-PRs; Standard `docs/issues.md`). Der PR bleibt Pflicht als
Log-Eintrag — der Merge-Klick/`gh pr merge` ist der **einzige** Weg, wie
Inhalt von einem Branch nach `main` kommt (siehe Hard Rules).

**Wenn `git push` fehlschlägt (Remote nicht erreichbar):** nicht auf einen
lokalen Merge ausweichen. Branch bleibt offen und ungelöscht; Push in
angemessenem Abstand erneut versuchen; bei mehreren wartenden Branches
strikt in Entstehungsreihenfolge pushen/mergen (sie bauen aufeinander auf).
Dem Nutzer den Block klar benennen, nicht stillschweigend eine
Ersatzlösung bauen.

### 4.1 PR-Pipeline — CI überlappt die nächste Aufgabe (Standard)

Der Gate läuft gemessen 2:12–2:40 (`docs/ci-runbook.md`, Messreihe in `PROGRESS.md`).
Ihn blockierend abzuwarten verschenkt pro Aufgabe genau diese Zeit. Standard ist deshalb:

1. **Push + PR öffnen, dann sofort weiterarbeiten** — nächste Aufgabe, eigener Branch (ein
   Branch pro Aufgabe, siehe Hard Rules). CI-Zustand bei Bedarf nicht-blockierend abfragen
   (`gh pr checks <nr>`); blockierend mit `--watch` nur dann, wenn *dieser* Merge jetzt
   gebraucht wird. Niemals mit `sleep`-Schleifen pollern.
2. **Merges en bloc:** sind mehrere PRs grün, werden sie nacheinander gemerged, danach **ein**
   Live-Zweig-Merge, **ein** Frontend-Bau und **höchstens ein** Hub-Neustart für den ganzen
   Stapel (Neustarts mitten im Nutzer-Turn stören Kai; Rezept: Skill `ancientvoid-live-hub`).
3. **Was „fertig“ heißen darf:** lokal verifizierte Tests **+ grüner Gate** = abgeschlossen.
   „Code fertig, CI läuft“ ist ein ehrlicher Zwischenstand, keine Fertigmeldung — so benennen
   (AGENTS: fertig heißt verifiziert).
4. **Ohne grünen Gate wird nicht gemerged.** Das Ruleset `main-gate` erzwingt `verify` derzeit
   nicht (leere Targets; gemessen 2026-11-17: ein PR wurde gemerged, sein CI-Lauf lief drei
   Sekunden) — bis die Ruleset-Bedingungen gefüllt sind, ist diese Regel die einzige Schranke.

### 5. Post-Merge Cleanup (Pflicht nach jedem Merge)

```bash
# Lokal
git checkout main
git pull
git branch -d feat/mein-feature

# Remote (gh pr merge --delete-branch erledigt das meist schon)
git push origin --delete feat/mein-feature 2>/dev/null || true
git fetch --prune
```

Ohne diesen Schritt bleiben lokale und stale Remote-Tracking-Branches liegen —
das war der Hauptgrund für den Branch-Wildwuchs vor der Hygiene-Regel.

### 6. Branch-Hygiene (laufend)

- **PR-Ziel = `main`**, außer bei einer bewusst kurzen Epic-Kette
  (Stacked PRs). Eine Integrations-Branch wie `feat/p12-…` darf existieren,
  muss aber zeitnah nach `main` gemerged werden — sonst driftet `main` und
  die Historie wirkt „fertig“, obwohl nichts auf `main` liegt.
- Nach Merge eines Side-Branches in die Kette: denselben Cleanup wie oben
  (Source-Branch weg).
- Draft-PRs ohne Fortschritt schließen; Unique-Commits ohne PR entweder PR
  öffnen oder Branch löschen (kein „vielleicht später“-Friedhof).
- `ancientvoid/*`-Worktrees gehören zum Hub-Session-Lifecycle, nicht zur
  Feature-Branch-Liste — nicht mit `git branch -D` wegräumen, solange die
  Session lebt.
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

- [ ] Branch-Schema `feat/*` · `fix/*` · `docs/*`, ein Branch pro Aufgabe.
- [ ] Kein Branch für nicht angewiesene Arbeit.
- [ ] Pre-Commit-Bezug konkret (`npm test/lint/typecheck`, nicht „irgendwelche Checks").
- [ ] Merge ausschließlich über `gh pr merge --merge` (oder GitHub-UI) — kein lokales `git merge` von `feat/*` nach `main`.
- [ ] CI nicht blockierend abgewartet, außer der Merge wird sofort benötigt; Merges und
      Deployment en bloc (ein Live-Merge, ein Bau, höchstens ein Neustart pro Stapel).
- [ ] Bei Remote-Ausfall: Branch offen und ungelöscht, kein Ersatz-Merge, Block klar benannt.
- [ ] Nach Merge: Source-Branch lokal gelöscht, remote nachgezogen, `git fetch --prune`.
- [ ] PR zielt auf `main` (oder dokumentierte kurze Epic-Kette, die bald auf `main` landet).

## Verweise

- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)
- [`gates`](../gates/SKILL.md)
- [`bugfix`](../bugfix/SKILL.md)
