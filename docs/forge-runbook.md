# Forge-Runbook: GitLab im Session-Kontext

Stand: 09.11.2026 · Epic: [EPIC-P37](../epics/EPIC-P37-gitlab-review-ci.md) ·
ADR: [ADR-0056](adr/0056-forge-modul-gitlab-im-session-kontext.md)

## 1. Zugang einrichten

Der Hub spricht GitLab ausschließlich über `glab api` (argv, keine Shell). Zugang:

- vorhandene lokale `glab`-Anmeldung des Betriebsnutzers (`glab auth login`), oder
- `forge.gitlab.tokenFile` in der Hub-Config: Pfad zu einer Datei, deren erste Zeile das Token ist.
  Das Token steht nie in der Config selbst, nie im PWA-Storage, nie im Journal.

`forge.gitlab.command` zeigt auf das glab-Binary (Default `glab`; E2E: Stub). `forge.gitlab.host`
ist nur nötig, wenn ein Remote nicht eindeutig einem Host zugeordnet werden kann.

Der Tab „GitLab“ in der Session verknüpft einen bestehenden MR (URL), zeigt MR-Stand, Pipelines/Jobs
(inkl. Bridges/Child-Pipelines), Threads und Issues und sendet ausgewählte Befunde erst nach Vorschau.

## 2. Fehlerbilder

| Anzeige | Ursache | Maßnahme |
|---|---|---|
| „GitLab-Zugang abgelehnt (401/403)“ | Token fehlt/abgelaufen/zu wenig Scope | `glab auth status`; Token mit `api`-Scope erneuern |
| „GitLab-Rate-Limit erreicht“ | zu viele Abrufe | warten; Cache zeigt den letzten Stand mit Zeitstempel und Fehlerhinweis |
| „GitLab nicht erreichbar“ | Netz/Host | Cache bleibt sichtbar, ist aber **kein** Beleg für aktuellen CI-Erfolg |
| „glab nicht gefunden“ | Binary fehlt | `forge.gitlab.command` prüfen |
| „MR hat neue Commits (veraltet)“ | MR-Head hat sich geändert | neu laden; Feedback trägt die geprüfte SHA |

Nach Hub-Neustart (auch SIGKILL) kommen Verknüpfungen und Operationen aus Journal + Snapshot zurück;
die externe Wahrheit wird beim nächsten Abruf neu gelesen (K7).

## 3. Abnahme gegen ein echtes, isoliertes GitLab-Projekt

Nicht Teil des Gates (`e2e/specs/forge-review.spec.ts` läuft gegen den Stub `e2e/support/bin/glab`).
Ablauf, **nur in einem Wegwerf-Projekt, nie produktiv**:

1. Wegwerf-Projekt auf gitlab.com anlegen, Token mit `api`-Scope in eine Datei, `forge.gitlab.tokenFile` setzen.
2. Branch mit einer absichtlich fehlschlagenden Pipeline pushen, MR öffnen.
3. In AncientVoid: Session auf dem Projekt starten, im Tab „GitLab“ den MR verknüpfen.
4. Prüfen: MR-Titel/Draft, Branch → Ziel, MR-Head = SHA der Pipeline, fehlgeschlagener Job, Trace lesbar,
   Child-Pipeline über Bridge sichtbar.
5. Befund über Vorschau senden; prüfen, dass Pipeline-/Job-ID und SHA im Prompt stehen.
6. Neuen Commit auf den MR-Branch pushen → Anzeige „veraltet“, Versand ohne Neuladen wird als veraltet markiert.
7. „Draft-MR vorbereiten“ ist read-only; **Erstellen** nur im Wegwerf-Projekt auslösen und prüfen, dass ein
   zweiter Versuch (Antwortverlust simuliert: Hub-Kill nach Klick) keinen zweiten MR erzeugt.
8. Hub mit SIGKILL beenden, neu starten: Verknüpfung und Operationen sind zurück.

Ergebnis mit Datum und Commit im Epic unter T37.6 festhalten.

Automatisiert: `node --experimental-strip-types scripts/forge-real-acceptance.ts <git-url-des-wegwerf-projekts>`
(klont, pusht einen `accept/p37-*`-Branch, öffnet einen Draft-MR, fährt Schritte 3–8, räumt MR/Branch auf,
schreibt `/tmp/forge-abnahme.md`). Schritt „Trace lesbar“ wird als **SKIP** berichtet, wenn der Job nie lief
(`ci_quota_exceeded`, kein Runner) — das zählt nie als Pass; Wiederholung, sobald ein Runner Jobs ausführt.
