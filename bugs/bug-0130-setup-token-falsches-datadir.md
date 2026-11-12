---
id: BUG-0130
slug: setup-token-falsches-datadir
status: done
severity: S2
area: ops
instance: dev
commit: "9d97e19"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/51"
epic: "EPIC-P53"
created: 2026-11-11
reporter: "Codex — Setup-/Modellanbindungs-Audit"
---

# BUG-0130 — Setup stellt Tokens in der falschen Datenbank aus

## Gesehen

Bei konfiguriertem `dataDir` schreibt der Wizard weiterhin nach `data/hub.db`; ein Marker der Default-DB verhindert sogar die Ausstellung für die neue DB.

## Erwartet

Default, relativer Pfad mit Leerzeichen, absoluter Pfad, fremder alter Marker, Wiederholung und unveränderte Config sind in `scripts/setup.test.mjs` abgedeckt. PRD §8, K7; P53 AC-2/3.

## Repro und Umgebung

`npm test -- scripts/setup.test.mjs`: vor Fix 2 rot / 1 grün; nach Fix 3 grün. Echter Wizard, kopierte hubctl-CLI und SQLite in temporären Verzeichnissen; nur npm-Installation ersetzt, kein Hub gestartet. Kein PWA-Repro; CLI-Repro bestätigt.

Umgebung: isolierter Linux-Worktree, Node v26.7.0, keine produktiven Dienste geändert.
Häufigkeit: deterministisch im genannten Repro; reine Codebefunde sind ausdrücklich markiert.

## Logs

Ergebnis des Repros vom 11.11.2026 siehe oben; keine Tokens oder Schlüssel aufgezeichnet.

## Eingrenzung und Abgleich

`setup.sh`, Schritt 4b/4c: hart codierte DB und Marker. Fix löst `dataDir` wie der Hub relativ zum Checkout auf; Default bleibt `./data`. Device-, Agent- und Display-Token sowie Marker verwenden denselben Pfad. Kein bestehendes Token wird verschoben oder widerrufen.

## Tests / Handoff

Default, relativer Pfad mit Leerzeichen, absoluter Pfad, fremder alter Marker, Wiederholung und unveränderte Config sind in `scripts/setup.test.mjs` abgedeckt. PRD §8, K7; P53 AC-2/3.

- [x] Im Bug-Index erfasst.
- [x] GitLab-Tracker verlinkt.
- [x] Fix und Verifikation (Status oben; Gate-Beleg im [Audit](../docs/2026-11-11-setup-modelle-audit.md)).
