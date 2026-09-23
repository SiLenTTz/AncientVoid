# Commit-Notation (Arlo's Commit Notation, angepasst)

Jede Commit-Zusammenfassung und jeder MR-Titel beginnt mit **Risiko** und
**Absicht**, danach Bereich und Satz:

```text
<Risiko> <Absicht> <bereich>: <was sich ändert>
^ F pwa: Einladung als QR-Code anzeigen
. d adr: ADR-0019 ergänzt
! B adapter-claude: Rückfrage nach Neustart beantworten
```

Quelle: [RefactoringCombos/ArlosCommitNotation](https://github.com/RefactoringCombos/ArlosCommitNotation).
Geprüft von `.githooks/commit-msg` (lokal) und `npm run check:commits` (im Gate).

## Risiko — was der Commit belegt

| Zeichen | Stufe | Bei uns heißt das |
|---|---|---|
| `.` | beweisbar sicher | Kein Produktverhalten berührt (nur Doku, nur Tests), oder ein Refactoring per Werkzeug (Umbenennen/Verschieben), das der Typecheck vollständig prüft |
| `^` | geprüft | `npm run gate` grün **und** Tests decken jedes geänderte Verhalten ab (bei `F`/`B`: neuer oder geänderter Test, der ohne die Änderung rot wäre) |
| `!` | riskant | Gate grün, aber mindestens ein Verhalten ist nur live, teilweise oder gar nicht automatisch belegt — im Commit-Text sagen, was |
| `@` | vermutlich kaputt | Gate nicht gelaufen oder rot; Zwischenstand auf einem Branch. Ein MR-Titel ist **nie** `@` |

Ein Commit mit mehr als einer Verhaltensänderung ist höchstens `@` — also
eine Änderung pro Commit.

## Absicht — großgeschrieben ändert Verhalten, klein nicht

| Zeichen | Absicht |
|---|---|
| `F` | Feature: ein Aspekt des Verhaltens neu oder erweitert |
| `B` | Bugfix: ein unerwünschtes Verhalten repariert (Bug-Nummer im Text) |
| `r` | Refactoring: Umsetzung geändert, Verhalten nicht |
| `d` | Doku, ADR, Epic, Messlauf |
| `t` | nur Tests |
| `e` | Umgebung/Tooling (Build, Lint, Hooks, Skripte, CI) |
| `a` | automatisch erzeugt (Formatierung, Lockfile) |
| `m` | Merge (GitLab-Merge-Commit; trägt den MR-Titel) |

## Bereich

Paket oder Modul in Kleinbuchstaben, z. B. `pwa`, `core`, `server`,
`contracts`, `adapter-claude`, `e2e`, `adr`, `epic-p7`. Mehrere Bereiche:
den wichtigsten nennen.

## MR und Merge

Der MR-Titel folgt derselben Form und nennt die Stufe, die das **ganze**
Ergebnis beim Merge belegt (nach dem letzten Gate). Zwischencommits auf dem
Branch dürfen `@` sein. GitLab schreibt den MR-Titel als Zusammenfassung des
Merge-Commits.
