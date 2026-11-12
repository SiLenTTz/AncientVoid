# Bugs — beobachtete Defekte

Git/Markdown ist SSOT, analog zu `epics/`. Ein Bug ohne Repro ist eine
Vermutung; die Datei hier ist die Zusage, dass jemand den Defekt **gesehen**
hat. Die GitLab-Issue ist der Tracker für Zuweisung — nicht die zweite
Wahrheit.

Anlegen: Skill [`bug-report`](../.claude/skills/bug-report/SKILL.md).
Beheben: Skill [`bugfix`](../.claude/skills/bugfix/SKILL.md).

## Regeln

| Feld | Wert |
|---|---|
| Dateiname | `bugs/bug-NNNN-slug.md` — 4-stellig, kebab, ASCII |
| Vorlage | [`template.md`](template.md) |
| Nächste ID | max(existierende `NNNN`) + 1; die erste Datei ist `bug-0001-…` |
| Status | `open` · `in-progress` · `done` · `wont-fix` — im Frontmatter |
| Geschlossen | Datei **bleibt** hier; `status` und MR-Link nachziehen. Kein Archiv. |

Ein Bug ist **ein** Verhalten. Zwei Symptome → zwei Dateien.

## Index

| ID | Titel | Status | Schwere | Bereich | Forge |
|---|---|---|---|---|---|
| [BUG-0001](bug-0001-k7-recovery-race-under-load.md) | K7-Recovery-Test race unter CPU-Last | done | S3 | core | [#1](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/1) |
| [BUG-0002](bug-0002-cross-file-timer-delay-singlefork.md) | Zeitbasierte sessionmanager-Tests verzögert nach anderer Testdatei | done | S3 | core | [#2](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/2) |
| [BUG-0003](bug-0003-k7-seq-gap-unknown-cause.md) | K7-Test sah echte Sequenzlücke in CI (EventStore-Flush-Race) | done | S2 | core | [#3](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/3) |
| [BUG-0004](bug-0004-adapter-testkit-no-spawnworker-override.md) | adapter-testkit kann keinen spawnWorker-nutzenden Adapter testen | done | S2 | core | [#4](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/4) |
| [BUG-0005](bug-0005-hubctl-tail-invalid-ws-url.md) | hubctl tail -f konnte nie eine WS-Verbindung aufbauen | done | S1 | hubctl | [#5](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/5) |
| [BUG-0006](bug-0006-pwa-onboarding-unreachable.md) | Neue PWA konnte Onboarding-Flow nie durchlaufen | done | S1 | server | [#6](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/6) |
| [BUG-0007](bug-0007-ws-drop-on-slow-not-network-aware.md) | `dropped:true` reagiert nicht auf echtes gedrosseltes Netz | done | S2 | server | [#7](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/7) |
| [BUG-0008](bug-0008-heartbeat-false-error-after-normal-turn.md) | Heartbeat markiert erfolgreich abgeschlossenen Turn als `status:error` | done | S1 | core | [#8](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/8) |
| [BUG-0009](bug-0009-pwadir-silently-unresolved.md) | Fehlkonfigurierter `pwaDir` scheitert komplett still | done | S1 | server | [#9](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/9) |
| [BUG-0010](bug-0010-pwa-never-actually-typechecked.md) | `packages/pwa` wurde nie wirklich typgeprüft (oder gebaut) in CI | done | S2 | pwa | [#10](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/10) |
| [BUG-0011](bug-0011-stop-button-silently-broken.md) | "Stop"-Button sendete einen leeren Body mit JSON-Content-Type — echter 400, still verschluckt | done | S1 | pwa | — (GitLab derzeit nicht erreichbar) |
| [BUG-0012](bug-0012-tmux-env-key-shell-injection.md) | `TmuxRunner.spawn()`: unvalidierte env-Keys = echte Shell-Injection (RCE) | done | S1 | workers | — (GitLab derzeit nicht erreichbar) |
| [BUG-0013](bug-0013-mcp-gateway-sessionid-route-confusion.md) | MCP-Gateway: `sessionId` bricht per `?`/`..` aus dem Pfad-Template aus | done | S2 | gateway-mcp | — (GitLab derzeit nicht erreichbar) |
| [BUG-0014](bug-0014-search-indexes-worktree-duplicates.md) | Sprachsuche zeigt Git-Worktree-Kopien als doppelte Treffer | done | S3 | server | — |
| [BUG-0015](bug-0015-offline-reload-token-gate.md) | Offline-Neuladen zeigt Token-Anmeldung statt gecachter Sessions (K10) | done | S2 | pwa | [#11](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/11) |
| [BUG-0016](bug-0016-reopen-ignores-input-id.md) | Wiederholte Eingabe startet eine gestoppte Session zweimal | done | S1 | core | — |
| [BUG-0017](bug-0017-concurrent-reopen-double-run.md) | Handy und PC öffnen eine gestoppte Session gleichzeitig: zwei Läufe | done | S1 | core, pwa | — |
| [BUG-0018](bug-0018-recovery-replays-stopped-sessions.md) | Hub-Start liest den Verlauf jeder gestoppten Session ein (K7) | done | S2 | core | — |
| [BUG-0019](bug-0019-tmux-reap-kills-foreign-workers.md) | Ein zweiter Hub oder `npm test` tötet die tmux-Worker des laufenden Hubs | done | S1 | workers | — |
| [BUG-0020](bug-0020-diff-hides-new-files.md) | Diff und Bericht zeigen keine neu angelegten Dateien | done | S2 | server | — |
| [BUG-0021](bug-0021-skill-chain-misses-base-catalog.md) | Skill-Kette ist kürzer, wenn vorher niemand die Skill-Liste geöffnet hat | done | S2 | server | — |
| [BUG-0022](bug-0022-reply-box-missing-after-offline-open.md) | Antwortfeld fehlt dauerhaft, wenn der Hub beim Öffnen kurz weg war | done | S3 | pwa | — |
| [BUG-0023](bug-0023-chat-duplicates-overlapping-batches.md) | Chat zeigt Events doppelt nach Resync oder Replay | done | S2 | pwa | — |
| [BUG-0024](bug-0024-session-link-mixes-histories.md) | Ein Link auf eine andere Session mischt beide Verläufe | done | S2 | pwa | — |
| [BUG-0025](bug-0025-tmux-kill-never-reports-exit.md) | Ein per Kill beendeter tmux-Worker meldet nie sein Ende | done | S2 | workers | — |
| [BUG-0026](bug-0026-tail-opens-with-oldest-100.md) | Eine geöffnete Session zeigt nur ihre ersten 100 Events | done | S1 | server, pwa | — |
| [BUG-0027](bug-0027-stop-deletes-agent-work.md) | Stop löscht die nicht committete Arbeit eines Agenten | done | S1 | core | — |
| [BUG-0028](bug-0028-tokens-in-request-log.md) | Geräte-Tokens stehen im Klartext im Request-Log | done | S1 | server | — |
| [BUG-0029](bug-0029-hub-log-default-permissions.md) | Hub-Log wird mit der Benutzer-umask für andere lesbar angelegt | done | S3 | hub.sh | — |
| [BUG-0030](bug-0030-data-directory-world-readable.md) | Hub-Datadir und SQLite-Credentials sind für andere Benutzer lesbar | done | S2 | core, hubctl | — |
| [BUG-0031](bug-0031-token-login-waits-for-fleet-hello.md) | Token-Login wartet auf Fleet-Handshake | done | S3 | pwa | — |
| [BUG-0032](bug-0032-acp-turn-haengt-ohne-timeout.md) | ACP-Zug kann endlos hängen: kein Turn-Timeout, Herzschlag blind | done | S1 | adapters | [!124](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/124) |
| [BUG-0033](bug-0033-acp-verlauf-erst-nach-zugende.md) | ACP-Verlauf kommt live nie an + Chat-Marker fehlen (ACP vs. CLI-Adapter) | done | S2 | adapters, pwa | [!125](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/125) |
| [BUG-0034](bug-0034-messlauf-laesst-acp-worker-zurueck.md) | Messlauf hinterlässt ACP-Worker und Zombie-tmux-Server | done | S2 | messlauf, workers | [!129](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/129) |
| [BUG-0035](bug-0035-entdecken-zeigt-aelteste-zuerst.md) | Entdecken paginiert unsortiert: älteste zuerst, aktuelle erst auf Seite 3 | done | S2 | core | [!131](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/131) |
| [BUG-0036](bug-0036-acp-recovery-replayed-historie.md) | ACP-Recovery replayed die geladene Historie als neue Events | done | S1 | adapters | — |
| [BUG-0037](bug-0037-hub-down-nach-sigterm-ohne-restart.md) | Hub blieb nach SIGTERM-Exit down: kein Restart bei status 0 | done | S1 | hub.sh | — |
| [BUG-0038](bug-0038-cursor-exit-1-ohne-modell.md) | Cursor-Sessions crashen ohne Modell: Exit 1 (out of usage) | done | S1 | adapters | — |
| [BUG-0039](bug-0039-acp-adoption-verliert-historie.md) | Übernommene ACP-Session zeigt keine Historie: ewiges „lädt…" | done | S1 | adapters | — |
| [BUG-0040](bug-0040-claude-cli-klartextfehler-und-neue-eventtypen.md) | Claude-CLI: Klartext-Fehler und neue Event-Typen erscheinen kryptisch | done | S2 | adapters | — |
| [BUG-0041](bug-0041-voice-aufnahme-laeuft-bei-gesperrtem-bildschirm.md) | Voice-Aufnahme läuft weiter, wenn der Bildschirm schon gesperrt ist | done | S3 | pwa | — |
| [BUG-0042](bug-0042-invite-qr-chunk-fehler-unbehandelt.md) | Einladungs-QR: fehlgeschlagener Chunk-Abruf bleibt unbehandelt und still | done | S3 | pwa | — |
| [BUG-0043](bug-0043-verlauf-springt-nach-unten-beim-lesen.md) | Verlauf springt nach unten, während man weiter oben liest | done | S2 | pwa | — |
| [BUG-0044](bug-0044-letzte-nachrichten-unter-dem-dock.md) | Die letzten Nachrichten liegen unter dem fixierten Dock | done | S2 | pwa | — |
| [BUG-0045](bug-0045-einzelner-abruffehler-laesst-ui-flackern.md) | Ein einzelner fehlgeschlagener Abruf lässt Meldungen aufflackern | done | S3 | pwa | — |
| [BUG-0046](bug-0046-thinking-block-leer-und-aufklappbar.md) | Aufgeklappte „thinking“-Blöcke sind immer leer | done | S3 | adapters, pwa | — |
| [BUG-0047](bug-0047-pc-tippen-leert-text-vor-dem-ergebnis.md) | „Am PC eintippen“ leert den Text, bevor der PC getippt hat | done | S3 | pwa | — |
| [BUG-0048](bug-0048-freigabe-noetig-haengt-nach-neustart.md) | „Freigabe nötig“ bleibt stehen, obwohl nichts zu entscheiden ist | done | S2 | core | — |
| [BUG-0049](bug-0049-meldung-flackert-beim-tippen.md) | Eine Meldung flackert auf (Entwurf-Zeile, Hub-Hinweise, „Am PC offen“) | done | S3 | pwa, core | — |
| [BUG-0050](bug-0050-recovery-nacheinander-statt-parallel.md) | Hub-Recovery braucht 12–14 s statt unter 3 s (K7) | done | S2 | core | — |
| [BUG-0051](bug-0051-gatekeeper-wertet-heredoc-inhalt-als-befehl.md) | Gatekeeper wertet den Inhalt eines Here-Documents als Befehl | done | S2 | core | — |
| [BUG-0052](bug-0052-e2e-zufallsport-kollidiert.md) | E2E: Zufallsport der Stand-in-Server kollidiert mit fremden Prozessen | done | S3 | e2e | — |
| [BUG-0053](bug-0053-dock-im-querformat-zu-hoch.md) | Im Querformat füllt das Dock fast den Bildschirm, der Verlauf ragt darunter | done | S2 | pwa | — |
| [BUG-0054](bug-0054-token-gate-bleibt-trotz-token.md) | Die Übersicht öffnet nicht, obwohl das Token schon im Feld steht | done | S3 | pwa | [#12](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/12) |
| [BUG-0055](bug-0055-handy-devtools-bricht-im-lauf-ab.md) | Die DevTools-Verbindung zum Handy-Chrome bricht mitten im Lauf ab | done | S3 | e2e | [#13](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/13) |
| [BUG-0057](bug-0057-claude-discovery-tiefe-projekte-bleiben-gemunged.md) | Claude-Discovery zeigt tiefer verschachtelte Projekte gemunged statt als Pfad | done | S3 | core | keine |
| [BUG-0056](bug-0056-code-suche-nicht-im-viewport.md) | „Code durchsuchen“ liegt nach einer Aktion nicht mehr im Bild | done | S3 | pwa | [#14](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/14) |
| [BUG-0058](bug-0058-acp-dsh-modellkatalog-leer.md) | dsh: Modellauswahl am Handy bleibt leer (Profil models entfällt) | done | S2 | adapters | — |
| [BUG-0059](bug-0059-dsh-deklariert-bilder-ohne-bildeingabe.md) | dsh: Adapter deklariert Bilder, der Agent nimmt keine Bildeingabe | done | S3 | adapters | — |
| [BUG-0060](bug-0060-recovery-weiter-ueber-k7-trotz-parallelisierung.md) | Recovery braucht weiter über 12 s trotz paralleler Wiederherstellung (K7) | done | S2 | core | — |

| [BUG-0061](bug-0061-dsh-prompt-verbessern-fehlt.md) | „Verbessern“ fehlt für DeepSeek-Harness-Sessions | done | S3 | server, pwa | [#16](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/16) |
| [BUG-0062](bug-0062-eta-waechst-bei-altem-plan.md) | Restzeit-Schätzung wächst, statt zu schrumpfen | done | S3 | pwa | [#17](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/17) |
| [BUG-0063](bug-0063-chat-aktivitaet-unsauber-sichtbar.md) | Im Chat ist nicht sichtbar genug, ob der Agent aktiv ist | done | S3 | pwa | [#18](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/18) |
| [BUG-0064](bug-0064-pi-model-ohne-reasoning-deklariert.md) | Agent-Modell als non-thinking deklariert — Denken nicht steuerbar | done | S3 | agent-tooling | [#19](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/19) |
| [BUG-0065](bug-0065-pi-verlauf-ohne-tools-und-thinking.md) | pi-Verlauf zeigt nur die Schlussantwort: kein Streaming, keine Tool-Calls, kein Thinking | done | S2 | adapters | [#20](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/20) |
| [BUG-0066](bug-0066-pi-bekommt-exec-als-prompt.md) | pi bekommt „exec" als eigene Nachricht und den Prompt in Anführungszeichen | done | S2 | adapters | [#21](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/21) |
| [BUG-0067](bug-0067-chat-zeigt-markdown-als-rohtext.md) | Chat zeigt Markdown der Agenten als Rohtext | done | S3 | pwa | [#22](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/22) |
| [BUG-0068](bug-0068-lange-antwort-im-chat-gekuerzt.md) | Antworten über 4 KB zeigt der Chat nur mit 200 Zeichen | done | S2 | pwa | [#23](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/23) |
| [BUG-0069](bug-0069-worktree-testet-pakete-von-main.md) | Gates im Session-Worktree testen die `@ancientvoid/*`-Pakete des Haupt-Checkouts | done | S2 | core, e2e | [#24](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/24) |
| [BUG-0070](bug-0070-claude-tool-progress-heartbeat-spam.md) | Claude-Heartbeats (`tool_progress`) füllen den Verlauf mit „unhandled stream-json type“ | done | S3 | adapters | [#25](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/25) |
| [BUG-0071](bug-0071-kachel-kuerzel-veralteter-zustand.md) | Zwei Kachel-Kürzel kurz hintereinander: das zweite arbeitet auf dem Zustand vor dem ersten | done | S3 | pwa | [#26](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/26) |
| [BUG-0072](bug-0072-hub-neustart-toetet-worker.md) | Neustart oder Absturz des Hub-Dienstes tötet die Worker und bricht laufende Züge ab | done | S2 | ops | [#27](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/27) |
| [BUG-0073](bug-0073-desktop-starter-zweiter-hub.md) | Der Desktop-Starter „AncientVoid“ startet einen zweiten Hub neben dem Dienst | done | S2 | ops | [#28](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/28) |
| [BUG-0074](bug-0074-hub-heap-oom-absturz.md) | Der Hub stürzt wiederholt mit „JavaScript heap out of memory“ ab | done | S1 | core | [#29](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/29) |
| [BUG-0075](bug-0075-hub-oom-resync-schleife.md) | Hub stürzt alle ~2 Min. mit Heap-OOM ab (Resync-Schleife, unsortierte Events) | done | S1 | core, server, pwa | — |
| [BUG-0076](bug-0076-pi-fehlerstatus-nach-erfolgreichem-turn.md) | pi: fehlerfreier Folgelauf bleibt `status:error` (stale `healthy=false`) | done | S1 | adapters | — |
| [BUG-0077](bug-0077-e2e-uebersicht-spec-einmalig-unter-last.md) | E2E-Übersichts-Spec fiel einmal unter voller Suite-Last (nicht reproduziert) | wont-fix | S3 | e2e | — |
| [BUG-0078](bug-0078-neue-session-stale-agent-auswahl.md) | Gemerkter Skill/Agent blockiert Session-Start bei Adaptern ohne Unterstützung („maki kennt keine Agenten.“) | done | S2 | pwa | [#32](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/32) |
| [BUG-0079](bug-0079-maki-slash-bridge-fuehrt-commands-nicht-aus.md) | maki-Slash-Brücke führte deklarierte Commands nicht aus („/new" kam nur als Chat an) | done | S2 | adapters | [#33](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/33) |
| [BUG-0080](bug-0080-slash-new-frische-session-ohne-modell.md) | Erste Nachricht nach /new stirbt an falschem Modell (403 → „Internal error") | done | S2 | adapters | [#34](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/34) |
| [BUG-0081](bug-0081-loop-start-wirkungslos.md) | Loop-Start im neuen Session-Dialog „tut nichts" (Blocker überlesbar, Pflicht-Selects galten nicht als gewählt) | done | S2 | pwa | — |
| [BUG-0082](bug-0082-notif-panel-ui-zoom.md) | Benachrichtigungs-Panel ragt bei UI-Zoom aus dem Bildschirm | done | S3 | pwa | — |
| [BUG-0083](bug-0083-pwa-freeze-securesight-anbindungsformular.md) | securesight-Anbindungsformular friert die PWA ein (endloser Render-Loop durch leere Modell-Vorgabe) | done | S1 | pwa | — |
| [BUG-0084](bug-0084-live-smoke-spezifische-locator-mehrdeutig.md) | Live-Smoke: Locator „Status"/„Einstellungen" mehrdeutig gegen den bevölkerten Live-Hub | done | S3 | e2e | — |
| [BUG-0085](bug-0085-factory-rollen-ohne-titel.md) | Factory-Beobachter erscheint ohne Auftrag | done | S2 | pwa | [#35](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/35) |
| [BUG-0086](bug-0086-factory-start-doppelte-laeufe.md) | Factory-Start bleibt im Formular und erzeugt doppelte Läufe | done | S2 | pwa | [#36](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/36) |
| [BUG-0087](bug-0087-factory-start-verwirft-maki.md) | Factory-Start verwirft maki und Modellwahl | done | S2 | server | [#37](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/37) |
| [BUG-0088](bug-0088-factory-treiber-falscher-workdir.md) | Factory-Treiber arbeitet außerhalb des beobachteten Projekts | done | S2 | core | [#38](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/38) |
| [BUG-0089](bug-0089-e2e-ci-host-label.md) | Konfigurierter eigener Host-Name wird in Fleet ignoriert | done | S3 | server | [#39](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/39) |
| [BUG-0090](bug-0090-desktop-e2e-wartet-auf-auftrag.md) | Desktop-E2E prüft Taste vor Ausführung | done | S3 | e2e | [#40](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/40) |
| [BUG-0091](bug-0091-steer-timeout-e2e-turn-race.md) | Timeout-E2E wartet vor Folgeauftrag nicht auf Turn-Ende | done | S3 | e2e | [#41](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/41) |
| [BUG-0108](bug-0108-policy-fail-open-leeres-label.md) | Token mit leerem Label umgeht die komplette Policy-Tabelle | done | S3 | server | [#42](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/42) |
| [BUG-0109](bug-0109-entpacken-ohne-groessenlimit.md) | Office-Expacken ohne Entpackgrößenlimit (Decompression-Bombe) | done | S3 | core | [#43](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/43) |
| [BUG-0110](bug-0110-agent-read-mapping-kosten.md) | Agent-Token löst Kosten-/Schreib-Endpunkte ohne Approval aus | done | S4 | server | [#44](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/44) |
| [BUG-0111](bug-0111-brave-crash-unter-voller-testlast.md) | Brave fällt unter voller lokaler Testlast aus (Renderer-SIGTRAP) | done | S3 | e2e | [#45](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/45) |
| [BUG-0112](bug-0112-popout-fenster-scrollt-bei-ui-zoom.md) | Eigenes Fenster (Chat) scrollt als ganze Seite bei UI-Zoom | done | S2 | pwa | — |
| [BUG-0113](bug-0113-dateien-schublade-browser-panel-ui-zoom.md) | Dateien-Schublade und Browser-Panel falsch vermessen bei UI-Zoom | open | S3 | pwa | — |
| [BUG-0114](bug-0114-vormerken-jetzt-sendens.md) | Vorgemerkte Nachricht lässt sich nicht sofort in den laufenden Zug senden | done | S3 | pwa | [#49](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/49) |
| [BUG-0115](bug-0115-sendqueuednow-bad-request.md) | „Jetzt senden" der Vormerkung schlägt in der PWA immer mit „Bad Request" fehl (leerer JSON-Body) | done | S3 | pwa | [#50](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/50) |

| [BUG-0115](bug-0115-automation-neuanlage-aktiv.md) | Automation-Neuanlage übernimmt Aktivierung | done | S2 | core | [#46](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/46) |
| [BUG-0116](bug-0116-automation-prompt-update-hash.md) | Automation-Update prüft Prompt-Hash nicht | done | S2 | core | [#47](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/47) |
| [BUG-0117](bug-0117-dock-acht-ziele-mobil.md) | Acht Dock-Ziele überlappen auf schmalen Displays | done | S2 | pwa | [#48](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/48) |
| [BUG-0118](bug-0118-session-menue-unter-steuerung.md) | Session-Menü liegt in niedriger Kachel unter der Steuerung | done | S3 | pwa | — |
| [BUG-0119](bug-0119-stdin-epipe-beendet-hub.md) | Ein gebrochenes stdin eines Workers beendet den ganzen Hub (EPIPE) | done | S2 | workers | — |
| [BUG-0120](bug-0120-parallele-playwright-laeufe-teilen-test-results.md) | Parallele Playwright-Läufe löschen sich gegenseitig die Artefakte | open | S3 | e2e | — |
| [BUG-0121](bug-0121-handy-lauf-session-test-zeitueberschreitung.md) | Am echten Handy: „neue Session aus der UI“ läuft in der Gesamtfolge in die Zeitüberschreitung | open | S3 | e2e | — |
| [BUG-0122](bug-0122-overlay-hoehen-ohne-ui-zoom-teilung.md) | Overlay-Höhen/-Breiten (Datei-Blatt, Dialoge, Composer maximiert) ohne Division durch --ui-zoom | done | S3 | pwa | P50 |
| [BUG-0123](bug-0123-doppelte-scrollbalken-session-kachel.md) | Zwei Scrollbalken rechts in der Session-Ansicht | done | S3 | pwa | P43 |
| [BUG-0124](bug-0124-menue-datei-oeffnet-dateibaum-nicht.md) | „Mehr → Datei“ öffnet den Dateibaum nicht, Tab zeigt nur einen Knopf | done | S3 | pwa | P43 |
| [BUG-0125](bug-0125-worktree-vitest-nutzt-fremde-workspace-pakete.md) | Tests im Worktree laden `@ancientvoid/*` aus dem Haupt-Checkout | done | S2 | tooling | — |
| [BUG-0126](bug-0126-native-session-verloren-session-klemmt.md) | Verlorene Provider-Session klemmt die Hub-Session fest (kein Reparieren/Übergeben) | done | S2 | adapters | — |
| [BUG-0127](bug-0127-suche-indexierung-qmd-schlaegt-fehl.md) | Such-Indexierung: qmd-Abfrage endet 500 statt 200 (4 rot-Tests auf main) | done | S2 | server | — |
| [BUG-0128](bug-0128-dateibaum-detach-als-einzelfenster.md) | Herauslösen der Datei-Seitenleiste erzeugt Einzeldatei-Fenster statt einem gebündelten Fenster | done | S3 | pwa | — |
| [BUG-0129](bug-0129-vault-ordnerwahl-symlink-ordner-fehlen.md) | Vault-Ordnerwahl: Symlink-Ordner fehlten, keine Pfad-Eingabe/Vorschläge (Fix via P51 T51.1–T51.2 / ADR-0063) | done | S3 | core | EPIC-P51 |
| [BUG-0130](bug-0130-setup-token-falsches-datadir.md) | Setup stellt Tokens in der falschen Datenbank aus | done | S2 | ops | [#51](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/51) |
| [BUG-0131](bug-0131-openai-fehler-still-verworfen.md) | OpenAI-Beispieladapter verschweigt Stream- und Folgepromptfehler | done | S2 | adapters | [#52](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/52) |
| [BUG-0132](bug-0132-setup-verwendet-fremden-hub.md) | Wizard erklärt einen fremden Hub zum erfolgreichen eigenen Setup | done | S2 | ops | [#53](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/53) |
| [BUG-0133](bug-0133-setup-node-mindestversion.md) | Angegebene Node-Mindestversion passt nicht zum ausführbaren Setup | done | S2 | ops | [#54](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/54) |
| [BUG-0134](bug-0134-setup-openai-json-escaping.md) | OpenAI-Wizard serialisiert Benutzereingaben als ungültiges JSON | done | S3 | ops | [#55](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/55) |
| [BUG-0135](bug-0135-setup-voidwarden-zweittokens.md) | Wiederholtes VoidWarden-Setup stellt zusätzliche Tokens aus | done | S3 | ops | [#56](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/56) |
| [BUG-0136](bug-0136-vormerkung-streichen-kommt-zurueck.md) | Gestrichene vorgemerkte Nachricht ist nach dem Neuladen wieder da | done | S2 | pwa, server | — |
| [BUG-0137](bug-0137-nyx-fab-laesst-sich-nicht-ziehen.md) | Der Voice-FAB lässt sich mit der Maus kaum verschieben | done | S3 | pwa | — |
| [BUG-0138](bug-0138-nyx-fab-verdeckt-dock-tasten.md) | Voice-FAB liegt in der Standardposition auf den Dock-Tasten | done | S2 | pwa | — |
| [BUG-0139](bug-0139-e2e-specs-lesen-title-statt-data-tip.md) | E2E-Specs lesen `title`, das der Tooltip-Layer in `data-tip` verschoben hat | done | S3 | e2e | — |
| [BUG-0140](bug-0140-e2e-kartenmenue-ohne-uebergeben.md) | Kleinkram-Regel 3 kennt den Kartenmenüpunkt „Übergeben…“ nicht | done | S3 | e2e | — |
| [BUG-0141](bug-0141-e2e-repo-graph-erwartet-einzeldatei-fenster.md) | Repo-Graph-Spec erwartet beim Herauslösen noch ein Einzeldatei-Fenster | done | S3 | e2e | — |
| [BUG-0142](bug-0142-e2e-fenster-schliessen-rennen.md) | „In die App zurück“ wird unter Last als „Target closed“ rot | done | S3 | e2e | — |
| [BUG-0143](bug-0143-e2e-selection-copy-ohne-fokus.md) | Markieren-kopiert-Spec unter voller Suite ohne Kopier-Bestätigung | done | S3 | e2e | — |
| [BUG-0144](bug-0144-openai-beispiel-vertrag.md) | OpenAI-Beispieladapter besteht die Testkit-Vertragsprüfung nicht | done | S3 | adapters | — |

Die nächste freie Nummer ist **0145**.
