---
name: skill-name
description: Ein Satz Zweck plus Trigger-Keywords. Maximal 1024 Zeichen. Aktiv, wenn … (konkrete Nutzersignale).
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

## Protected Invariants (UACC)

Nur Advisory-Skills. Verweis, keine Duplikation:

[`.claude/skills/_shared/uacc-protected-invariants.md`](../../../.claude/skills/_shared/uacc-protected-invariants.md)

## Determinismus-Checkliste

- [ ] Jeder Claim ist durch ein Kommando oder eine Datei belegbar.
- [ ] Keine RAG/Python/React-Bezüge (mobile-hub ist ein TS-Monorepo).
- [ ] `AGENTS.md` referenziert, nicht kopiert.

## Verweise

- [`AGENTS.md`](../../../AGENTS.md)
- [Skill-Index](README.md)
