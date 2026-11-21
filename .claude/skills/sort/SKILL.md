---
name: sort
description: Zeilen deterministisch sortieren (Byteordnung) oder als Histogramm mit Haufungszahl ausgeben. Pilot der Skill-Kur (EPIC-P72). Aktiv, wenn Sortier-/Haeufigkeits-Idioms anstehen.
---

# Skill: sort

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md). Dieser Skill dupliziert
sie nicht.

## Zweck

Ersetzt die wiederkehrende `sort | uniq -c | sort -rn`-Idiom-Kette durch einen
deterministischen Aufruf (Pilot 2 nach `docs/skill-curation.md`).

## Wann benutzen (Trigger)

- Häufigkeitsverteilung von Zeilen (Histogramm) oder deterministische Sortierung gefragt.

**Nicht benutzen, wenn:** Locale-Sortierung explizit verlangt ist.

## Phasen/Prozess

1. `node scripts/sort.mjs [<datei>] [-c] [--json]` (ohne Datei: stdin)
2. `-c` = Histogramm (count desc, Ties in Byteordnung). Exit 0 = ok; Exit 2 = Fehler.

## Output-Format

Sortierte Zeilen bzw. `<count> <zeile>`, determinisch bytegenau.
