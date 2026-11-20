---
name: retro
description: Evidence-basierte Retro einer abgeschlossenen EPIC-Pn-Phase gegen ihre Acceptance Criteria. Liest die EPIC-Pn-*.md-Datei, git log und Premortem, bewertet jedes AC mit Beleg und haengt Erkenntnisse + Action Items als Abschnitt an die Epic-Datei an. Aktiv bei "Retro", "Retrospektive", Phasen-Abschluss.
---

# Skill: retro

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md). Phasen-Workflow:
[`epic-creation`](../epic-creation/SKILL.md).

## Zweck

Eine Retro, in der **jede Behauptung einen Beleg** hat. Kein Stimmungsbild:
Die Wahrheit liegt in den AC der `EPIC-Pn-*.md`-Datei, im Premortem-Abschnitt
und im git log — die Retro liest sie und stellt Abweichungen fest.

**Abgrenzung:** `gates` misst den aktuellen Stand; `pr-review` prüft einen
Diff. Dieser Skill bewertet eine **abgeschlossene Phase** und mündet in
nachvollziehbaren Action Items.

## Hard Rules

- ✅ Jede Behauptung („AC erfüllt", „klemmte") mit Beleg: Datei:Zeile,
  Commit-Hash oder Testname.
- ✅ Status-Angaben aus der `EPIC-Pn-*.md`-Datei lesen, nicht aus Erinnerung.
- ✅ Jedes Action Item hat eine Zielablage (neue Aufgabe im nächsten Epic
  oder ein neuer ADR-Eintrag) — nicht nur Prosa im Retro-Text.
- ❌ Keine Schuld-Zuweisungen an Personen; nur an Prozesse und Artefakte.
- ❌ Keine neuen Themen ohne Bezug zu einem AC, einem Premortem-Risiko oder
  einem Commit dieser Phase.

## Phasen/Prozess

### 1. Erheben (Evidence sammeln)

```text
epics/EPIC-Pn-*.md      Aufgaben-Checkboxen, AC-Liste, Premortem
git log --oneline <zeitraum-der-phase>   Commits, Dauer
bugs/bug-*.md           während der Phase entstandene Bugs (falls vorhanden)
```

### 2. Bewerten (AK-Matrix)

Für **jedes** AC eine Zeile:

```text
AC-Pn-k: 🟢 erfüllt | 🟡 teilweise | 🔴 offen | ⚪ bewusst fallen gelassen
  Beleg: <Testname | Datei:Zeile | Commit>
  Bemerkung: <ein Satz; bei 🟡/🔴 was fehlt und warum>
```

Ohne Beleg ist die Zeile ungültig — nacharbeiten, nicht abschätzen.

### 3. Erkenntnisse (maximal fünf, mit Beleg)

- Was lief besser als geplant?
- Was klemmte wiederholt?
- Welches Premortem-Risiko trat ein, welches nicht — und warum?

### 4. Action Items

```text
AI-Pn-<n>: <Massnahme> — zurück als: nächste Epic-Aufgabe | ADR | Bug
```

### 5. Ablage

Kein separates Archiv in diesem Repo — Retro-Ergebnis wird als neuer
Abschnitt `## Retro` am Ende der jeweiligen `EPIC-Pn-*.md`-Datei angehängt
(die Datei bleibt so die vollständige Historie einer Phase, inkl. Plan,
Ausführung und Rückblick).

## Output-Format (Zusammenfassung im Chat)

```text
Epic: EPIC-Pn <titel> — <Zeitraum> — <Anzahl Commits>
AK-Matrix: <n> 🟢 / <n> 🟡 / <n> 🔴 / <n> ⚪
Premortem: <n> eingetreten / <n> nicht eingetreten
Erkenntnisse:
  1. <These> — Beleg: <...>
Action Items:
  AI-Pn-1: <...> — zurück als: <...>
Artefakt: epics/EPIC-Pn-*.md ## Retro
```

## Determinismus-Checkliste

- [ ] Jedes AC hat eine bewertete Zeile mit Beleg.
- [ ] Jedes Action Item hat ein Ziel-Artefakt.
- [ ] Retro-Abschnitt hängt an der Epic-Datei, kein neues Dokument.
- [ ] Statuszeile und Checkboxen der Epic-Datei spiegeln den echten Stand
      (Delegationen mit Vermerk nach P000); `npm run check:epics` grün.
- [ ] Lebende Dokumente des Epic-Bereichs (Frischhalte-Map in
      `scripts/check-context.mjs`) geprüft; `npm run check:context` grün.

## Verweise

- [`epic-creation`](../epic-creation/SKILL.md)
- [`pr-review`](../pr-review/SKILL.md)
