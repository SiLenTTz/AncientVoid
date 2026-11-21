---
name: skill-name
description: Ein Satz Zweck plus Trigger-Keywords. Maximal 300 Zeichen (check:skills). Aktiv, wenn … (konkrete Nutzersignale).
---

# Skill: skill-name

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md). Dieser Skill dupliziert
sie nicht.

## Zweck

Was die Fähigkeit leistet, in zwei bis drei Sätzen. Progressive Disclosure:
dieser Einstieg bleibt knapp; Tiefe steht in den Phasen.

## Wann benutzen (Trigger)

- Keyword / Nutzersignal 1
- Keyword / Nutzersignal 2

**Nicht benutzen, wenn:** Abgrenzung zu anderen Skills.

## Hard Rules

- ✅ Pflichtverhalten.
- ❌ Verbotenes Verhalten.

## Phasen/Prozess

### 1. …

Konkrete Schritte, Kommandos, Artefakte.

### 2. …

## Output-Format

Deterministische Form, die ein Mensch oder ein nachfolgender Skill lesen kann.

## Skript-Skill-Muster (wenn Logik wiederholbar ist)

Wenn der Skill bei jedem Lauf dieselben Schritte durchführt, ist der Skill eine
kurze Markdown-Hülse und die Logik steckt in `scripts/<skill>.mjs` — die LLM
ruft das Skript auf und interpretiert nur das Ergebnis.

- **Aufrufbar, `--json`, Exit-Code-konform:** Exit 0 = ok, 1 = Befund/Fehlerfall,
  2 = Skriptfehler. `--json` liefert die Befunde als Maschinebnbares Array
  (für künftige CI-Nutzung); ohne Flag Menschenformat, eine Zeile je Befund.
- **Ausgabe ≤ 40 Zeilen** (oder `--json`) — der Skill-Raum soll nicht mit
  Log zugetextet werden (`docs/skill-curation.md`).
- Die Markdown-Hülse beschreibt nur: wann aufrufen, was die Exit-Codes
  bedeuten, was bei Befunden zu tun ist. Sie verlinkt das Skript (Pfad muss
  existieren — `check:skills`).
- Das Skript hat einen Test unter `scripts/<skill>.test.mjs` (vitest) mit
  gepflanztem Fixture; ein Check ohne negativen Fall gilt nicht als geprüft.
- `scripts/` bleibt der einzige Ort für Skill-Skripte; der Name ist zugleich
  die Regelquelle — nach `git mv` muss der Skill-Text nachgezogen werden
  (`check:skills` meldet sonst die Lücke).

## Protected Invariants (AncientVoid)

Nur Advisory-Skills. Verweis, keine Duplikation:

[`.claude/skills/_shared/ancientvoid-protected-invariants.md`](../../../.claude/skills/_shared/ancientvoid-protected-invariants.md)

## Determinismus-Checkliste

- [ ] Jeder Claim ist durch ein Kommando oder eine Datei belegbar.
- [ ] Keine RAG/Python/React-Bezüge (AncientVoid ist ein TS-Monorepo).
- [ ] `AGENTS.md` referenziert, nicht kopiert.

## Verweise

- [`AGENTS.md`](../../../AGENTS.md)
- [Skill-Index](../README.md)
