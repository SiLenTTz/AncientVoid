---
name: ponytail-review
description: Diff-Level-Advisory für Komplexitäts-Reduktion mit Tags delete/stdlib/native/yagni/shrink plus architecture-guard für AncientVoid-Invariants. Aktiv bei Diff vereinfachen, YAGNI, Over-Engineering. Read-only, keine Edits.
---

# Skill: ponytail-review

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md) (Regel 5, "Kein
Scope-Creep"). Invariants:
[`.claude/skills/_shared/ancientvoid-protected-invariants.md`](../_shared/ancientvoid-protected-invariants.md).

## Zweck

Ein Diff wird auf unnötige Komplexität gelesen. Ausgabe ist eine Liste von
Tags mit Ersatz. Nichts wird geschrieben.

## Wann benutzen (Trigger)

- Diff vereinfachen, YAGNI, Over-Engineering, „kann das weg?", Komplexität.

**Nicht:** selbst editieren; Gate-Review (`pr-review`).

## Hard Rules

- ✅ Advisory und **read-only** — keine Edits, keine Commits.
- ✅ Tags genau: `delete` / `stdlib` / `native` / `yagni` / `shrink` /
  `architecture-guard`.
- ✅ Invariants nie als `delete`/`yagni`.
- ❌ Keine Stil-Nörgelei (das messen Gates).

## Phasen/Prozess

1. Diff lesen (`git diff`, `git diff origin/main...HEAD`).
2. Pro Fund: Tag, was weg kann, was stattdessen.
3. Invariant-Treffer → `architecture-guard:` plus Begründung, nicht löschen.

### Tag-Sprache

| Tag | Bedeutung | AncientVoid-Beispiel |
|---|---|---|
| `delete` | tot, unbenutzt | ein zweiter, ungenutzter EventStore-Kappungs-Pfad |
| `stdlib` | Handarbeit, die die Plattform kann | eigener Retry-Loop statt `AbortSignal` |
| `native` | Eigenbau statt Plattform | eigener Healthcheck statt `status()`-Contract |
| `yagni` | spekulativ, kein zweiter Aufrufer | Adapter-Config-Option ohne zweiten Nutzer |
| `shrink` | zu breit, enger reicht | ein Adapter, der Hub-Internas re-implementiert statt `AdapterContext` zu nutzen |
| `architecture-guard` | Invariant, **behalten** | `AdapterContext`-Grenze, K5-Kappung |

## Output-Format

```text
L<line>: <tag> <what>. <replacement>.
```

Eine Zeile pro Fund. Keine Prosa-Einleitung. Am Ende eine Zeile
`net: ~-<N> lines possible` falls abschätzbar.

## Protected Invariants (AncientVoid)

Siehe [`_shared/ancientvoid-protected-invariants.md`](../_shared/ancientvoid-protected-invariants.md):
`AdapterContext`-Grenze, K5-Kappung, K7-Recovery-Pfad, `NormalizedEvent`-Schema,
kein direktes `child_process.spawn` in Adaptern — werden nicht wegoptimiert.

## Determinismus-Checkliste

- [ ] Nur der Diff, nicht das ganze Repo.
- [ ] Jede Zeile hat Tag + Ersatz.
- [ ] Keine Invariant als `delete`/`yagni`.
- [ ] Keine Datei geändert.

## Verweise

- [`architecture-best-practices`](../architecture-best-practices/SKILL.md)
- [`pr-review`](../pr-review/SKILL.md)
