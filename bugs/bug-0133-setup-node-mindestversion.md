---
id: BUG-0133
slug: setup-node-mindestversion
status: done
severity: S2
area: ops
instance: dev
commit: "9d97e19"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/54"
epic: "EPIC-P53"
created: 2026-11-11
reporter: "Codex — Setup-/Modellanbindungs-Audit"
---

# BUG-0133 — Angegebene Node-Mindestversion passt nicht zum ausführbaren Setup

## Gesehen

README, package engines und Wizard akzeptieren Node 22.5; installierte Werkzeuge verlangen höhere Minor-Versionen und der Wizard startet TS-Dateien ohne Flags.

## Erwartet

AC: unterstützte Runtime-Matrix festlegen, real mit frischem npm ci, hubctl, Hub und PWA-Build prüfen; engines, Wizard und Doku angleichen. Bis dahin Node 26 wie CI verwenden. P53 AC-2/3; keine erfundene Abnahme älterer Runtimes.

## Repro und Umgebung

Statischer Nachweis 11.11.2026: `node_modules/eslint/package.json` engines = ^20.19.0 || ^22.13.0 || >=24; `setup.sh` akzeptiert 22.5. CI verwendet node:26, lokaler Test v26.7.0. Frischinstallation unter Node 22.5 nicht bestätigt; keine passende Runtime vorhanden.

Umgebung: isolierter Linux-Worktree, Node v26.7.0, keine produktiven Dienste geändert.
Häufigkeit: deterministisch im genannten Repro; reine Codebefunde sind ausdrücklich markiert.

## Logs

Ergebnis des Repros vom 11.11.2026 siehe oben; keine Tokens oder Schlüssel aufgezeichnet.

## Eingrenzung und Abgleich

`setup.sh` Voraussetzungen, `package.json` engines und Setup-Dokumentation. Widerspruch zum tatsächlich installierten Toolchain-Vertrag; Mindestversion nicht anhand von node:sqlite allein bestimmen.

## Fix

Unterstützte Matrix: **Node 22.18+, 24 oder 26+** — in `package.json`/`package-lock.json` (engines), `setup.sh`, README, AGENTS.md, Runbook, Fleet- und Onboarding-Doku gleich formuliert.

Abnahme am 12.11.2026, je frischer Klon (`git clone`, Stand `b213a55`), Node per mise:

| Node | npm ci | setup.sh --yes | hubctl | Hub /api/ready | PWA-Build | eslint | vitest |
|---|---|---|---|---|---|---|---|
| 22.18.0 | ok | ok | ok | ok | ok | ok | ok |
| 24.22.3 | ok | ok | ok | ok | ok | ok | ok |
| 26.7.0 | ok | ok | ok | ok | ok | ok | ok |

Gegenprobe 22.17.0: `node apps/hubctl/src/cli.ts` scheitert mit `ERR_UNKNOWN_FILE_EXTENSION` (.ts erst ab 22.18 ohne Flag) — daher die Untergrenze. 23 und 25 sind ausgeschlossen, weil vitest (`^22.12 || ^24 || >=26`) und dependency-cruiser sie nicht abdecken; nicht live geprüft. Node 20 scheitert schon an eslint (`^20.19 || ^22.13 || >=24`) und strip-types.

Test (`scripts/setup.test.mjs`): Node-Stand-in — 22.17, 23, 25, 20 → Exit 2; 22.18, 24, 26 → Exit 0; engines-Wert festgenagelt. Ohne Fix 5 rot.

## Tests / Handoff

AC: unterstützte Runtime-Matrix festlegen, real mit frischem npm ci, hubctl, Hub und PWA-Build prüfen; engines, Wizard und Doku angleichen. Bis dahin Node 26 wie CI verwenden. P53 AC-2/3; keine erfundene Abnahme älterer Runtimes.

- [x] Im Bug-Index erfasst.
- [x] GitLab-Tracker verlinkt.
- [x] Fix und Verifikation (Status oben; Gate-Beleg im [Audit](../docs/2026-11-11-setup-modelle-audit.md)).
