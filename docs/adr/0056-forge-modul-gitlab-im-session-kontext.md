# ADR-0056 — Forge-Modul: GitLab-MRs, Issues und CI im Session-Kontext

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/forge/`,
`packages/core/src/modules/forge/`, `apps/hub/src/modules/forge/`,
`apps/pwa/src/features/forge/`, EPIC-P37 (T37.1–T37.6)

## Kontext

Vom Auftrag bis zum überprüfbaren MR soll in einem Kontext arbeiten, wer
schon im Session-Worktree arbeitet: Issue als Quelle, Branch/MR/SHA/CI
sichtbar, ausgewählte Befunde als Folgeauftrag an den Agenten, bestätigter
Draft-MR-Pfad (EPIC-P37). Bestand: Actions-Runner (T7.6) zeigt argv-Prozesse
in der Timeline; P36 besitzt Feedback-Pakete und den Steer-Versand mit
Operations-ID; P28 betreibt CI. Es existiert **kein** glab-Nutzungs- und
kein Remote-Auflöse-Code. GitLab zuerst (selbst gehostet eingeschlossen);
GitHub/Linear/Jira sind bewusst Out.

## Entscheidung

1. **Ein Forge-Modul, keine generische Provider-Schnittstelle.** Contracts
   `forge/forge.ts` beschreibt GitLab-Formen (MR/Pipeline/Job/Thread/Issue),
   keine Abstraktion für hypothetische zweite Forges (Epic §3.1). Ein
   späterer zweiter Forge darf das Muster *vor* Verallgemeinern zeigen.

2. **Identität = Host + Projekt-ID + IID** (`ForgeMrRef`): selbst gehostete
   GitLabs mit gleichen IIDs kollidieren nicht (AC-P37-1). Der Host einer
   Session ergibt sich aus `git remote get-url origin` des Workdirs — vom
   Nutzer gepushte Wahrheit, nicht geraten. Remote-URL → (host, path)
   Normalisierung im Modul; Projekt-ID per `glab api projects/<path>`.

3. **Zugang über `glab` als argv-Kindprozess.** `glab api <pfad>` mit
   reiner Argument-Übergabe (BUG-0013-Lektion: nie interpolieren, nie Shell).
   Auth: die lokale glab-Anmeldung des Hub-Betriebsnutzers; optional
   `forge.gitlab.tokenFile` (erste Zeile, `apiKeyFile`-Muster wie
   Gatekeeper/Assistant) → env `GITLAB_TOKEN`/`GITLAB_HOST` an den
   Kindprozess. Token erscheinen nie in Config-Werten, Logs, Events oder
   PWA-Storage (AC-P37-6). `forge.gitlab.command` erlaubt der E2E, einen
   Stub zu setzen (gleiche Technik wie die Adapter-CLI-Stubs).

4. **Lesen und Schreiben getrennt.** Alle GET-Routen sind read-only gegenüber
   GitLab (AC-P37-4): MR/Issues/Threads/Pipelines/Jobs/Bridges/Trace.
   Mutationen nur: Verknüpfung (lokal), Feedback-Versand (menschliche
   Aktion, 403 für Agenten-Tokens — P36-Muster), Draft-MR (zweistufig mit
   ausdrücklicher Bestätigung). MR-Anlage/Allewrites ausschließlich über
   `glab api`/Git-Push des **Session-Branches** — niemals lokaler
   Feature→main-Merge (Git-Hygiene, Premortem 4); Ziel-Branch ist `main`.

5. **Reader mit Normalisierung und Pagination.** Der GitLab-Client kennt
   genau eine Form pro Aufruf: `glabApi(path, {query})` → JSON; Seiten werden
   explizit gelooppt bis eine Seite < `per_page` liefert. Fehler werden
   klassifiziert (`auth` 401/403, `rate_limit` 429, `network`, `http`,
   `parse`) — sichtbar, nie still; `pending`/`skipped`/`canceled` sind nie
   grün, nur `success` (AC-P37-2). Bridge-Jobs
   (`pipelines/:id/bridges`) werden geladen und mit `kind:"bridge"` plus
   Downstream-Pipeline-Verweis in die Jobliste gemischt — Child-Fehler
   bleiben auffindbar. Rate-Limit: keine Selbstheilung im Reader; die Route
   antwortet mit Fehlerklasse + `cachedAt` (K10: der Cache sagt Datum, nie
   Erfolg).

6. **Cache mit Zeitstempel, offline ehrlich.** In-Memory-Cache pro
   (Session, Ressource) mit `fetchedAt`; bei Netz-/Rate-Fehlern liefert die
   Route die letzte gute Antwort **mit** `staleSince`-Zeitstempel und
   Fehlerklasse — die PWA zeigt das Datum (AC-P37-6, K10). Ein Cache ist
   niemals Beleg für aktuellen CI-Erfolg (Epic §3.4).

7. **Verknüpfungen und Operationen im Journal.** `ForgeStore` nach dem
   P36-Muster: `<dataDir>/forge/<sessionId>/journal.jsonl` + atomarer
   `snapshot.json`; Events `mr_linked|mr_unlinked|feedback_sent|draft_mr`
   mit monotonem `seq`; Recovery = Snapshot + Nachlauf (K7). Externe
   Wahrheit (MR-Zustand, SHA) wird nach Neustart neu geprüft — das Journal
   hält die Verknüpfung, nicht den geglaubten CI-Zustand.

8. **Feedback über den P36-Weg.** Ein CI-/Review-Befund wird als
   Forge-Operation versendet: Prompt-Komposition **mit Quellenrahmen**
   (Pipeline-/Job-/Thread-ID + geprüfter SHA, §3.3) und Datenrahmen für
   zitierte Fremdtexte (PRD §8.5: zitierte Kommentare/Logs sind Daten,
   niemals Ausführungsbefugnis — Premortem 3). Versand läuft durch
   `sessions.steer` mit `inputId=operationId` (Dedupe/In-Flight aus P36)
   und wird als `feedback_sent` journaliert. SHA-Drift: ist der aktuelle
   MR-SHA ≠ der SHA des Abrufs, markiert die Route den Befund als veraltet
   und verweigert den Blindversand (P36-Stale-Semantik).

9. **Draft-MR: Plan → Bestätigung → persistente Operation.** `prepare`
   (read-only) liefert Branch, Commits-vor-Push, Remote/Projekt, Ziel,
   Titelvorschlag (Commit-Notation) und `pushNeeded`. `create` journaliert
   zuerst `pending`, pusht nur `refs/heads/<session-branch>`, legt den MR
   als Draft über die API an und faltet auf `done`. Geht die Antwort
   verloren (`uncertain`), sucht der Retry **zuerst** MRs mit derselben
   Source-Branch und macht keinen zweiten MR (AC-P37-5) — dieselbe
   At-least-once-Abgleichslogik wie die Steer-Operations-ID, hier gegen
   die externe Wahrheit von GitLab.

10. **Traces gekappt, volle als Datei-Blob.** Job-Traces sind potentiell
    MB-groß: Die Route liefert einen gekappten Schwanz (Vorschau ≤ 8 KB);
    das vollständige Trace landet als Datei unter
    `<dataDir>/forge/<sessionId>/traces/<jobId>.log` (Cap 2 MB, ältere
    Zeilen gekappt und gezählt) und wird über eine eigene Route gelesen.
    Keine neuen Event-Payloads; K5/K3 unberührt.

## Konsequenzen

- `hub.config.json` erhält einen additiven `forge`-Abschnitt (Default: aus,
  bis eine Verknüpfung genutzt wird — die Routen existieren trotzdem und
  melden ehrlich, wenn glab fehlt).
- E2E prüft den kompletten Fluss gegen einen glab-Stub (`command`) und ein
  lokales Bare-Repo als Origin; die echte Abnahme an einem isolierten
  GitLab-Projekt ist separater, menschlich bestätigter Schritt (keine
  Produktiv-Mutation).
- P38+ (Session-Arbeitsort) und P46 können an `ForgeMrRef`/`DraftMrPlan`
  andocken, ohne den Reader neu zu erfinden.
