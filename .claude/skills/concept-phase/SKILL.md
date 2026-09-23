---
name: concept-phase
description: Feinscoping einer einzelnen Aufgabe (T<n>.<m>) in vertikale Test-Slices (6 Dimensionen, evidence-over-assumption, Future-Fragility Pflicht). Aktiv bei Aufgabe slicen, Scoping, Edges, Subtasks. epic-creation bleibt die Phasen-Ebene; dieser Skill ergänzt sie, ersetzt sie nicht.
---

# Skill: concept-phase

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md). Übergeordnet:
[`epic-creation`](../epic-creation/SKILL.md) (Phasen-Ebene). Git:
[`git-workflow`](../git-workflow/SKILL.md).

## Zweck

Eine rohe Aufgaben-Idee (eine `T<n>.<m>`-Zeile aus einem `EPIC-Pn`) wird in
vertikale Slices zerlegt, die jeweils testbar sind. Evidence vor Annahme.
Future-Fragility und Edges sind Pflicht, nicht Kür.

**Abgrenzung:** `epic-creation` = die Phase (`EPIC-Pn`, 7 Abschnitte, DoD,
Premortem). `concept-phase` = Fein-Scoping **einer Aufgabe** innerhalb einer
Phase.

## Wann benutzen (Trigger)

- Aufgabe slicen, Scoping, „wie schneiden wir das?", Fragility, Edges, Subtasks.

**Nicht:** neue Phase aufsetzen (`epic-creation`); Bugfix-Playbook (`bugfix`).

## Hard Rules

- ✅ Evidence over assumption — Code/Contract/Epic-Text zitieren, nicht raten.
- ✅ Jeder Slice ist vertikal (Adapter↔EventStore↔Server↔PWA, nicht „erst der
  ganze Adapter, dann die UI").
- ✅ Future-Fragility und Edges stehen in der Ausgabe.
- ❌ Kein Slice ohne Testanker.

## Phasen/Prozess

1. **Read** — die Aufgaben-Zeile im `EPIC-Pn` wörtlich, plus AC, die dazu gehören.
2. **Map Code** — bestehende Pfade: `packages/contracts` → `packages/core`
   → `apps/hub` → `apps/pwa` (nicht raten, lesen).
3. **Research** — verwandte ADRs, `docs/adapters.md`, Invarianten.
4. **Ask** — nur was nach 1–3 wirklich offen ist, aber vollständig und vor
   dem ersten Slice. Wer ohne Antwort weitermacht, schreibt die gewählte
   Lesart als **Annahme** in die Ausgabe.
5. **Fragility** — was zerbricht bei Contract-Änderung, K5/K7-Verletzung,
   Adapter-Isolation?
6. **Edges** — Adapter-Crash, leere Session, Blob-Grenzen, WS-Verbindungsabbruch.
7. **Subtasks** — vertikale Slices, je 1–4 h, testbar.
8. **Tests** — vitest; Contract-Suite (`@uacc/adapter-testkit`) wenn ein
   Adapter betroffen ist.

### Sechs Scoping-Dimensionen

| Dimension | Frage | UACC-Beispiel |
|---|---|---|
| Fidelity | Wie echt muss der Slice sein? | Dummy-Adapter-Fixture vs. echter Claude-CLI-Stream |
| Scope | Was ist drin / bewusst draußen? | Steer ohne Approval-Queue (kommt erst P2) |
| Reuse vs Replace | Was bleibt, was weicht? | bestehender `WorkerRunner` (tmux) wiederverwenden |
| Edges | Was darf nicht still scheitern? | Adapter-Crash mitten in Session, WS-Verbindungsabbruch |
| Dependencies | Was blockiert den Slice? | `@uacc/contracts`-Version, P2-Approval-Queue |
| Non-functional | Latenz, Ressourcen | K5/K7/K8-Messlatten, Tailscale-Latenz |

## Output-Format

```text
Aufgabe: <T<n>.<m> / Titel>
Evidence: <Pfade, Epic-Zeilen>
Slices:
  - S1 <name> — vertikal: <stufen> — test: <vitest-Datei>
  - S2 …
Edges: …
Fragility: …
Out of scope: …
Open questions: …
```

## Determinismus-Checkliste

- [ ] Abgrenzung zu `epic-creation` nicht verwischt.
- [ ] Jeder Slice hat einen Testanker.
- [ ] Fragility und Edges stehen explizit.
- [ ] Sechs Dimensionen adressiert (kurz erlaubt).

## Verweise

- [`epic-creation`](../epic-creation/SKILL.md)
- [`architecture-best-practices`](../architecture-best-practices/SKILL.md)
