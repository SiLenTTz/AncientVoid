# EPIC-P12 — Betriebsreife und vollständige Geräte-/Provider-Abnahme

**Status:** Planungsentwurf, Umsetzung blockiert · **Phase:** P12 · **Dauer:** 1–2 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P11 grün; alle P0–P10- und P4-Restnachweise tatsächlich vorhanden.

Planungsauftrag vom 2026-09-21; kein Umsetzungsstart und keine Behauptung eines
grünen Vorgänger-Gates. Scope, Evidenz und bestehende Restarbeiten:
[Audit](../docs/remote-control-audit-2026-09-21.md), [Index](README.md).

## 1. Ziel

Der gesamte vereinbarte Vollumfang ist reproduzierbar installierbar, im Alltag
benutzbar und nach Ausfällen wiederherstellbar. „100 %“ bedeutet keine offene
Pflichtzelle, nicht bloß grüne Pakettests. PRD G1–G5, K1–K10; Audit G15/G17.

## 2. Scope (In / Out)

**In:** wiederholbare Installation/Upgrades, Backup/Restore, Diagnostik,
Ressourcen-/Retention-Regeln, Geräte-/Provider-Abnahme, Dauerlauf und Runbook.
**Out:** automatische Lizenzwahl, ungefragter öffentlicher Release, neue Features
kurz vor Abschluss. P4-OSS-Entscheidungen werden übernommen, nicht neu erfunden.

## 3. Design-Details

Betriebsprofile für Omarchy, silenttz-server und evox2/WSL: Abhängigkeiten,
Provider-Login, Tailscale/TLS, STT-/Modell-Dienste, Autostart und Healthcheck.
Credentials getrennt von Projektkonfiguration; Status meldet fehlende Bausteine
verständlich. „Bereit“ nur wenn die tatsächlich aktivierten Funktionen erreichbar sind.

Backup umfasst JSONL, Snapshots, referenzierte Blobs, notwendige DB-/Config-
Metadaten und versionierte Schema-Migrationen. Restore auf frischem Datenverzeichnis
beweist Vollständigkeit. Schlüssel/Device-Pairing gesondert und geschützt behandeln;
keine pauschale Zusage, WebAuthn-Schlüssel anderer Hardware kopieren zu können.

Disk-full, Rotation, Retention/Blob-GC, CLI-Updates, ungültige Credentials,
Modell-/Netz-Ausfall, lange Sessions und parallele Worktrees testen. Logexport
redigiert sensible Daten; Live-Fixtures nur anonymisiert und secret-gescannt.

Release-Matrix enthält Host, OS, Browser/PWA, Harness-/Modell-/Adapter-Version,
alle Capability-Spalten und Evidenzpfade. Für „fertig“ werden unbekannt/blockiert
nicht aus dem Nenner entfernt. Ohne Zugriff echte Aufgabe blockiert lassen.

## 4. Aufgaben

- [ ] **T12.1 — Installation und Update.** Dokumentierter Fresh-Clone→Pairing→Session-Flow, Services/Doctor, Abhängigkeiten und reversible Migrationen, kompatible PWA-/API-Versionen. K7/K9/K10.
- [ ] **T12.2 — Tests und Messlatten schließen.** Die Pyramide (Unit/Integration/E2E, Skill `write-tests`, Health/Metrics) kommt aus P4.5 — hier nicht neu bauen. BUG-0004 und beobachtete tmux-Test-Unzuverlässigkeit mit deterministischen Checks behandeln; alle K1–K10, echter K4-Tokenizer, Hardware-Messungen und Secret-Scan im passenden CI-/Gerätepfad. K1–K10. **AI-P6-3:** K8-Last über die Fleet-Weiterleitung messen (30 ev/s je Session über zwei Hosts).
- [ ] **T12.3 — Backup, Restore und Retention.** Vollständiges Backup/Restore inkl. Attachments, Drafts, Pending-Aktionen und Flotten-Metadaten; Disk-full/Blob-GC und Revoke prüfen. K5/K7/K10.
- [ ] **T12.4 — Abnahme aller Zielkombinationen.** Matrix von P5/P7/P11 live ausführen; Smartphone über WAN, PC↔Handy↔PC, Voice/AI/Freigaben/Suche/Dateien; nicht nur Loopback und Fixtures. K1–K10. Enthält AI-P5-1: Handläufe für Claude Code, Codex, Copilot nach EPIC-P5 §12.4, danach deren Resume-Zelle `verified`. **AI-P6-1:** einen WSL-Host (z. B. bmax) in die Flotte aufnehmen und damit den WSL-Teil von AC-P6-5 und Premortem 4 aus P6 abnehmen.
- [ ] **T12.5 — Dauerlauf und Übergabe.** 24 h mit ≥ 20 Sessions, Netz-/Hub-/Modell-Ausfälle, Ressourcenentwicklung; Runbook, bekannte Grenzen, Installationsversuch durch frischen Nutzerkontext und offene P4-Integrationsevidenz prüfen. K2/K7/K8/K9/K10.
- [ ] **T12.6 — Remote-Gate wiederherstellen (AI-P5-2).** GitLab-CI scheitert mit `ci_quota_exceeded`; der blockierende Job `e2e` lief nie remote. Runner oder Kontingent klären, oder das lokale `npm run gate` samt Beleg im MR als offizielles Gate festschreiben.

## 5. Acceptance Criteria

- **AC-P12-1:** Frischer Zielhost nach Runbook ohne versteckte lokale Annahmen eingerichtet; Browser/Handy gepaart und erster echter Provider-Turn gestartet; jeder Pflicht-Host getestet.
- **AC-P12-2:** 24-h-Lauf mit 20 Sessions: keine verlorenen bestätigten Events/Eingaben, keine unbemerkten Ausfälle, kein unbegrenztes Speicher-/Plattenwachstum; mindestens je ein Hub-, Netz- und Modell-Ausfall.
- **AC-P12-3 (K7):** Restore aus Backup in leerem Datadir liefert referenziell vollständige Sessions/Blobs/Metadaten; Recovery-Latenz auf dokumentierter Datengröße gemessen. Externe Provider-Outcomes sichtbar abgeglichen.
- **AC-P12-4:** Alle verpflichtenden Matrixzellen und K1–K10 mit reproduzierbarer Evidenz grün; kein S1/S2-Befund offen. Nicht vorhandener Zugriff ist kein Pass.
- **AC-P12-5:** Tests, Lint, Typecheck, PWA-Build und Lasttests grün; Fixtures geprüft; Upgrade/rollback dokumentiert; veröffentlichbare Artefakte vorbereitet. Veröffentlichung nur im separat autorisierten P4-Release-Schritt.

## 6. Premortem

1. **Entwicklerrechner verschleiert Abhängigkeiten:** Fresh-Host-/Clean-Profile-Installation als echte AC.
2. **Backup kopiert DB, verliert Blobs/Resume:** referenzielle Restore-Prüfung mit anschließender Fortführung.
3. **„100 %“ durch Weglassen schwerer Provider:** unveränderte Pflichtmatrix mit blockierenden offenen Zellen.
4. **Kurztests übersehen Wachstum/Races:** Dauerlauf, Disk-full, lange Streams, WS-Reconnect und deterministische Worker-Tests.

## 7. Definition of Done

Alle ACs mit benannten Tests/Messläufen belegt, Vorgänger-Gate geschlossen;
`npm test`, `npm run lint`, `npm run typecheck` grün, PWA-Build bei UI-Änderungen,
Last-/Gerätetests gemäß AC. Contracts first; Adapter-/Event-/Worker-Änderungen
mit ADR. K5-Blob-Grenze, K7-Recovery, AdapterContext-Isolation und Fail-loud
nachgewiesen. Jede Funktion in Config, API/CLI und passender UI tatsächlich
registriert/erreichbar; Capability-/Support-Matrix ehrlich aktualisiert.
Premortem im Abschlussreview gegenprüfen, offene Pflicht-ACs blockieren Abschluss.
Commit/MR gemäß Repo-Workflow; kein lokaler Merge nach main.
