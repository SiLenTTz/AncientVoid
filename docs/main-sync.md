# Main-Sync — frischer Hauptbranch beim Start, laufende Synchronisation

**Art:** how-to

EPIC-P67 · ADR-0088 · Stand 2026-11-18

Main-Sync verhindert, dass Agenten unbemerkt auf veraltetem Stand arbeiten
(Auslöser: der Haupt-Checkout stand 178 Commits hinter `origin/main`, jede neue
Session verzweigte davon). Drei Stufen, jede für sich nutzbar:

1. **Frischer Start** (an, Default): Eine neue Session legt ihren Worktree auf
   `origin/<Hauptbranch>` an — `git fetch` mit hartem Timeout (2–60 s, Default
   10) und `GIT_TERMINAL_PROMPT=0`. Schlägt das fehl (offline, Auth, Timeout,
   kein Remote), startet sie trotzdem auf dem lokalen Stand, mit sichtbarem
   `workspace.main_sync_failed`-Event (Regel 6). Steht der Projektordner auf
   einem Feature-Branch, bleibt die Basis der lokale Stand
  (`main_sync_skipped`, Grund `not-main-branch`) — die Grundlage einer
   Feature-Arbeit wird nie weggezogen. Der lokale `main` im Projektordner wird
   nie angefasst.
2. **Laufende Synchronisation**: Der Hub prüft im Takt, wie weit Sessions
   hinter dem Hauptbranch liegen — **ein Fetch je Projekt je Takt** (K8), auch
   bei 20 Sessions. Modi: `melden` (Default), `fragen` (Benachrichtigung mit
   Knopf „Jetzt aktualisieren“), `automatisch` (nur mit `Auto-Merge: nur
   sauber` — Probelauf vorher, Konflikt bleibt liegen).
3. **Sichtbar**: Hinweis „N hinter main“ im Session-Kopf, Aktionen im ⋯-Menü
   (Prüfen/Aktualisieren, Konfliktliste, „zuletzt abgeglichen“),
   Einstellungsabschnitt „Main-Synchronisation“ (global + je Projekt),
   `hubctl main-sync`.

## Was bewusst NICHT passiert

- **Kein Rebase, keine History-Umschreibung** — gemergt wird, nie umgeschrieben.
- **Kein Push oder Merge nach main** — das bleibt `apply()`/Pull-Request.
- **Kein Merge in laufende Züge** — angewendet wird nur auf wartende Sessions
  (`idle`/`parked`/`interrupted`, keine offenen Worker/Aktivitäten); diese
  Schwelle ist im ersten Wurf nicht abschaltbar.
- **Keine Konfliktlösung durch den Hub** — der Probelauf (`git merge-tree`,
  lesend) nennt die Dateien, der Merge bricht bei Konflikt sofort ab
  (`git merge --abort`, Worktree unverändert — Hash-Gleichheit ist
  Testkriterium). Lösen macht der Agent oder Mensch in der Session.
- **Kein Aktualisieren des Hub-Checkouts selbst** (Deployment, `npm install`,
  PWA-Bau, Service-Restart) — eigener Ablauf mit eigenem Risiko (BUG-0209).

## Einmischen

`git merge origin/<Hauptbranch>` im Session-Worktree. Fast-Forward bleibt
Fast-Forward; echte Merges tragen die notation-konforme Nachricht
`. a worktree: origin/main eingemischt` — der `commit-msg`-Hook greift statt
umgangen zu werden (AC-P67-11). Das Ergebnis steht als Event im Verlauf
(`workspace.main_sync_applied/conflict/skipped/failed`), nie im Prompt.

## Einstellungen

`GET/PUT /api/settings/main-sync` (Policy `settings.manage`), Speicher ist die
`config`-Tabelle (`mainSync.global`, `mainSync.projects`) — fehlende Einträge
gelten als Defaults, ein Eintrag aus einer künftigen Hub-Version liest sich
weiter (K7, additiv). Global mit Überschreibung je Projekt:

| Feld | Werte | Default |
|---|---|---|
| `startSync` | `off` · `fetch-base` | `fetch-base` |
| `fetchTimeoutSec` | 2–60 | 10 |
| `defaultBranch` | Name oder leer (= `origin/HEAD`) | leer |
| `checkIntervalMin` | 0 (aus) · 5–1440 | 60 |
| `behindAction` | `notify` · `ask` · `auto` | `notify` |
| `autoMerge` | `off` · `clean-only` · `ask` | `off` |
| `onlyWhenIdle` | `true` (nicht abschaltbar) | `true` |

## hubctl

```bash
hubctl main-sync <sessionId>                # Messung + Probelauf (Standard)
hubctl main-sync <sessionId> --apply        # origin/main einmischen (Menschen-Token)
hubctl main-sync --project <pfad> --apply   # alle Worktree-Sessions des Projekts
hubctl main-sync --settings                 # Einstellungen lesen
```

API: `GET/POST /api/sessions/:id/main-sync`. Das Anwenden ist eine
Menschenfläche (`main-sync.apply`: Agenten/Fleet/Display deny) — Skripte
laufen mit einem Menschen-Token, Agenten bekommen das Ergebnis über den
Verlauf.

## Messlatten

- **K5**: Event-Payloads gekappt (Dateilisten ≤ 20 Einträge, Details ≤ 500 Zeichen).
- **K7**: Einstellungen und Sync-Zustand aus `config`-Tabelle + Events + Git
  faltbar; kein persistenter Timer — beim Hub-Start wird einmal nachgeholt.
- **K8**: ein Fetch je Projekt je Takt (Test: 20 Sessions ⇒ 1 Fetch).
- **K10**: offline startet und arbeitet alles weiter auf dem lokalen Stand,
  mit Zeitstempel des letzten Abgleichs.

Details und Aufgaben: `epics/EPIC-P67-main-sync.md`; Entscheidungsbegründung:
`docs/adr/0088-main-sync-frischer-hauptbranch-und-laufende-synchronisation.md`.
