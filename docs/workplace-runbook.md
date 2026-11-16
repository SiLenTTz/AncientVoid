# Arbeitsort-Runbook: eigener Worktree oder Projekt direkt

**Art:** how-to

Stand: 09.11.2026 · Epic: [EPIC-P38](../epics/EPIC-P38-session-arbeitsort.md) ·
ADR: [ADR-0057](adr/0057-session-arbeitsort.md)

## 1. Was die Wahl bedeutet

| | Eigener Worktree (Standard) | Projekt direkt |
|---|---|---|
| Schreibt in | `data/worktrees/<session>` auf Branch `ancientvoid/<session>` | den Projektordner selbst |
| Parallel | beliebig viele Sessions | **eine** AncientVoid-Session pro Checkout |
| Aufräumen | sauberer Worktree wird beim Stop/Archiv entfernt, einer mit Arbeit bleibt | AncientVoid entfernt nie etwas im Projekt |
| Nicht-Git-Projekt | nicht möglich (Fehler vor Start) | möglich |

Ein Worktree trennt **nur Git-Dateien** — keine Prozess- oder Netzwerkrechte.
Was der Agent ausführen darf, regelt der Modus/die Sandbox des Harness
(Feld „Modus“), unabhängig vom Arbeitsort. Der Sessionkopf zeigt beides getrennt.

## 2. Fehlerbilder

| Meldung | Ursache | Maßnahme |
|---|---|---|
| „In diesem Projekt schreibt bereits eine andere AncientVoid-Session (…)“ | Lease auf dem kanonischen Checkout | Session beenden oder Worktree wählen. Eine Lease gestoppter/fehlerhafter/archivierter Sessions löst sich beim nächsten Start selbst |
| „Das Projekt hat ungesicherte Änderungen (…)“ | Dirty-Checkout | bewusst bestätigen (bleibt unangetastet, gilt nicht als Leistung der Session) oder erst committen |
| „Arbeitsort ungeklärt“ (Badge) | Altsession ohne Beleg (Migration 30) | nichts wird geraten; Session fortsetzen, wenn der Ort bekannt ist, sonst archivieren |
| Diff: „vor Start geändert“ | Pfad war bei Start schon dirty | erwartet, kein Fehler |
| `hubctl show`: „Drift“ | HEAD/Branch haben sich seit dem Start bewegt (Editor/Terminal/anderes Tool) | prüfen, wer geschrieben hat; AncientVoid sperrt Fremdschreiber nicht |

## 3. Abnahme gegen echte Scratch-Repos (nicht Teil des Gates)

Das Gate (`e2e/specs/session-workspace-mode.spec.ts`, Core-/Hub-Tests) läuft mit
echten Git-Repos, aber dem Dummy-Adapter. Mit einem echten Harness, **nur in
Wegwerf-Repos**:

1. `git init` zwei Wegwerf-Repos (mit/ohne Remote) unter einer `projectRoot`; ein Nicht-Git-Ordner.
2. Worktree-Variante: zwei Sessions parallel starten, je eine Datei ändern lassen — Projektordner bleibt unverändert, beide Worktrees getrennt.
3. Direkt-Variante: Datei im Repo vorher ändern (Dirty), starten → Bestätigung erscheint; nach dem Lauf zeigt der Diff die Vorab-Änderung als „vor Start geändert“.
4. Zweiter direkter Start im selben Repo (auch über einen Symlink-Pfad): wird verweigert.
5. Hub mit SIGKILL beenden, neu starten: Badge und Lease sind zurück; Resume bleibt im Projekt.
6. Stop → Archiv → Löschen: Repo (`.git`, Sentinel-Datei, Dirty-Änderung) unverändert, kein `git stash`/`reset`/Commit durch AncientVoid.

Ergebnis mit Datum und Commit im Epic unter T38.6 festhalten.
