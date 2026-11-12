---
id: BUG-0135
slug: setup-voidwarden-zweittokens
status: open
severity: S3
area: ops
instance: dev
commit: "9d97e19"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/56"
epic: "EPIC-P53 / VoidWarden P14"
created: 2026-11-11
reporter: "Codex — Setup-/Modellanbindungs-Audit"
---

# BUG-0135 — Wiederholtes VoidWarden-Setup stellt zusätzliche Tokens aus

## Gesehen

`--voidwarden` stellt bei jeder Wiederholung neue agent:voidwarden- und display:web-1-Tokens aus; der behauptete idempotente Setup-Vertrag gilt nur für das Device-Token.

## Erwartet

AC: Wiederholung stellt keine weiteren Tokens aus; verlorene Tokens bewusst separat neu ausstellen, nie Klartext persistieren; Rechte und optionale Optionsfragen nach ADR-0066 explizit dokumentieren. PRD §8, P53 AC-3; VoidWarden bleibt separat.

## Repro und Umgebung

Temporärer Checkout, echter hubctl/SQLite, npm-Stand-in: zweimal `bash setup.sh --yes --adapter=dummy --voidwarden --no-start --no-pwa`. SELECT label,count(*) FROM device_tokens GROUP BY label liefert agent:voidwarden=2, display:web-1=2, Device=1; beide Läufe Exit 0. CLI-Repro bestätigt; keine Tokenwerte im Protokoll.

Umgebung: isolierter Linux-Worktree, Node v26.7.0, keine produktiven Dienste geändert.
Häufigkeit: deterministisch im genannten Repro; reine Codebefunde sind ausdrücklich markiert.

## Logs

Ergebnis des Repros vom 11.11.2026 siehe oben; keine Tokens oder Schlüssel aufgezeichnet.

## Eingrenzung und Abgleich

`setup.sh` Schritt 4c hat keinen Wiederholungscheck. Unabhängig von BUG-0130: auch bei Default-dataDir reproduzierbar.

## Tests / Handoff

AC: Wiederholung stellt keine weiteren Tokens aus; verlorene Tokens bewusst separat neu ausstellen, nie Klartext persistieren; Rechte und optionale Optionsfragen nach ADR-0066 explizit dokumentieren. PRD §8, P53 AC-3; VoidWarden bleibt separat.

- [x] Im Bug-Index erfasst.
- [x] GitLab-Tracker verlinkt.
- [ ] Fix und Verifikation (Status oben; Gate-Beleg im [Audit](../docs/2026-11-11-setup-modelle-audit.md)).
