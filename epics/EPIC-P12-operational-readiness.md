# EPIC-P12 — Betriebsreife und vollständige Geräte-/Provider-Abnahme

**Status:** Umsetzung teilweise vorbereitet, Live-Abnahme blockiert (2026-09-24) · **Phase:** P12 · **Dauer:** 1–2 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P11 grün; alle P0–P10- und P4-Restnachweise tatsächlich vorhanden.

Der lokale Gate-Pfad (T12.6) ist dokumentiert und Backup/Restore wird in MR
!114 vorbereitet. P11 ist weiterhin nicht grün (!112 offen, !113 darauf
gestapelt); echte P12-Abnahmen und der Epic-Abschluss bleiben blockiert.
Scope, Evidenz und bestehende Restarbeiten:
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

- [ ] **T12.1 — Installation und Update.** **AI-P7-5:** Live-Hub von `--dangerously-skip-permissions`/`--auto` auf die nativen Gates (T7.2) umstellen, nach Bestätigung durch den Nutzer; Standard-Config ohne Bypass. Dokumentierter Fresh-Clone→Pairing→Session-Flow, Services/Doctor, Abhängigkeiten und reversible Migrationen, kompatible PWA-/API-Versionen. K7/K9/K10.
- [ ] **T12.2 — Tests und Messlatten schließen.** Die Pyramide (Unit/Integration/E2E, Skill `write-tests`, Health/Metrics) kommt aus P4.5 — hier nicht neu bauen. BUG-0004 und beobachtete tmux-Test-Unzuverlässigkeit mit deterministischen Checks behandeln; alle K1–K10, echter K4-Tokenizer, Hardware-Messungen und Secret-Scan im passenden CI-/Gerätepfad. K1–K10. **AI-P6-3:** K8-Last über die Fleet-Weiterleitung messen (30 ev/s je Session über zwei Hosts). **AI-P10-3:** K2/K8 unter Sprachlast (20 Sessions, gleichzeitige Diktate).
- [ ] **T12.3 — Backup, Restore und Retention.** Implementierung für verschlüsseltes Backup/Restore, Attachments, Drafts, Pending-Aktionen und Flotten-Metadaten in MR !114; Gate und Referenzprüfungen grün. Noch offen: echter ENOSPC-Lauf und Restore-Latenz auf Produktivdatengröße. K5/K7/K10.
- [ ] **T12.4 — Abnahme aller Zielkombinationen.** Matrix von P5/P7/P11 live ausführen; Smartphone über WAN, PC↔Handy↔PC, Voice/AI/Freigaben/Suche/Dateien; nicht nur Loopback und Fixtures. K1–K10. **AI-P10-1 (aus T10.5):** ≥ 20 Fachbegriff-Diktate je Zielgerät mit echter Stimme, Headset, Störgeräusch, Permission-Deny, Coldstart, WAN (AC-P10-1). **AI-P11-1/2 (aus T11.4/T11.5):** Desktop-Companion am echten Hyprland-Desktop mit dir abnehmen (3 Apps × 10, Keybind-Not-Stopp, WAN-Abbruch), GUI-Harness-Flows (Claude Desktop/Cursor …) und die GTK3-Zelle prüfen. **AI-P10.5-2:** Videofrage über eine echte Harness-Session (opencode + lokales Modell) und ein Video > 20 min (Teil-Zusammenfassung). **AI-P9-1:** Planer auf ≥ 100 echten Formulierungen aus dem Betrieb messen (vorher nicht schärfen). **AI-P9-2:** Anhang aus dem Teilen-Menü (Web Share Target) mit Gerätetest. **AI-P8-1:** Gerätetest am Handy: Push im Hintergrund/Sperrbildschirm, echter Flugmodus, Bildschirmtastatur, 200 % Text, TalkBack/VoiceOver. **AI-P8-2:** Peer-Meldungen als Push über den Heim-Hub. **AI-P7-3:** Gatekeeper (T7.9) auf ≥ 100 echten, unabhängig gelabelten Tool-Anfragen aus dem Betrieb nachmessen. Enthält AI-P5-1: Handläufe für Claude Code, Codex, Copilot nach EPIC-P5 §12.4, danach deren Resume-Zelle `verified`. **AI-P6-1:** einen WSL-Host (z. B. bmax) in die Flotte aufnehmen und damit den WSL-Teil von AC-P6-5 und Premortem 4 aus P6 abnehmen. **Aus T7.5:** aider mit dem lokalen Modell live (aider hat kein Tool-Gate; Lauf mit `--yes-always` braucht die ausdrückliche Freigabe des Nutzers).
- [ ] **T12.5 — Dauerlauf und Übergabe.** 24 h mit ≥ 20 Sessions, Netz-/Hub-/Modell-Ausfälle, Ressourcenentwicklung; Runbook, bekannte Grenzen, Installationsversuch durch frischen Nutzerkontext und offene P4-Integrationsevidenz prüfen. K2/K7/K8/K9/K10.
- [x] **T12.6 — Remote-Gate wiederherstellen (AI-P5-2).** GitLab-CI scheitert mit `ci_quota_exceeded`, bevor Jobs starten. Für diesen Zustand dokumentiert `docs/testing-e2e.md` die befristete Ausnahme: vollständiges lokales `npm run gate` mit Branch/Commit, Ergebnis und Skips im MR als Merge-Evidenz; remote CI wird nicht als grün ausgegeben. Beleg: MR !114 und `docs/messlauf/2026-09-24-p12-lokale-evidenz.md`. Normales Remote-Gate gilt wieder, sobald Runner/Kontingent verfügbar sind.
- [ ] **T12.8 — Swarm-Adapter (aus T7.5).** `custom-rag` Coding-Swarm (`/v2/swarm`, ADR-0001) als Adapter: Gate-Ergebnisse → Freigaben (`POST /runs/{id}/decisions`), Kinder/Rollen als Timeline. Voraussetzung: eigenes Admin-Credential für die Cockpit-API (existiert nicht) und das echte `RunEvent.kind`-Vokabular aus einer realen Event-Datei (bisher keine auf der Platte; `engine.*` stammt aus der Trajektorie, nicht aus dem Run-Log). Ohne beides wäre das Mapping geraten (R9.7).
- [ ] **T12.9 — Lokales Modell neben Halogen betreiben (AI-P7-4).** `halogen-starten.sh` beendet alle `llama-server`, auch `uacc-llama`. Mit dem Nutzer klären: gemeinsame Speicherplanung (beide passen in 123 GB), Start-Reihenfolge oder bewusster Verzicht; bis dahin gilt fail-closed (Gatekeeper → Regeln + WARNING).
- [ ] **T12.10 — Teiltranskripte beim Diktat (AI-P10-2).** Streaming-Erkennung mit VAD (Kandidaten: Parakeet-Streaming, whisper.cpp `stream`), Teilresultate nur zur Anzeige, nie als Befehl; AC-P10-2 (erstes Teiltranskript p95 ≤ 500 ms, sichtbare Aktion p95 ≤ 2 s) auf Geräten messen.
- [ ] **T12.11 — Lokales Bildmodell für die Videoanalyse (AI-P10.5-1).** Qwen2.5-VL (o. ä.) per llama.cpp + mmproj auf evox2 als `media.vision`; Speicher neben uacc-llama/Halogen klären (T12.9); Beschreibungen auf ≥ 30 Schlüsselbildern stichprobenartig prüfen.
- [ ] **T12.12 — Leckfreie Desktop-Eingabe (AI-P11-3).** Unter Hyprland gezielt an die Fenster-Adresse senden (`hyprctl dispatch sendshortcut …, address:…`) statt an den Fokus; Einfügen über die Zwischenablage nur als ausdrücklicher, sichtbarer Modus; Leck-Messung wie im P11-Messlauf, Ziel 0/50.
- [ ] **T12.7 — Vor der Veröffentlichung: Geheimnisse aufräumen (AI-P6-4).** Alle Geräte- und Fleet-Tokens rotieren, `/tmp/uacc-hub.log` und ältere Request-Logs leeren, in denen vor BUG-0028 Tokens standen; danach `git log`/Repo auf Geheimnisse prüfen. Erst dann das Repo public schalten.

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
