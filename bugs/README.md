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

Die nächste freie Nummer ist **0007**.
