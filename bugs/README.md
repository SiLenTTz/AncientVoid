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
| [BUG-0001](bug-0001-k7-recovery-race-under-load.md) | K7-Recovery-Test race unter CPU-Last | done | S3 | core | [#1](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/1) |
| [BUG-0002](bug-0002-cross-file-timer-delay-singlefork.md) | Zeitbasierte sessionmanager-Tests verzögert nach anderer Testdatei | done | S3 | core | [#2](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/2) |
| [BUG-0003](bug-0003-k7-seq-gap-unknown-cause.md) | K7-Test sah echte Sequenzlücke in CI (EventStore-Flush-Race) | done | S2 | core | [#3](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/3) |
| [BUG-0004](bug-0004-adapter-testkit-no-spawnworker-override.md) | adapter-testkit kann keinen spawnWorker-nutzenden Adapter testen | fixed | S2 | core | [#4](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/4) |
| [BUG-0005](bug-0005-hubctl-tail-invalid-ws-url.md) | hubctl tail -f konnte nie eine WS-Verbindung aufbauen | done | S1 | hubctl | [#5](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/5) |
| [BUG-0006](bug-0006-pwa-onboarding-unreachable.md) | Neue PWA konnte Onboarding-Flow nie durchlaufen | done | S1 | server | [#6](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/6) |
| [BUG-0007](bug-0007-ws-drop-on-slow-not-network-aware.md) | `dropped:true` reagiert nicht auf echtes gedrosseltes Netz | done | S2 | server | [#7](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/7) |
| [BUG-0008](bug-0008-heartbeat-false-error-after-normal-turn.md) | Heartbeat markiert erfolgreich abgeschlossenen Turn als `status:error` | done | S1 | core | [#8](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/8) |
| [BUG-0009](bug-0009-pwadir-silently-unresolved.md) | Fehlkonfigurierter `pwaDir` scheitert komplett still | done | S1 | server | [#9](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/9) |
| [BUG-0010](bug-0010-pwa-never-actually-typechecked.md) | `packages/pwa` wurde nie wirklich typgeprüft (oder gebaut) in CI | done | S2 | pwa | [#10](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/10) |
| [BUG-0011](bug-0011-stop-button-silently-broken.md) | "Stop"-Button sendete einen leeren Body mit JSON-Content-Type — echter 400, still verschluckt | fixed | S1 | pwa | — (GitLab derzeit nicht erreichbar) |
| [BUG-0012](bug-0012-tmux-env-key-shell-injection.md) | `TmuxRunner.spawn()`: unvalidierte env-Keys = echte Shell-Injection (RCE) | fixed | S1 | workers | — (GitLab derzeit nicht erreichbar) |
| [BUG-0013](bug-0013-mcp-gateway-sessionid-route-confusion.md) | MCP-Gateway: `sessionId` bricht per `?`/`..` aus dem Pfad-Template aus | fixed | S2 | gateway-mcp | — (GitLab derzeit nicht erreichbar) |
| [BUG-0014](bug-0014-search-indexes-worktree-duplicates.md) | Sprachsuche zeigt Git-Worktree-Kopien als doppelte Treffer | fixed | S3 | server | — |
| [BUG-0015](bug-0015-offline-reload-token-gate.md) | Offline-Neuladen zeigt Token-Anmeldung statt gecachter Sessions (K10) | fixed | S2 | pwa | [#11](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/11) |
| [BUG-0016](bug-0016-reopen-ignores-input-id.md) | Wiederholte Eingabe startet eine gestoppte Session zweimal | fixed | S1 | core | — |
| [BUG-0017](bug-0017-concurrent-reopen-double-run.md) | Handy und PC öffnen eine gestoppte Session gleichzeitig: zwei Läufe | fixed | S1 | core, pwa | — |
| [BUG-0018](bug-0018-recovery-replays-stopped-sessions.md) | Hub-Start liest den Verlauf jeder gestoppten Session ein (K7) | fixed | S2 | core | — |
| [BUG-0019](bug-0019-tmux-reap-kills-foreign-workers.md) | Ein zweiter Hub oder `npm test` tötet die tmux-Worker des laufenden Hubs | fixed | S1 | workers | — |
| [BUG-0020](bug-0020-diff-hides-new-files.md) | Diff und Bericht zeigen keine neu angelegten Dateien | fixed | S2 | server | — |
| [BUG-0021](bug-0021-skill-chain-misses-base-catalog.md) | Skill-Kette ist kürzer, wenn vorher niemand die Skill-Liste geöffnet hat | fixed | S2 | server | — |
| [BUG-0022](bug-0022-reply-box-missing-after-offline-open.md) | Antwortfeld fehlt dauerhaft, wenn der Hub beim Öffnen kurz weg war | fixed | S3 | pwa | — |
| [BUG-0023](bug-0023-chat-duplicates-overlapping-batches.md) | Chat zeigt Events doppelt nach Resync oder Replay | fixed | S2 | pwa | — |
| [BUG-0024](bug-0024-session-link-mixes-histories.md) | Ein Link auf eine andere Session mischt beide Verläufe | fixed | S2 | pwa | — |
| [BUG-0025](bug-0025-tmux-kill-never-reports-exit.md) | Ein per Kill beendeter tmux-Worker meldet nie sein Ende | fixed | S2 | workers | — |
| [BUG-0026](bug-0026-tail-opens-with-oldest-100.md) | Eine geöffnete Session zeigt nur ihre ersten 100 Events | fixed | S1 | server, pwa | — |
| [BUG-0027](bug-0027-stop-deletes-agent-work.md) | Stop löscht die nicht committete Arbeit eines Agenten | fixed | S1 | core | — |
| [BUG-0028](bug-0028-tokens-in-request-log.md) | Geräte-Tokens stehen im Klartext im Request-Log | fixed | S1 | server | — |
| [BUG-0029](bug-0029-hub-log-default-permissions.md) | Hub-Log wird mit der Benutzer-umask für andere lesbar angelegt | done | S3 | hub.sh | — |
| [BUG-0030](bug-0030-data-directory-world-readable.md) | Hub-Datadir und SQLite-Credentials sind für andere Benutzer lesbar | done | S2 | core, hubctl | — |
| [BUG-0031](bug-0031-token-login-waits-for-fleet-hello.md) | Token-Login wartet auf Fleet-Handshake | done | S3 | pwa | — |
| [BUG-0032](bug-0032-acp-turn-haengt-ohne-timeout.md) | ACP-Zug kann endlos hängen: kein Turn-Timeout, Herzschlag blind | done | S1 | adapters | [!124](https://gitlab.com/SiLenT_Tz/mobile-hub/-/merge_requests/124) |
| [BUG-0033](bug-0033-acp-verlauf-erst-nach-zugende.md) | ACP-Verlauf kommt live nie an + Chat-Marker fehlen (ACP vs. CLI-Adapter) | done | S2 | adapters, pwa | [!125](https://gitlab.com/SiLenT_Tz/mobile-hub/-/merge_requests/125) |
| [BUG-0034](bug-0034-messlauf-laesst-acp-worker-zurueck.md) | Messlauf hinterlässt ACP-Worker und Zombie-tmux-Server | done | S2 | messlauf, workers | [!129](https://gitlab.com/SiLenT_Tz/mobile-hub/-/merge_requests/129) |

| [BUG-0035](bug-0035-entdecken-zeigt-aelteste-zuerst.md) | Entdecken paginiert unsortiert: älteste zuerst, aktuelle erst auf Seite 3 | done | S2 | core | [!131](https://gitlab.com/SiLenT_Tz/mobile-hub/-/merge_requests/131) |
| [BUG-0036](bug-0036-acp-recovery-replayed-historie.md) | ACP-Recovery replayed die geladene Historie als neue Events | fixed | S1 | adapters | — |
| [BUG-0037](bug-0037-hub-down-nach-sigterm-ohne-restart.md) | Hub blieb nach SIGTERM-Exit down: kein Restart bei status 0 | done | S1 | hub.sh | — |
| [BUG-0038](bug-0038-cursor-exit-1-ohne-modell.md) | Cursor-Sessions crashen ohne Modell: Exit 1 (out of usage) | fixed | S1 | adapters | — |
| [BUG-0039](bug-0039-acp-adoption-verliert-historie.md) | Übernommene ACP-Session zeigt keine Historie: ewiges „lädt…" | fixed | S1 | adapters | — |
| [BUG-0040](bug-0040-claude-cli-klartextfehler-und-neue-eventtypen.md) | Claude-CLI: Klartext-Fehler und neue Event-Typen erscheinen kryptisch | done | S2 | adapters | — |
| [BUG-0041](bug-0041-voice-aufnahme-laeuft-bei-gesperrtem-bildschirm.md) | Voice-Aufnahme läuft weiter, wenn der Bildschirm schon gesperrt ist | done | S3 | pwa | — |

Die nächste freie Nummer ist **0042**.
