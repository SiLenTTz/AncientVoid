# ADR-0088: Main-Sync — frischer Hauptbranch beim Session-Start, laufende Synchronisation, einstellbar

Status: akzeptiert (2026-11-18)

## Kontext

Nach der Qwen-Nacht stand der Haupt-Checkout 178 Commits hinter `origin/main`, und jede
neue Hub-Session verzweigte von diesem veralteten Stand: der Worktree-Manager legt
Worktrees am **lokalen** `HEAD` an (`WorktreeManager.create`, EPIC-P2) und fetcht nie
(BUG-0209-Umfeld). Agenten arbeiteten so unbemerkt auf altem Stand; Konflikte wurden
groß statt klein. Gewünscht (Nutzerauftrag 18.11.2026): jede neue Session startet auf
dem neuesten Hauptbranch, laufende Sessions werden synchronisiert oder der Nutzer
bekommt einen Vorschlag, und Zeitpunkt/Häufigkeit/Autonomie sind einstellbar.

Der volle Aufgabenkatalog steht in `epics/EPIC-P67-main-sync.md` (Stufen 1–3,
T67.1–T67.10); dieses ADR entscheidet die Schnittstellen, auf denen der Epic baut.

## Entscheidung

**1. Contract vor Code, rein additiv (`packages/contracts/src/workspace/main-sync.ts`).**
`MainSyncSettings` (Zod, strict) mit den sieben Feldern aus EPIC-P67 §3.5, Defaults
`MAIN_SYNC_DEFAULTS` (Stufe 1 an, alles Autonome aus), Projekt-Override als
`MainSyncSettings.partial()`, effektive Einstellungen als
`resolveMainSyncSettings(defaults ← global ← Projekt)`. Fünf neue Systemevents
`workspace.main_sync_{checked,applied,conflict,skipped,failed}` mit gekappten Payloads
(≤ 20 Dateieinträge, K5); die Kinds ergänzen `WORKSPACE_EVENT_KINDS` additiv — Main-Sync
ist keine neue Workspace-Phase, Manifest/Phase/Service-Status bleiben unberührt.

**2. Additives Lesen gespeicherter Einstellungen (K7, AC-P67-8).**
Gespeichert wird ein JSON-Eintrag in der bestehenden `config`-Tabelle (Muster
`/api/settings/gemini`) — kein neuer Speicher, kein Timer-Zustand. Das Lesen
(`readMainSyncSettings`) pickt bekannte Schlüssel, ergänzt Defaults und **übergängt
unbekannte Felder**: ein Eintrag aus einer künftigen Hub-Version liest sich mit einem
alten Hub weiter (und umgekehrt). Ein inhaltlich ungültiger Eintrag fällt auf Defaults
zurück und wird als `invalid` markiert — der Hub macht das sichtbar, nie still
(`main_sync_failed`, Regel 6). Ein Contract-Test erzwingt beide Richtungen.

**3. Stufe 1 (Basis): fetch + `origin/<Hauptbranch>`, mit hartem Fallback.**
`WorktreeManager.create` ermittelt den Ziel-Ref `origin/<Hauptbranch>` (Hauptbranch aus
`refs/remotes/origin/HEAD`, Override `defaultBranch`), fetcht mit hartem Timeout
(2–60 s, Default 10) und `GIT_TERMINAL_PROMPT=0` — nie interaktiv, nie blockierend auf
dem Start-Pfad. Gelingt das nicht (offline/Auth/Timeout/kein Remote), startet die
Session auf dem lokalen `HEAD` wie heute, mit `main_sync_failed`-Event. Steht der
Projektordner auf einem Feature-Branch, wird **nicht** umgebasisert
(`main_sync_skipped {reason: "not-main-branch"}`) — sonst würden Sessions einer
Feature-Arbeit die Grundlage verlieren. Der lokale `main` im Projektordner wird nie
angefasst; `record.worktreeSha` bleibt die eine Basis-SHA (Manifest/Diff/hasWork
lesen den SHA, nicht den Branchnamen).

**4. Stufe 2 (Sync): messen, probelaufen, anwenden — in dieser Reihenfolge.**
Messen per `rev-list --left-right --count`; Probelauf per `git merge-tree --write-tree`
(lesend, berührt weder Index noch Worktree, nennt Konfliktdateien gekappt); anwenden per
`git merge origin/<Hauptbranch>` mit notation-konformer Nachricht
(`. a worktree: origin/main eingemischt`), damit der `commit-msg`-Hook greift statt
umgangen zu werden. Bei jedem Fehler sofort `git merge --abort` — der Worktree bleibt
unverändert (Hash-Gleichheit ist Testkriterium, AC-P67-7). Gating: angewendet wird nur
auf **wartenden** Sessions (`onlyWhenIdle`, im ersten Wurf nicht abschaltbar) mit
sauberem Worktree; während `working` wird höchstens gemeldet. Der Hub schreibt nichts in
den Prompt (PRD §8.5); das Ergebnis steht als Event im Verlauf.

**5. Stufe 3 (Einstellen/Sichtbarkeit) über bestehende Wege.**
API `GET/PUT /api/settings/main-sync` (Policy `settings.manage` — bleibt in der
bestehenden `/api/settings`-Mapping) und `GET/POST /api/sessions/:id/main-sync`
(Messung + Probelauf / anwenden); PWA-Abschnitt nach SettingsSection-Muster, Indikator
„N hinter main" im Session-Kopf; Benachrichtigung in der P64/P65-Taxonomie (`action`
bei Rückfrage/Konflikt, `info` nach Auto-Merge), Aktionsknopf ruft denselben Endpunkt
wie das Menü. `hubctl main-sync` für Skripte.

**6. Ein Takt, ein Fetch — je Projekt, nicht je Session (K8).**
Der Scheduler gruppiert nach Projekt: ein `fetch`, dann Zählung aller Sessions des
Projekts. Intervall 5–1440 min (Default 60, `0` = aus), kein persistenter Timer — beim
Hub-Start wird einmal nachgeholt; der angezeigte Zustand faltet sich aus Events + Git
(K7). Bei `behind > 0` gelten die Modi `notify`/`ask`/`auto`; Benachrichtigungen kommen
je Session und Zustand einmal, nicht je Takt.

## Grenzen (bewusst)

- **Out:** Hub-Checkout selbst aktualisieren/neu starten (`npm install`, PWA-Build,
  Service-Restart) — genau dort entstand BUG-0209; eigener Entwurf, falls gewünscht.
- **Out:** Rebase/Force-Push der Session-Branches, jede History-Umschreibung — gemergt
  wird, nie umgeschrieben.
- **Out:** Konflikt**auflösung** durch den Hub. Der Hub erkennt und meldet; lösen
  bleibt Aufgabe des Agenten oder Menschen in der Session.
- **Out:** Merge/Push **nach** main — das bleibt `apply()`/PR.
- Skip-/Fail-Gründe sind begrenzter Freitext mit dokumentierten Werten, kein Enum:
  neue Gründe brechen keine alten Parser (additiv bleiben).
- `onlyWhenIdle: false` wird vom Schema abgelehnt; wird Abschaltbarkeit je Projekt
  gewünscht, folgt ein ADR-Nachtrag mit eigenem Premortem.

## Konsequenzen

- Neue Sessions starten künftig auf `origin/<Hauptbranch>` (Default), und der Start
  hängt potentielles Netz ab — der harte Timeout + Fallback begrenzt das auf
  `fetchTimeoutSec`; offline ist das heutige Verhalten exakt wiederhergestellt.
- Session-Branches enthalten künftig Merge-Commits von main (notationkonform,
  `check:commits`-kompatibel, da `. a worktree: …` der Notation folgt).
- Der Epische Maßstab: K5 (Payload-Kappung), K7 (alles faltbar), K8 (ein Fetch je
  Projekt), K10 (offline-Fallback mit Zeitstempel). Nachweis je Task in
  `epics/EPIC-P67-main-sync.md` T67.1–T67.10.

## Verweise

- `epics/EPIC-P67-main-sync.md` (Aufgaben, AC, Premortem)
- `packages/contracts/src/workspace/main-sync.ts` (Contract, T67.1)
- Vorbild Speicher: `packages/core/src/modules/attachments/store.ts` (`SettingsStore`,
  config-Tabelle); Vorbild Scheduler: `packages/core/src/modules/automations/scheduler.ts`
  (injizierbare `now`-Deps, tick-basierte Tests)
