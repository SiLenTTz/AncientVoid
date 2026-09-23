---
name: git-workflow
description: Commit-Notation (Arlo, docs/commit-notation.md), Branch-Naming feat/fix/docs (ein Branch pro Aufgabe), GitLab-MR via glab, Co-Author-Trailer. Aktiv bei commit, branch, PR/MR anlegen. Merge NUR über glab mr merge/GitLab-UI, nie lokal per git merge nach main. Never force-push, never commit auf main.
---

# Skill: git-workflow

Querschnitts-Regeln: [`CONTRIBUTING.md`](../../../CONTRIBUTING.md). Gates:
[`gates`](../gates/SKILL.md). Review: [`pr-review`](../pr-review/SKILL.md).

## Zweck

Commit, Branch und MR sehen jedes Mal gleich aus. Dieser Skill ist die
ausführbare Form; `CONTRIBUTING.md` bleibt die Regelquelle.

## Wann benutzen (Trigger)

- commit, branch anlegen, MR öffnen, Commit-Notation, Co-Author.

**Nicht:** Epic-Struktur (`epic-creation`); Bugfix-Ablauf (`bugfix`).

## Hard Rules

- ✅ Commit-Notation `<Risiko> <Absicht> <bereich>: <Satz>` —
  [`docs/commit-notation.md`](../../../docs/commit-notation.md). Risiko ehrlich
  nach Beleg: `^` nur mit grünem Gate **und** Tests, die das geänderte
  Verhalten abdecken; nur live belegt → `!`; Zwischenstand → `@` (nie als
  MR-Titel). Eine Verhaltensänderung pro Commit.
- ✅ Branch: `feat/<scope>-<slug>` · `fix/<problem>` · `docs/<scope>` — real
  Konvention aus diesem Repo, granular pro Aufgabe: `feat/p2-t2.5-webauthn`,
  `fix/k7-recovery-race-under-load`, `docs/epic-p0-retro`. Ein
  Task/Bugfix/Doc-Abschluss = ein Branch = ein MR, kein Bündeln mehrerer
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
  zusammengeführt wird, ist die MR auf GitLab** (`glab mr merge` oder Klick
  im UI) — niemals ein lokales `git merge`/`git merge --ff-only` von
  `feat/*` nach `main`. Ein lokaler Merge ist kein Ersatz für Push+MR, egal
  wie sicher der Code ist, egal wie dringend die Arbeit „ankommen" soll.
  **Das war 2026-09-18 real der Fehler**, der zu dieser Regel geführt hat:
  mehrere Feature-Branches wurden lokal per `git merge --ff-only` nach
  `main` gezogen und sofort per `git branch -d` gelöscht — real getestet,
  real committet, aber ohne jede MR/Branch-Spur, sobald der Branch weg war.
  Sah aus wie direktes Arbeiten auf `main`, obwohl technisch kurz ein
  Branch existiert hatte.
- ✅ **Remote nicht erreichbar (z. B. Gitaly-Ausfall) ist kein Grund, den
  Merge lokal nachzubauen.** Branch bleibt offen, ungemerged, ungelöscht.
  Weiterarbeiten auf dem nächsten Branch ist erlaubt (er baut auf dem
  vorigen auf, exakt wie bei einer normal laufenden MR-Kette) — aber
  `main` bewegt sich nicht, bis die MR real gemerged werden kann. Push
  regelmäßig neu versuchen; sobald erreichbar: jeden Branch einzeln pushen,
  MR öffnen, mergen (`glab mr merge`), `git pull`, nächster Branch.
- ❌ Never force-push, never rewrite published history, never commit auf `main`.
- ❌ **Never** `git merge`/`git rebase` von einem Feature-Branch auf `main`
  als Ersatz für eine echte MR — auch nicht „nur lokal, wird ja eh
  gepusht". Auch nicht bei Selbst-Merge (Solo-Projekt erlaubt Self-Merge
  der MR, nicht das Überspringen der MR selbst).
- ❌ Never `--no-verify`.

## Kadenz — wann commit, wann push, wann MR (deterministisch)

Diese Momente sind fest, keine Ermessenssache:

| Ereignis | Aktion |
|---|---|
| Task/Aufgabe (`T<n>.<m>`) einer Epic abgeschlossen | commit (lokal, auf dem laufenden `feat/`-Branch) |
| Bugfix abgeschlossen (`bugfix`-Skill, Finalize) | commit **+ push + MR** (`glab mr create`) |
| Epic abgeschlossen (alle AC grün, `retro` gelaufen) | commit **+ push + MR** für den Epic-/Feature-Branch nach `main` |

Solo-Projekt, kein zweiter Reviewer: Self-Merge der eigenen MR ist zulässig.
Der "Nicht self-merge"-Grundsatz aus [`pr-review`](../pr-review/SKILL.md)
gilt der fachlichen Prüfung (MR-Beschreibung nennt Repro/Root-cause/
Testplan, Gates sind grün) — nicht einem erzwungenen zweiten Menschen. Die
MR bleibt trotzdem Pflicht: sie ist der Log-Eintrag der Historie, nicht die
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
zusätzlich alle Commits des Branches (`check:commits`).

### 3. Commit

```text
^ F adapter-local-llm: Stream des llama.cpp-Servers lesen

^ B eventstore: harter Neustart verliert keine Tail-Events (BUG-0003)

. d adr: Kontext für den Swarm-Adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

Zusammenfassung ≤ 100 Zeichen, Bereich = Paket/Modul. Keine Secrets.

### 4. MR (GitLab) — push, öffnen, mergen, in dieser Reihenfolge

```bash
git push -u origin feat/adapter-local-llm
glab mr create --title "^ F adapter-local-llm: Stream des llama.cpp-Servers lesen" --description "$(cat mr-desc.md)"
glab mr merge <mr-number> --yes   # Self-Merge zulässig (Solo-Projekt, siehe Kadenz oben)
```

**Real, live geprüft (2026-09-18):** `glab mr create` hat kein
`--description-file` — der echte Flag ist `-d`/`--description` und nimmt
den Text direkt (nicht einen Dateipfad); `$(cat mr-desc.md)` liefert den
Inhalt einer vorbereiteten Beschreibungsdatei trotzdem sauber ein.
`glab mr merge` ohne `--yes` fragt interaktiv nach.

Body: Warum, Testplan, Link Issue. Die MR bleibt trotzdem Pflicht als
Log-Eintrag — der Merge-Klick/`glab mr merge` ist der **einzige** Weg, wie
Inhalt von einem Branch nach `main` kommt (siehe Hard Rules).

**Wenn `git push` fehlschlägt (Remote nicht erreichbar):** nicht auf einen
lokalen Merge ausweichen. Branch bleibt offen und ungelöscht; Push in
angemessenem Abstand erneut versuchen; bei mehreren wartenden Branches
strikt in Entstehungsreihenfolge pushen/mergen (sie bauen aufeinander auf).
Dem Nutzer den Block klar benennen, nicht stillschweigend eine
Ersatzlösung bauen.

### 5. Post-Merge Cleanup (Pflicht nach jedem Merge)

```bash
# Lokal
git checkout main
git pull
git branch -d feat/mein-feature

# Remote
git push origin --delete feat/mein-feature
```

## Output-Format

```text
Branch: <name oder „nicht angelegt, keine Anweisung">
Commit: <subject>
MR: <url oder Entwurf>
Checks: npm test / lint / typecheck <ok|pending>
```

## Determinismus-Checkliste

- [ ] Branch-Schema `feat/*` · `fix/*` · `docs/*`, ein Branch pro Aufgabe.
- [ ] Kein Branch für nicht angewiesene Arbeit.
- [ ] Pre-Commit-Bezug konkret (`npm test/lint/typecheck`, nicht „irgendwelche Checks").
- [ ] Merge ausschließlich über `glab mr merge` (oder GitLab-UI) — kein lokales `git merge` von `feat/*` nach `main`.
- [ ] Bei Remote-Ausfall: Branch offen und ungelöscht, kein Ersatz-Merge, Block klar benannt.

## Verweise

- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)
- [`gates`](../gates/SKILL.md)
- [`bugfix`](../bugfix/SKILL.md)
