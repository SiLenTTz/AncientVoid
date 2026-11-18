# ADR-0093: Release-Notes aus dem lokalen Git-Verlauf — Merge-Commits als PRs, Commit-Notation als Struktur

Status: akzeptiert (2026-11-18)

## Kontext

Nutzerauftrag vom 18.11.2026: pro PR nachvollziehbar zeigen, was geändert wurde und
warum — ohne Blick in Git/CI. Das Repo führt seine Disziplin in zwei Formen, die
bislang nur mit `git log` lesbar sind: die Commit-Notation
(`docs/commit-notation.md`, `<Risiko> <Absicht> <bereich>: <Satz>`) und PR-Beschrei-
bungen, die GitHub als Body des Merge-Commits ablegt. Real verifiziert am eigenen
Verlauf (PRs #158/#159): Merge-Subject = PR-Titel + ` (#N)`; Merge-Body =
PR-Beschreibung („Was der PR ändert“, „Verify (Beleg)“); Branch-Commits bleiben per
`--no-ff`-Merge erhalten und tragen ihre eigene Notation. Aufgabenkatalog:
`epics/EPIC-P70-release-notes-pr-nachvollziehbar.md`.

## Entscheidung

**1. Lokales Git ist die einzige Datenquelle — kein Forge-/GitHub-API-Aufruf.**
Release Notes sind eine Lese-Ansicht über dem Repo, das der Hub ohnehin überwacht;
Netzwerkabhängigkeit bräche Offline-Nutzung (K10-Geist) und bräuchte Auth/Rate-Limits.
PR-Metadaten jenseits des Verlaufs (Reviews, CI) bleiben Forge-Sache (ADR-0056).

**2. Contract vor Code, rein additiv (`packages/contracts/src/release-notes/`).**
`CommitNotation` (`raw`, `risk`, `intent`, `area`, `summary`, `prNumber`,
`unparsed`), `ReleaseNotesEntry`/`ReleaseNotesListReport` (Liste ohne Bodies),
`ReleaseNotesDetail` (Body, Commits, Dateien, Stats) und vier Caps:
`RELEASE_NOTES_MAX_ENTRIES = 50`, `MAX_COMMITS = 50`, `MAX_FILES = 60`,
`BODY_CAP = 8 000` — Überschreitung immer mit `truncated`-Flag, nie still.
Interfaces wie ADR-0071 (Git-Graph), kein Zod — es gibt keinen Schreibpfad und kein
Peer-Merging (anders als ADR-0078).

**3. Fail loud statt Filtern.** Nicht jedes Subject folgt der Notation (real: PR #150,
BUG-Titel). `parseCommitNotation` liefert `unparsed: true` und die UI zeigt das rohe
Subject mit Hinweis — nichts wird wegefiltert (Regel 6). Die PR-Nummer `(#N)` ist
optional (`null`), kein Raten bei abweichendem Merge-Format.

**4. Zwei Routen statt einer (K5-Geist).** `GET /api/release-notes?session=|project=`
liefert die Liste (Kurzfassung + Shortstat aus **einem** `git log --first-parent
--merges --shortstat`-Lauf), `GET /api/release-notes/detail?…&merge=<sha>` das Detail
(Body, Commits aus `git log P1..P2`, Dateien aus `git diff --name-status P1 M`).
REST, keine EventBus-Payloads. Zielwahl und Guards exakt wie `git-graph` (ADR-0071):
400 ohne Param, 422 außerhalb projectRoots, Bearer nötig, 404 bei unbekanntem SHA.
Read-only, kein Takt — K8 unberührt.

**5. Ehrlicher Ausschnitt.** Session-Worktrees zeigen PRs nur bis zum Branch-Punkt
(EPIC-P67: Sessions verzweigen von `origin/<Hauptbranch>`); `project=` auf dem
Haupt-Checkout ist der Regelfall. Die UI benennt den Ausschnitt am Session-Target.
Direkte Pushes auf `main` ohne Merge-Commit bleiben unsichtbar (per `git-workflow`
verboten außer Bootstrap-Ausnahme — dokumentierte Lücke, keine stillsche).

**6. PWA-Anzeige über bestehende Bausteine.** Seite `#/releasenotes` als Werkzeugseite
(EPIC-P34 T34.2-Muster), Projekt gerätelokal gepinnt (Muster `git-model.ts`, ADR-0058
§6 — keine neue Session-Wahrheit), Bodies über `shared/Markdown.tsx` (BUG-0067:
text-only, nie `innerHTML`). Details lazy beim Aufklappen, im Client gecacht.

## Konsequenzen

- Plus: Null neue persistente Zustände (K7 unberührt — gelesen wird nur Git);
  offline-tauglich; Disziplin der Commit-Notation wird sichtbar belohnt.
- Plus: Ein einziger git-Lauf für die Liste; Details on demand — Antwortgrößen
  bleiben im Rahmen (K5-Geist, Messlatte AC-P70-4).
- Minus: PR-Nummer/Titel nur, solange per Merge-Commit gemergt wird (kein Squash —
  repo-eigene Regel); Squash-Merges würden als einzelner „PR“ ohne Branch-Commits
  erscheinen.
- Minus: Sehr große PR-Bodies/Commit-Listen werden gekappt (`truncated` sichtbar);
  wer mehr braucht, geht in Git selbst.