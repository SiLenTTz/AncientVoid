---
name: head-n
description: Zeilenanfang einer Datei deterministisch ausgeben (Standard 10) ohne Pipe-Ketten. Pilot der Skill-Kur (EPIC-P72). Aktiv, wenn nur die ersten Zeilen einer Datei gebraucht werden.
---

# Skill: head-n

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md). Dieser Skill dupliziert
sie nicht.

## Zweck

Ersetzt die wiederkehrende `head -N`-Idiom-Kette durch einen deterministischen
Aufruf (Pilot 1 nach `docs/skill-curation.md`).

## Wann benutzen (Trigger)

- Nur die ersten Zeilen einer Datei werden gebraucht.

**Nicht benutzen, wenn:** Verarbeitungslogik folgt — dann reguläres Shell.

## Phasen/Prozess

1. `node scripts/head-n.mjs <datei> [-n N] [--json]`
2. Exit 0 = ok; Exit 2 = Skriptfehler; `--json` für maschinenlesbare Ausgabe.

## Output-Format

Zeile für Zeile, maximal `n`; Rest-Zeilenzahl auf stderr.
