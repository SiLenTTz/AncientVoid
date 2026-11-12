---
name: context-audit
description: Monatlicher Kontext-Audit — findet veraltete/widersprüchliche Kontextdateien und lebende Dokumente, schlägt Diff-Vorschläge vor. Aktiv bei „Kontext-Audit", „docs aufräumen", „AGENTS.md prüfen". Niemals auto-mergen.
---

# Skill: context-audit

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md). Dieser Skill dupliziert
nichts aus [`docs/check-context.md`](../../../docs/check-context.md) — dort
leben Regeln und Begründung. Ein Skill-Index steht in
[README.md](../README.md).

## Zweck

Das deterministische Gate `npm run check:context` (Budgets, Links, Referenzen,
Script-Inventar, Frischhalte-Map) hält Struktur-Fäulnis fern. Was es nicht
kann: **inhaltliche** Veraltung und Widersprüche erkennen. Dieser Skill ist
der monatliche (oder auf Wunsch) semantische Doppel-Check — als
Vorschlags-Layer, nie als Selbstbedienung.

## Ablauf

1. **Basis messen:** `npm run check:context` und `npm run check:knip`
   (report-only). Jeder Befund wird benannt, nicht wegkonfiguriert.
2. **Kern-Kontextdateien lesen:** `AGENTS.md`, `CONTRIBUTING.md`,
   `.claude/skills/README.md`, alle `SKILL.md` + `.claude/agents/*.md`.
   Prüfen: Widerspricht etwas dem Code/anderen Regeln? Gibt es dieselbe Regel
   mit abweichendem Wortlaut an zwei Stellen (Aufmerksamkeits-Konkurrenz)?
   Ist etwas ohne Wert für die meisten Aufgaben („Repo-Overview", ableitbare
   Listen)? Dumples Ableitbares, kürze Widersprüche auf eine Autorität +
   Verweis.
3. **Lebende Dokumente stichproben:** Die Frischhalte-Map in
   `scripts/check-context.mjs` listet sie. Für die 2–3 mit der höchsten
   Drift: Kern-Aussagen gegen den Code verifizieren (nicht neu schreiben —
   verifizieren), falsche Aussagen korrigieren, „Stand:"-Datum setzen.
4. **Nur Diff-Vorschläge:** Alle Änderungen als ausformulierte Patches/Diffs
   präsentieren (pro Datei: alt → neu + je 1 Satz Begründung). Kein Commit,
   kein Merge, kein Push ohne ausdrückliche Nutzerfreigabe — dieser Skill
   kann selbst Slop erzeugen, deshalb entscheidet der Mensch.
5. **Ergebnis protokollieren:** Ein kurzer Absatz (Datum, geprüfte Dateien,
   Befunde, Entscheidungen) als Chat-Antwort; bei größeren Ergebnissen als
   datierte Snapshot-Datei `docs/JJJJ-MM-TT_kontext-audit.md` (Konvention:
   Datum im Namen = eingefroren).

## Grenzen

- Kein Merge/Commit eigener Vorschläge (Hard Rule oben).
- Befunde des deterministischen Gates haben Vorrang: erst `check:context`
  grün, dann semantischer Audit.
- Keine Epics verändern (Regelquellen bleiben `epics/` + Retro-Pflicht).
