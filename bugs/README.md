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
| [BUG-0004](bug-0004-adapter-testkit-no-spawnworker-override.md) | adapter-testkit kann keinen spawnWorker-nutzenden Adapter testen | open | S2 | core | [#4](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/4) |
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

Die nächste freie Nummer ist **0015**.
