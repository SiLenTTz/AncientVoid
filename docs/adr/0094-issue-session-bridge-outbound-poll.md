# ADR-0094 — Issue-Session-Bridge: der Hub fragt nach, GitHub kommt nicht herein

## Lage

Der Nutzer will, dass ein neu angelegtes GitHub-Issue mit einem Tag/Flag automatisch eine
eigene Session bekommt, die es abarbeitet — und dass die angelegten automatischen Jobs
(nightly-bugs, Issue-Bridge) in der App unter den Automatismen sichtbar sind. Der Hub ist
aber local-first und nur im Tailnet erreichbar (`authHook`: Device-Token, tailnet-only);
es gibt keinen eingehenden Webhook und keinen HMAC-Pfad. Ein GitHub-Webhook hätte ein
öffentlich erreichbares Hub-Endpoint bedeutet — neue Angriffsfläche, neuer Auth-Typ,
Widerspruch zur bisherigen Netzwerkform.

Dazu kommt die Grenze aus PRD §8.5: Ein Issue-Body ist fremder Text. Er darf niemals
unerfragt als Instruktion an den Agenten laufen.

## Entscheidungen

1. **Outbound-Poll statt Webhook.** Der Hub fragt `api.github.com` an
   (`GET /repos/{repo}/issues?state=open&labels={trigger}&since={lastCheck}`, alle 60 s,
   Jitter). Kein eingehender Port, kein neuer Auth-Typ. Der Token liegt wie beim Forge
   in einer Datei (`tokenFile`), nie im Config-Commit.
2. **Das Label ist das Freigabe-Gate.** Nur Issues mit dem Trigger-Label (Standard
   `session`) bekommen eine Session. Labeln braucht Schreibrechte am Repo — damit ist die
   menschliche Freigabe der Nachweis, bevor fremder Text zum Agenten-Prompt wird. Der
   Issue-Body reist als **Datenblock** im Prompt (Nummer, Titel, Labels, Body, URL), die
   Arbeitsaufträge stehen darüber — die Prompt-Injektions-Grenze bleibt dadurch die
   gleiche wie bei jedem vom Menschen abgeschickten Prompt.
3. **Session statt neuer Automatik-Typ.** Die Bridge startet eine normale Session
   (`sessions.create`, Adapter/Projekt aus der Config, `workspaceMode: "worktree"`), mit
   dem `bridge:issue-<nr>`-Idempotenzschlüssel. Sie erweitert weder
   `AutomationDefinition` noch den Scheduler: kein Cron, keine Generation, kein Precheck —
   das Label ist der Trigger. Dedupe und Lebenstatus liegen im eigenen Journal
   (JSONL + Snapshot, K7): Issue-Nummer → Session-ID → Ergebnis-Kommentar.
4. **Zurückmelden auf dem Issue, nicht im Repo.** Beim Start kommentiert die Bridge den
   Session-Link; wenn die Session endet, kommentiert sie die Ergebnis-Klasse
   (succeeded/failed/timeout/cancelled — dieselbe Ableitung wie beim
   Automations-`inspect`). Schließen bleibt dem Menschen/`Fixes #`-PR überlassen.
5. **bugs/-Sync über die bestehende SSOT-Konvention.** Der Session-Prompt trägt die Regel
   mit: Defekte werden als `bugs/bug-NNNN-slug.md` geführt (Skill `bug-report`), und das
   Frontmatter bekommt mit `forge:` (Issue-URL) und `labels:` (Trigger-Label) die Sync-
   Marker. Die Bridge selbst schreibt keine Dateien im Repo.
6. **Externe Jobs sind Anzeige, kein Objekt.** `GET /api/automations/external` liefert
   eine flache Liste `ExternalJobInfo` (Quelle, Name, Status, Detail, URL, Zeitpunkt):
   die GitHub-Actions-Workflow-Läufe (TTL-Cache, bei Fehler letzte gute Daten mit
   Zeitstempel und Fehlerklasse — K10, Muster ForgeService) und den Zustand der Bridge
   selbst (aktiv, letzter Poll, offene Issue-Sessions). Die PWA rendert sie als eigene
   Sektion in der Automatismen-Ansicht. Es gibt bewusst keinen `external`-Target-Typ im
   Automation-Contract — GitHub-Actions haben dort nichts zu suchen (kein Precheck, kein
   Blob, keine Generation).
7. **projectRoots gelten unverändert.** Das konfigurierte Bridge-Projekt muss innerhalb
   der freigegebenen Wurzeln liegen; sonst startet die Bridge nicht (fail loud im Status).

## Abgewogen

- *Warum nicht GitHub Actions als Treiber (`issues`-Event → curl in den Hub)?* Gehostete
  Runner erreichen das Tailnet nicht; ein Tunnel/Funnel nur dafür wäre die neue Fläche,
  die wir eben nicht wollen. Der Hub läuft ohnehin dauerhaft.
- *Warum keine eigene Schedule-Art `webhook`/`event` im Automation-Contract?* Sie hätte
  Scheduler, Store und PWA für einen Fall erweitert, der kein Cron ist. Die Bridge ist
  kleiner als die Erweiterung gewesen wäre.
- *Warum Kommentare statt Issue-Status-Changes?* Schließen/Labels bleibt menschliche
  Entscheidung (Lebenszyklus `docs/issues.md`); die Bridge meldet, sie entscheidet nicht.

## Grenze (bewusst)

Ohne konfigurierte Bridge (`issues`-Sektion fehlt oder Projekt außerhalb der Wurzeln)
bleibt alles beim alten Zustand: der Endpunkt meldet nur die GitHub-Actions-Ansicht, die
Sektion zeigt ehrlich „nicht konfiguriert". Und die Bridge arbeitet nur offene Issues mit
Label ab — was nach dem Start am Issue geändert wird, erfährt die laufende Session nicht.
