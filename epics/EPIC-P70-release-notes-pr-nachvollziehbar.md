# EPIC-P70 — Release-Notes: pro PR nachvollziehen, was geändert wurde und warum

**Status:** in Umsetzung — T70.1–T70.5 umgesetzt (18.11.2026, Belege unten); T70.6 Abschluss (Gate/CI auf dem Abschluss-PR, AC-Bilanz) offen · **Phase:** P70 · **Dauer:** 2–3 Agenten-Tage · **Abhängigkeit:** keine blockierende — Quer-Epic wie P58–P67; P67 (höchste laufende Phase) ist umgesetzt (T67.1–T67.9 auf main, PRs #149/#151–#158, alle `verify`-grün; offen bleibt allein T67.10-Abnahme als **Nutzeraufgabe**, die P70 nicht berührt — keine gemeinsamen Codeflächen). P30/P31 bleiben On hold und unberührt.

Quelle: Nutzerauftrag vom 18.11.2026 — „eine Release-Notes-Ansicht, die pro PR
nachvollziehbar zeigt, was geändert wurde und warum — mit klappbaren Details, so dass
je PR kurz und präzise herauslesbar ist, was passiert ist.“ Änderungen sollen ohne
Blick in Git/CI nachvollziehbar sein.

## 1. Ziel

Eine Release-Notes-Seite in der PWA, die aus dem **lokalen Git-Verlauf** eines Projekts
die gemergten PRs chronologisch auflistet: je PR eine Kurzfassung aus der
Commit-Notation (`<Risiko> <Absicht> <bereich>: <Satz>`,
[docs/commit-notation.md](../docs/commit-notation.md)), per Aufklappen die Details —
**Was** (Branch-Commits mit eigener Notation, geänderte Dateien, ±Zeilen) und **Warum**
(PR-Beschreibung aus dem Merge-Commit-Body, Commit-Bodies). Kein Netzwerk, keine
GitHub-API — der Hub liest nur das Repo, das er ohnehin überwacht.

## 2. Scope (In / Out)

### In

- **ADR-0093 + Contracts vor Code** (Regel 1): Typen und Caps in
  `packages/contracts/src/release-notes/` — Notation, Listen-Eintrag, Detail.
- **Core-Builder** `packages/core/src/modules/release-notes/`:
  Commit-Notation-Parser (fail loud bei Subjects ohne Notation) und
  `buildReleaseNotes`/`buildReleaseNotesDetail` über echte `git`-Aufrufe
  (Merge-Commits auf `--first-parent` = PRs; Branch-Commits als `P1..P2`-Range).
- **Hub-Routen** `apps/hub/src/modules/release-notes/release-notes.routes.ts`:
  `GET /api/release-notes` (Liste, klein) und `GET /api/release-notes/detail`
  (je PR, on demand) — Zielwahl `session=`/`project=` wie ADR-0071 (Git-Graph),
  projectRoots-Guard, Bearer-Auth.
- **PWA-Seite** `#/releasenotes` (`apps/pwa/src/features/release-notes/`):
  Projekt-Wahl (gerätelokal gepinnt wie GitLayer), chronologische PR-Liste mit
  Kurzfassung, klappbare Details je PR mit Was/Warum, lazy geladen.
- **Erreichbarkeit**: Dock-„Mehr“-Eintrag, Zeilen im Guide-Inventar und
  Funktionsinventar, E2E-Spec `e2e/specs/release-notes.spec.ts`.

### Out

- **GitHub-/GitLab-API** (PR-Metadaten, Reviews, CI-Status): Netzwerkabhängig,
  bricht Offline (K10-Geist); Forge (EPIC-P37) ist dafür die bestehende Fläche.
- **Release-Tags/Versionen** (Schnitte „was kam in vN“), Changelog-Export (Markdown-Datei).
- **Diff-Inhalte** pro Datei (die hat die Diff-Ansicht; hier reicht name-status + ±Zeilen).
- **Fleet-Host-Targets** auf der Seite (lokaler Hub zuerst; GitLayer zeigt, wie man
  das später erweitern würde).
- Direkte Pushes auf `main` ohne PR (per `git-workflow` verboten außer
  Bootstrap-Ausnahme) — unsichtbar in dieser Ansicht, bewusst.

## 3. Design-Details

### Datenquelle: lokaler Verlauf, Merge-Commits sind die PRs

Real am eigenen Verlauf verifiziert (18.11.2026, PRs #158/#159): GitHub schreibt beim
`gh pr merge --merge` den **PR-Titel als Subject des Merge-Commits**, mit ` (#N)` am
Ende; der **Body des Merge-Commits ist die PR-Beschreibung** („Was der PR ändert“,
„Verify (Beleg)“, „Einordnung“) — also genau das gesuchte Warum. Der Merge-Commit hat
zwei Parents: `P1` = vorheriger Hauptstrand, `P2` = Branch-Spitze; `git log P1..P2`
liefert die Branch-Commits mit ihrer **eigenen** Notation und ihren Bodies
(„eine Verhaltensänderung pro Commit“ bleibt so sichtbar). `git log --first-parent
--merges --shortstat` liefert Subject, Body, Parents **und** ±Zeilen in einem einzigen
Aufruf (gemessen, Merge-Shortstats werden mit `--first-parent` ausgegeben).

Nicht jedes PR-Subject folgt der Notation (real: BUG-0211s Titel in PR #150) — der
Parser markiert `unparsed` und die UI zeigt das Subject roh mit Hinweis. **Niemals
filtern** (Regel 6, Fail loud).

### Zwei Routen statt einer (K5-Geist)

PR-Bodies sind réel 1–4 KB groß; 50 PRs × Body in einer Antwort wäre Hunderte KB. Deshalb:

- `GET /api/release-notes?project=…` → **Liste**: Kurzfassung (Notation, PR-Nummer,
  Datum, Stats aus dem Shortstat). Ein `git log`-Aufruf, Antwort im zweistelligen
  KB-Bereich.
- `GET /api/release-notes/detail?project=…&merge=<sha>` → **Detail**: PR-Body,
  Branch-Commits (Bodies), Dateien (name-status). Wird erst beim ersten Aufklappen
  geladen und im Client gecacht.

REST wie ADR-0078 (AiMetrics) — keine EventBus-Payloads. Caps ehrlich:
`RELEASE_NOTES_MAX_ENTRIES` (50), `MAX_COMMITS` (50), `MAX_FILES` (60), `BODY_CAP`
(8 000 Zeichen) mit `truncated`-Flags statt stiller Kappung.

### Zielwahl und ehrliche Ausschnitte

`session=`/`project=` exakt wie `git-graph` (ADR-0071): Session-Worktrees zeigen die
PRs **bis zum Branch-Punkt** (sie verzweigen von main) — die UI nennt das am
Session-Target; `project=` auf dem Haupt-Checkout ist der Regelfall. Kein Repo, leerer
Verlauf, keine gemergten PRs → benannte Meldung (`error`/Empty-State), kein
Still-Fallback (Regel 6).

### PWA-Oberfläche

Seite `#/releasenotes` (ListPage „releasenotes“): am Handy über Dock → „Mehr“, am PC
Werkzeugseite in der Detailspalte (EPIC-P34 T34.2-Muster wie Statistik/Metrik).
Projekt-Auswahl gerätelokal gepinnt (localStorage, versioniert — Muster `git-model.ts`,
keine neue Session-Wahrheit). Karten: PR-Nummer, Risiko-/Absicht-Badges, Bereich,
Datum, „N Dateien · +X · −Y“, Kurzsatz. Aufklappen (44-px-Ziel, P63-Regel): PR-Beschreibung
und Commit-Bodies über den bestehenden Markdown-Baustein (`shared/Markdown.tsx`,
BUG-0067: text-only, nie `innerHTML`), darunter Commit-Liste und Dateien.

## 4. Aufgaben (Checkliste T70.n)

- [x] **T70.1** ADR-0093 (`docs/adr/0093-release-notes-aus-git-verlauf.md`) und
  Contracts (`packages/contracts/src/release-notes/release-notes.ts` + Export):
  `CommitNotation`, `ReleaseNotesEntry`, `ReleaseNotesListReport`,
  `ReleaseNotesDetail`, `ReleaseNotesStats`, vier Caps. **Vor dem Code** (Regel 1).
  Messlatte: **K5** (Antwortgrößen gekappt, REST statt Events).
- [x] **T70.2** Core: `parseCommitNotation` (Notation + `(#N)`-PR-Nummer, `unparsed`
  fail loud) und `buildReleaseNotes`/`buildReleaseNotesDetail` über `execFile("git")`
  mit Timeout; Unit-Tests gegen ein echtes Temp-Repo mit Notations-Commits und
  `--no-ff`-Merges (rot ohne den Builder). Messlatte: **K5**.
- [x] **T70.3** Hub-Routen `GET /api/release-notes[/detail]` mit
  `session=`/`project=`, projectRoots-Guard (422), 400 ohne Param, Bearer (401),
  404 bei unbekanntem Merge-SHA; Integrationstest nach Vorbild
  `git-graph.integration.test.ts`. Messlatte: **K5**; read-only, kein Takt — Loadtest
  K8 unberührt.
- [x] **T70.4** PWA-Seite `#/releasenotes`: Projekt-Wahl, chronologische Liste,
  klappbare Details (Was/Warum), lazy Detail-Fetch + Client-Cache, Fehler/Leer-Benennung.
  Unit-Test für Modell (Labels, Persistenz). Messlatten: **K10** (Fehler/leer sichtbar
  benannt, kein White-Screen), **K5** (Liste klein, Detail on demand).
- [x] **T70.5** Erreichbarkeit + Inventare: Dock-„Mehr“-Eintrag,
  `docs/guide/inventory.md` (page + feature — sonst rot, AC-P62-1),
  `docs/funktionsinventar.md` (nächste freie G-Nummer), E2E-Spec
  `e2e/specs/release-notes.spec.ts` (echtes Hub-Fixture-Projekt mit gebauten
  PR-Merges; rot ohne die Seite).
- [ ] **T70.6** Abschluss: Aufgaben/AC-Bilanz mit Testbelegen hier nachtragen,
  `epics/README.md`-Zeile ziehen, Gates (`npm run gate` lokal grün; GitHub-Actions
  `verify` auf dem Abschluss-PR grün; E2E mit Spec belegt).


### Belege (18.11.2026, T70.1–T70.5)

- **T70.1:** ADR-0093 + Contracts (`packages/contracts/src/release-notes/`, Export
  in beiden `index.ts`) lagen vor dem Code-Commit.
- **T70.2:** `packages/core/test/modules/release-notes/` — **17 Tests grün**
  (notation 9, builder 8) gegen echte Temp-Repos mit `--no-ff`-Merges: Reihenfolge,
  unparsed/PR-Nummer, Shortstat-Zip, `limit`→`truncated`, kein Repo / keine Merges
  benannt, Detail (Body/Commits/Dateien/Stats), 404-Pfade, alle drei Caps ehrlich.
- **T70.3:** `apps/hub/test/modules/release-notes/release-notes.integration.test.ts`
  — **7 Tests grün** (Liste ohne Bodies, Detail, 400/401/404/422, Nicht-Git-Projekt
  200+`error`, `session=`-Worktree).
- **T70.4/T70.5:** PWA-Modell **5 Tests grün**; `guide-inventory.test.ts` **7 grün**
  (war vor der Guide-Sektion rot — Drift in beide Richtungen greift); E2E
  `release-notes.spec.ts` **3 Tests × `--repeat-each=3` = 9 grün** (mobile — desktop
  läuft nur `@desktop`-Specs): Kurzfassung aus Notation, Aufklappen zeigt Warum
  (PR-Body) + Was (Commit mit Body), fail-loud-Badge, Leerzustand benannt.
- **Smoke am echten Verlauf dieses Repos:** Liste lief #159/#158/#157/#155 mit
  korrekter Notation/Stats/Datum; Detail #158 mit PR-Body („## Was der PR ändert“),
  1 Commit, 7 Dateien, +247/−1.
- `lint`, `typecheck` (root+pwa), `check:arch`, `check:context` grün.
- **Korrektur während des Baus:** Slug ist `#/releasenotes` (ohne Bindestrich) —
  `parseAppHash`-Slug-Regex erlaubt nur `[a-z]*`; alle bestehenden Slugs sind
  einwortig, deshalb konsistent angepasst statt der Regex erweitert.

## 5. Acceptance Criteria (AC-P70-k)

1. **AC-P70-1 (Kurzfassung):** Die Seite listet gemergte PRs eines Projekts
   chronologisch (neueste zuerst) mit Kurzfassung aus der Commit-Notation:
   Risiko, Absicht, Bereich, Satz, PR-Nummer, Datum, ±Zeilen/Dateien. Belegt durch
   E2E-Spec + Core-Tests.
2. **AC-P70-2 (Was & Warum aufklappbar):** Je PR sind Details aufklappbar und zeigen
   das **Was** (Branch-Commits mit eigener Notation und Body, geänderte Dateien,
   Stats) und das **Warum** (PR-Beschreibung aus dem Merge-Body). Belegt durch E2E.
3. **AC-P70-3 (Fail loud):** PRs ohne Notation im Subject bleiben sichtbar (roh,
   mit Hinweis), nichts wird gefiltert; Kappungen werden als `truncated` angezeigt.
   Belegt durch Core-Unit-Test.
4. **AC-P70-4 (K5-Geist):** Die Listen-Antwort bleibt klein (keine Bodies); Details
   werden erst aufklappend geladen. Belegt durch Integrationstest (Liste ohne
   Body-Felder) + Core-Test der Caps.
5. **AC-P70-5 (K10-Geist, ehrliche Fehler):** Kein Repo / leerer Verlauf / keine PRs /
   unbekanntes Ziel → benannte Meldung in UI bzw. benannter API-Fehler, kein
   White-Screen, kein Still-Fallback. Belegt durch Core-Test + E2E-Fall „leeres Projekt“.
6. **AC-P70-6 (Absicherung):** Route hinter Bearer (401 ohne); `project=` außerhalb
   der projectRoots → 422; ohne Ziel-Param → 400; unbekannter Merge-SHA → 404.
   Belegt durch Integrationstest.
7. **AC-P70-7 (Erreichbarkeit):** Seite ist über Dock → „Mehr“ erreichbar, hat
   Guide-Inventar- und Funktionsinventar-Zeilen und eine E2E-Spec — sonst rot
   (`guide-inventory.test.ts`, AC-P62-1).

## 6. Premortem (Failure-Modi + Mitigation)

1. **„Die Hälfte der PRs fehlt still“** — Titel ohne Notation (BUG-PRs wie #150)
   würden bei strenger Filterung verschwinden; auch Repos ohne Notationsdisziplin.
   → Parser markiert `unparsed`, UI zeigt roh mit Hinweis; Core-Test mit einem
   Notations- und einem Notations-freien Merge.
2. **„Die Antwort bläht auf und die Seite ruckelt“** — PR-Bodies réel 1–4 KB,
   Commit-Bodies dazu; 50 PRs in einer Antwort wären Hunderte KB. → Zwei Routen
   (Liste/Detail), Caps mit ehrlichen `truncated`-Flags, Lazy-Fetch + Cache im Client.
3. **„GitHub-Format-Annahmen brechen“** — `(#N)`-Suffix oder Merge-Subject-Form kann
   sich ändern (anderes Merge-Tool, Squash, fork-PRs). → PR-Nummer ist optional
   (`null`), Anzeige funktioniert ohne; Parser kennt nur die dokumentierte Notation
   und fällt roh zurück, nie auf Raten.
4. **„Falscher Ausschnitt wirkt wie vollständige History“** — Session-Worktrees
   verzweigen von main; nach dem Branch-Punkt gemergte PRs fehlen dort. → UI nennt am
   Session-Target den Ausschnitt; Regelfall ist `project=`; Epic dokumentiert die
   Grenze (Out: Garantie über Zielwahl hinaus).
5. **„Ein kaputtes Repo blockiert die Seite“** — git-Aufrufe mit Timeout, Fehler
   fließen in `error`-Feld/HTTP-Fehler, die UI zeigt die benannte Meldung — kein
   Hängen, kein White-Screen (K10-Geist).

## 7. Definition of Done

- `npm run gate` lokal grün; GitHub-Actions-Lauf (`verify`) auf dem Abschluss-PR grün
  (rote CI allein wegen Umgebung wird benannt, nie als Pass gezählt —
  `docs/ci-runbook.md`).
- Jede gebaute UI-Funktion hat Spec in `e2e/specs/` (hier: `release-notes.spec.ts`),
  neuer E2E-Spec lief mit `--repeat-each=3` grün.
- Guide-Inventar (`docs/guide/inventory.md`) und Funktionsinventar
  (`docs/funktionsinventar.md`) im selben Commit aktualisiert (AC-P62-1-Gate rot
  sonst).
- Rot-dann-grün für Notation-Parser, Builder, Routen und Modell belegt
  (Unit/Integration), Belege in den Aufgaben notiert.
- Kein TODO ohne Epic-Referenz; Messlatten-Verletzungen als Testfehler sichtbar.
