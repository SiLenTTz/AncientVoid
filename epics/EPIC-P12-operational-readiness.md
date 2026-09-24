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

- [ ] **T12.1 — Installation und Update.** **AI-P7-5:** Omarchy-Liveconfig ist auf Claude `permissionPrompts: "hub"` und OpenCode-ACP umgestellt; Adapterstatus meldet für beide `native`. Die bisherige Config liegt geschützt außerhalb des Repos. `scripts/hub.sh stop` ist auf gruppenweises SIGTERM mit Wartezeit korrigiert. [Installations-/Update-Runbook](../docs/operations-runbook.md) ergänzt Fresh-Clone, Pairing, Diagnose und Rollback. Am 2026-09-24 Fresh-Clone aus Commit `f86e790` in privatem tmpfs ausgeführt: Node 26.7, `npm ci`, PWA-Build, isolierter Hub-Start/Health, einmaliges Test-Token, `hubctl health`/`adapters` und sauberer Stop grün. Echte OpenCode-ACP-Toolfreigabe mit lokalem Qwen: Anfrage war `waiting_approval`, Allow führte nur die explizite Testdatei aus, Deny ließ die Zieldatei aus. Claude-Code-Freigabetest wurde versucht, aber CLI 2.1.280 meldete vor einer Tool-Anfrage das erschöpfte Wochenkontingent; keine Freigabe und kein kostenpflichtiger Turn. Offen: echtes Handy-Pairing, Claude-native Permission-Turns nach Kontingent-Reset und vollständiger Update-/Rollback-Messlauf; die frische Installation allein schließt die Zelle nicht. Beleg: [Messlauf](../docs/messlauf/2026-09-24-p12-lokale-evidenz.md). Standard-Config ohne Bypass. K7/K9/K10.
- [ ] **T12.2 — Tests und Messlatten schließen.** Die Pyramide (Unit/Integration/E2E, Skill `write-tests`, Health/Metrics) kommt aus P4.5 — hier nicht neu bauen. BUG-0004 ist laut Bugregister behoben; AI-P6-3 ist mit zwei isolierten Sidecar-Hubs im gemeinsamen 10-s-Fenster belegt (20 Sessions × 30 ev/s, mindestens 301 gestreamte Events je Session, 6.443 persistierte Events, keine Sequenzlücken). Der lokale K8-Wiederholungslauf am 2026-09-24 persistierte 6.083 Events aus 20 Sessions (30 ev/s, 10 s), 603 ev/s aggregiert, RSS 169 MB. K4 ist kein offener Punkt mehr: der echte MCP-`tools/list`-Manifesttest zählt mit o200k_base/cl100k_base und hält 280/274 Tokens (ADR-0021, EPIC-P7 T7.4). Der neue Backend-Baseline-Lauf mit 20 parallelen STT-Anfragen auf demselben 3,8-s-Piper-Testdiktat lieferte 20/20 Antworten; p95 5,24 s und misst nur den lokalen `uacc-stt`-Endpunkt. Die 2-s-Aktionsanforderung ist damit nicht erfüllt/nachgewiesen; der Backendlauf ersetzt keine 20 Hub-Sessions oder Geräteabnahme. Offen bleiben deterministische Klärung der beobachteten tmux-Test-Unzuverlässigkeit, weitere unbelegte K1–K10-Zellen, Hardware-Messungen, Secret-Scan im passenden CI-/Gerätepfad und **AI-P10-3:** K2/K8 unter echter Sprachlast mit 20 Sessions.
- [ ] **T12.3 — Backup, Restore und Retention.** Implementierung für verschlüsseltes Backup/Restore, Attachments, Drafts, Pending-Aktionen und Flotten-Metadaten in MR !114; Gate und Referenzprüfungen grün. Isolierter Live-Rundlauf mit echter Hub-Implementierung und gestoppter Dummy-Session: verschlüsseltes Archiv 7.442 Byte / Modus `0600`, Restore in neues Datadir, Health 200, Session und alle 65 Events samt Sentinel erhalten. Produktivdatadir: 61 Dateien / 2.121.042 Byte, SQLite ohne WAL/SHM; der echte Backup-Lauf wurde korrekt abgelehnt, weil noch ein `opencode acp`-tmux-Worker im Worktree aktiv ist. Er wurde nicht beendet; die Produktivmessung wartet auf Abschluss oder ausdrückliche Stop-Entscheidung. Echte Produktiv-Latenzen und ENOSPC-Lauf ebenfalls offen. K5/K7/K10. Beleg: [Messlauf](../docs/messlauf/2026-09-24-p12-lokale-evidenz.md).
- [ ] **T12.4 — Abnahme aller Zielkombinationen.** Matrix von P5/P7/P11 live ausführen; Smartphone über WAN, PC↔Handy↔PC, Voice/AI/Freigaben/Suche/Dateien; nicht nur Loopback und Fixtures. K1–K10. **AI-P10-1 (aus T10.5):** ≥ 20 Fachbegriff-Diktate je Zielgerät mit echter Stimme, Headset, Störgeräusch, Permission-Deny, Coldstart, WAN (AC-P10-1). **AI-P11-1/2 (aus T11.4/T11.5):** Desktop-Companion am echten Hyprland-Desktop mit dir abnehmen (3 Apps × 10, Keybind-Not-Stopp, WAN-Abbruch), GUI-Harness-Flows (Claude Desktop/Cursor …) und die GTK3-Zelle prüfen. **AI-P10.5-2:** Videofrage über eine echte Harness-Session (opencode + lokales Modell) und ein Video > 20 min (Teil-Zusammenfassung). **AI-P9-1:** Planer auf ≥ 100 echten Formulierungen aus dem Betrieb messen (vorher nicht schärfen). **AI-P9-2:** Anhang aus dem Teilen-Menü (Web Share Target) mit Gerätetest. **AI-P8-1:** Gerätetest am Handy: Push im Hintergrund/Sperrbildschirm, echter Flugmodus, Bildschirmtastatur, 200 % Text, TalkBack/VoiceOver. **AI-P8-2:** Peer-Meldungen als Push über den Heim-Hub. **AI-P7-3:** Gatekeeper (T7.9) auf ≥ 100 echten, unabhängig gelabelten Tool-Anfragen aus dem Betrieb nachmessen. Enthält AI-P5-1: Handläufe für Claude Code, Codex, Copilot nach EPIC-P5 §12.4, danach deren Resume-Zelle `verified`. **AI-P6-1:** einen WSL-Host (z. B. bmax) in die Flotte aufnehmen und damit den WSL-Teil von AC-P6-5 und Premortem 4 aus P6 abnehmen. **Aus T7.5:** aider mit dem lokalen Modell live (aider hat kein Tool-Gate; Lauf mit `--yes-always` braucht die ausdrückliche Freigabe des Nutzers).
- [ ] **T12.5 — Dauerlauf und Übergabe.** 24 h mit ≥ 20 Sessions, Netz-/Hub-/Modell-Ausfälle, Ressourcenentwicklung; Runbook, bekannte Grenzen, Installationsversuch durch frischen Nutzerkontext und offene P4-Integrationsevidenz prüfen. K2/K7/K8/K9/K10.
- [x] **T12.6 — Remote-Gate wiederherstellen (AI-P5-2).** GitLab-CI scheitert mit `ci_quota_exceeded`, bevor Jobs starten. Am 2026-09-24 über GitLab geprüft: Head-Pipelines !112 `2878654175`, !113 `2879084593` und !114 `2879646701` scheiterten jeweils nach 0 s an diesem Runner-/Kontingentfehler; `verify` und `e2e` starteten nicht. Für diesen Zustand dokumentiert `docs/testing-e2e.md` die befristete Ausnahme: vollständiges lokales `npm run gate` mit Branch/Commit, Ergebnis und Skips im MR als Merge-Evidenz; remote CI wird nicht als grün ausgegeben. Die MRs !112/!113/!114 sind weiterhin offen, !114 zielt auf den noch nicht gemergten P11-Branch. Beleg: [GitLab MRs](https://gitlab.com/SiLenT_Tz/mobile-hub/-/merge_requests/112), [!113](https://gitlab.com/SiLenT_Tz/mobile-hub/-/merge_requests/113), [!114](https://gitlab.com/SiLenT_Tz/mobile-hub/-/merge_requests/114) und [Messlauf](../docs/messlauf/2026-09-24-p12-lokale-evidenz.md). Normales Remote-Gate gilt wieder, sobald Runner/Kontingent verfügbar sind.
- [ ] **T12.8 — Swarm-Adapter (aus T7.5).** `custom-rag` Coding-Swarm (`/v2/swarm`, ADR-0001) als Adapter: Gate-Ergebnisse → Freigaben (`POST /runs/{id}/decisions`), Kinder/Rollen als Timeline. Die Cockpit-API verlangt `require_admin` und das Feature `swarm_cockpit`; es gibt weiterhin kein für den Hub eingerichtetes Admin-Credential bzw. bestätigtes Feature-Lizenz-Setup, daher ist Live-Zugriff nicht möglich. Das Quell-Repository liegt jetzt lokal vor: `RunEvent` ist `{seq, kind, at, node?, payload}`; die Engine emittiert u. a. `run.started`, `node.entered`, `run.finished`, `run.aborted`, `run.budget_exceeded` und `run.cleanup`. Eine echte Lauf-JSONL wurde nicht gefunden; genaue reale Payloads/Rollen-Zuordnung und Freigabe-Rückweg sind deshalb live ungeprüft. Beides darf nicht durch Trajektorien-Events oder Fixtures ersetzt werden (R9.7).
- [x] **T12.9 — Lokales Modell neben Halogen betreiben (AI-P7-4).** Das Desktop-Skript `/srv/securesight.ai/Desktop-Admin/Model Inference/halogen-starten.sh` stoppt `qwen35-122b-server`, `bunker-llama`, `bunker-llama-router` und per `pkill -x llama-server` alle übrigen Modellserver, startet dann `halogen-server`, `halogen-live-proxy` und den Halogen-Wächter. Nach dem Skript muss `uacc-llama` ausdrücklich mit `systemctl --user start uacc-llama` folgen; ein sauber beendeter UACC-Server startet wegen `Restart=on-failure` nicht selbst. Am 2026-09-24 live belegt: nach diesem Folgeschritt liefen Halogen und UACC gleichzeitig, `/v1/models` antwortete authentifiziert mit `qwen3-coder`, beide Halogen-Units/Proxy/Wächter blieben aktiv. Evox2 meldete 89 GiB belegt / 34 GiB verfügbar von 123 GiB. Der Gatekeeper fällt beim Modell-Ausfall fail-closed auf Regeln + mindestens WARNING zurück. Beleg: [P12-Messlauf](../docs/messlauf/2026-09-24-p12-lokale-evidenz.md), [`local-llm.md`](../docs/local-llm.md), [P7-Messlauf](../docs/messlauf/2026-09-24-p7-harness-gates.md).
- [ ] **T12.10 — Teiltranskripte beim Diktat (AI-P10-2).** Streaming-Erkennung mit VAD; Teilresultate nur zur Anzeige, nie als Befehl; AC-P10-2 (erstes Teiltranskript p95 ≤ 500 ms, sichtbare Aktion p95 ≤ 2 s) auf Geräten messen. Messlauf 2026-09-24: 20 parallele Anfragen an den bestehenden Offline-Whisper-Endpunkt lieferten Text, aber p95 5,24 s schon für 3,81-s-Diktate. Eine ergänzende Messung über den echten Hub-`/api/stt`-Pfad mit 20 Wiederholungen je 0,5-s- und 1-s-Segment ergab 20/20 Texte und p95 342 ms bzw. 328 ms nur für die abgeschlossene Anfrage. Das 0,5-s-Erfassungsfenster plus Inferenz liegt damit rechnerisch bei mindestens 842 ms ab Sprachbeginn. Das ist keine Teiltranskript-Implementierung. Die offizielle [`whisper.cpp`-`stream`-Beispielimplementierung](https://github.com/ggml-org/whisper.cpp/blob/master/examples/stream/README.md) liest lokal per SDL-Mikrofon und ist kein HTTP-Streaming-API; die vorhandene `/inference`-Route verarbeitet vollständige Dateien. VAD/Teiltranskripte bleiben offen, bis ein passender lokaler Streamingpfad implementiert und auf Geräten gemessen ist. Baseline: [P12-Messlauf](../docs/messlauf/2026-09-24-p12-lokale-evidenz.md).
- [x] **T12.11 — Lokales Bildmodell für die Videoanalyse (AI-P10.5-1).** Qwen2.5-VL-3B Q4_K_M + Q8-mmproj über llama.cpp als eigener, schlüsselgeschützter `uacc-vision`-Dienst auf evox2; Hub-Config `media.vision` und `maxFrames: 30` eingerichtet; Speicher neben uacc-llama/Halogen gemessen. 30 gleichmäßig gezogene Frames des 18-s-Testvideos wurden geprüft: alle 30 Modellantworten erkannten die drei tatsächlichen Folientitel und den sichtbaren Text; p95 Antwortzeit 1,52 s. Der echte MediaJobs-Pfad verarbeitete 3/3 Szenen-Keyframes mit Beschreibung + OCR und ohne Cloud-Egress. Langvideo-/Harness-Abnahme bleibt T12.4. Beleg: [P12-Messlauf](../docs/messlauf/2026-09-24-p12-lokale-evidenz.md), [`local-llm.md`](../docs/local-llm.md).
- [ ] **T12.12 — Leckfreie Desktop-Eingabe (AI-P11-3).** MR !113 ergänzt adressierte Hyprland-Tasten und sperrt Text, bis „Gezielt einfügen“ sichtbar aktiviert ist; Full Gate grün (102 Testdateien/629 Tests, 151 E2E, 2 Skips). Offen bleibt die reale Leck-Messung 0/50: isolierter Hyprland-Start scheiterte erneut mit Aquamarine `CBackend::create() failed!`; echter Desktop nicht verwendet.
- [ ] **T12.7 — Vor der Veröffentlichung: Geheimnisse aufräumen (AI-P6-4).** Lokale Gerätetokens `diag`/`pixel` rotiert (nach versehentlicher Anzeige der Werte nochmals widerrufen/ersetzt), alter `/tmp/uacc-hub.log` entfernt, beide Fleet-Peers per frischem Invite neu gekoppelt. Der Logscan fand auf allen drei Hosts keine unmaskierten Tokenwerte. Der Startpfad setzt jetzt die Logdatei auf Modus `0600` (BUG-0029); Start/Health/Stop/Port/PID/WAL/SHM und abschließende Loglöschung wurden live geprüft. Offen: aktuelle lokale Gerätetokens auf Clients einspielen und dort prüfen; das Fairphone zeigte bei Rückkehr des ADB-Zugriffs den gesperrten Sperrbildschirm und Flugzeugmodus. Das Gerät wurde nicht entsperrt oder umkonfiguriert. Siehe [Messlauf](../docs/messlauf/2026-09-24-p12-lokale-evidenz.md). Gitleaks-History-Scan fand nur zwei dokumentierte synthetische Test-Fixture-Treffer. Public-Schaltung bleibt separat.

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
