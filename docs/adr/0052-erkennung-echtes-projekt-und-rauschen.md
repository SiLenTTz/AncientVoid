# ADR-0052 — Erkennung: echtes Projekt aus `cwd`, Worktrees bündeln, Rauschen einklappen

**Status:** akzeptiert (Fortschreibung von ADR-0040) · **Betrifft:** `packages/contracts/src/sessions/identity.ts` (`DiscoveredSession`),
`packages/core/src/modules/discovery/` (`project-origin.ts`, `claude-meta.ts`, `sources.ts`), `apps/hub/src/main.ts`, PWA `features/discovery/`, EPIC-P34

## Kontext
Die Erkennung leitete das Projekt aus dem Ordnernamen unter `~/.claude/projects` ab (Zeichen ersetzt, nicht umkehrbar) und rettete sich über bekannte
Wurzeln. Gezählt am 2026-11-07 auf dem Entwicklungsrechner: 1 649 Transkripte, 149 Projektordner; 110 Transkripte liefen unter `/tmp` (davon die
Fabrik-Kopien `harnez-exec-*`), 16 in `…/data/worktrees/<id>` und erschienen als eigene Projekte mit langem Rohnamen. **In allen 1 649 Transkripten steht `cwd`
im Kopffenster (96 KB).** Subagenten standen als gleichrangige Karten neben ihren Hauptsessions.

## Entscheidung
1. **`cwd` hat Vorrang.** `readClaudeMeta` liest `cwd` aus demselben Kopffenster wie Titel und Vorschau (erste absolute Angabe, gleicher Cache je Pfad, mtime, Größe).
   Fehlt es, bleibt der Ordnername wie bisher (R9.7, nie gedroppt).
2. **Worktrees bündeln** (`classifyProject`, reine Pfadlogik): `<haupt>/data/worktrees/<id>` und `<haupt>/.claude/worktrees/<id>` sowie git-Worktrees (`.git`-Datei mit
   `gitdir: <haupt>/.git/worktrees/<name>`). `project` ist dann das Hauptprojekt, der Name steht in `worktree`. Alles andere bleibt eigene Gruppe — nie geraten.
3. **Rauschen einklappen, nicht löschen:** `temporary: true` für Pfade unter `/tmp`, `/var/tmp`, dem Temp-Verzeichnis und alles mit einem Segment `harnez-exec-*`.
   Die PWA fasst es in „Temporär & Automatisch (n)“ am Ende zusammen, eingeklappt; Zähler und Suche bleiben. Eine **konfigurierte Projektwurzel** hebt nur die Orts-Regel auf
   (Wurzel unter `/tmp` ist Arbeit des Nutzers), Fabrik-Kopien bleiben Rauschen. Ohne Wurzeln greift die Regel überall. Die Wurzel-Filterung nach ADR-0011 bleibt unverändert.
4. **Subagenten** erben Projekt, Worktree und `temporary` ihrer Hauptsession (aus deren Transkript) und tragen weiter `parentSessionId`. Die PWA nestet sie unter der
   Hauptsession, solange diese in derselben Gruppe steht; sonst bleiben sie eigene Karten (kein Verschwinden bei Paging).
5. **`live` ergänzt:** zusätzlich zum 90-s-Schreibfenster zählt jede ID, die `claude agents --json` als offen meldet (`ClaudeLive`, derselbe Cache wie die Session-Ansicht).
   Fällt der Aufruf aus, bleibt es beim Fenster (BUG-0049: letzte gute Liste).
6. **Contract:** nur optionale Felder `worktree?: string | null` und `temporary?: boolean`. Alte Clients und Quellen bleiben gültig; der Dedupe-Schlüssel ändert sich nicht.

## Messung `live` (2026-11-07)
Gegen `claude agents --json` auf dem Entwicklungsrechner: mehrere offene Terminals (`idle`, `blocked`, Hintergrundsessions), aber nur **1 von 1 649** Transkripten im 90-s-Fenster.
Das Fenster hat also **falsch-negative** Fälle (offen, aber still); die falsch-positive Richtung (gerade vom Hub selbst geschrieben) ist unverändert durch Ablauf und `fork` abgedeckt.
Ein Testfall hält den stillen, offenen Fall fest (`project-origin.test.ts`, „live: ein offenes, aber seit Minuten stilles Terminal …“). Das Fenster selbst bleibt bei 90 s.

## Folgen und Grenzen
- Hubs ohne `claude`-CLI oder mit altem `claude agents` verhalten sich wie zuvor.
- Andere Provider (pi, maki, opencode) liefern ihr Verzeichnis ohnehin als `project`; sie bekommen `worktree`/`temporary` erst, wenn jemand es braucht (kein Scope-Creep, P34 §2).
- Ein Worktree außerhalb der drei Muster erscheint als eigenes Projekt, bis die Regel erweitert wird.
