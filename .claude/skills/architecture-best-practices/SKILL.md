---
name: architecture-best-practices
description: UACC-Architektur-Referenz (Adapter.start → ctx.emit → EventStore → WS/SSE → PWA), Modultiefe-Vokabular, Testing-Standard, Bug-Fix-Test muss ohne Fix scheitern. Aktiv bei Architekturfragen, Schichten, Anti-Pattern, "wo gehört das hin?".
---

# Skill: architecture-best-practices

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md). UACC-Verträge:
[`.claude/skills/_shared/uacc-protected-invariants.md`](../_shared/uacc-protected-invariants.md).
Advisory dazu: [`ponytail-review`](../ponytail-review/SKILL.md).

## Zweck

Nachschlagen, wie dieser Stack gebaut sein soll — und welche Muster schon
bezahlt sind. Kein Workflow; eine Referenz, die andere Skills anwenden.

## Wann benutzen (Trigger)

- Architektur, Schichten, Adapter-Grenzen, Anti-Pattern, „wo gehört das hin?",
  Testing-Standard.

**Nicht:** Epic planen (`epic-creation`); Diff-Advisory (`ponytail-review`).

## Hard Rules

- ✅ Contracts first: alles Geteilte liegt in `@uacc/contracts`.
- ✅ Adapter sehen nur `AdapterContext` — keine Hub-Internas.
- ✅ Bug-Fix-Test muss ohne Fix scheitern.
- ✅ EventStore-Pipeline nicht in einer Funktion mit Adapter-Logik mischen.
- ❌ Hard-coded Session-/Event-Limits außerhalb der Contracts-Konstanten
  (`MAX_EVENT_PAYLOAD_BYTES` etc.).

## Phasen/Prozess

### UACC-Pipeline

```text
Adapter.start(spec, ctx) → ctx.emit(EmittedEvent)
  → EventStore (seq/ts/sessionId zuweisen, K5 erzwingen, JSONL+Snapshot)
  → WS/SSE-Transport (packages/server)
  → PWA-Projektion (packages/pwa)
```

Jede Stufe hat einen Vertrag. Ein Adapter, der EventStore-Internas kennt,
oder ein Server-Handler, der Adapter-Details interpretiert, ist das
Anti-Pattern.

### Good Practice (mindestens)

1. Adapter kommuniziert ausschließlich über `AdapterContext`
   (`AGENTS.md` Regel 2).
2. Große Inhalte gehen via `ctx.blob()` raus, Event-Payload bleibt ein Anker
   (K5, `AGENTS.md` Regel 3).
3. Jede neue State-Quelle hat einen Recovery-Pfad (K7, `AGENTS.md` Regel 4).
4. Unbekannte Provider-Events werden als `system`-Event sichtbar gemacht,
   nie still gedroppt (`AGENTS.md` Regel 6, "Fail loud").

### Anti-Pattern (mindestens)

1. Adapter importiert `@uacc/core` oder `@uacc/server` direkt.
2. Adapter spawnt `child_process` direkt statt `ctx.spawnWorker`.
3. `capabilities()`, die mehr verspricht als der Code hält (Ehrlichkeitsklausel,
   README Adapter-Status-Matrix).
4. Contract-Änderung (`packages/contracts/src/*`) ohne ADR in `docs/adr/`.

### Modultiefe — wann eine Schicht ihren Platz verdient

Vokabular, damit Review-Befunde benennbar sind statt „fühlt sich falsch an".

| Begriff | Bedeutung |
|---|---|
| **Schnittstelle** | Alles, was ein Aufrufer wissen muss: Signatur **plus** Invarianten, Reihenfolge, Fehlerfälle, Konfiguration. Nicht nur der Typ. |
| **Tiefe** | Verhalten je Einheit gelernter Schnittstelle. **Tief** = viel Verhalten hinter wenig Schnittstelle. |
| **Naht (Seam)** | Der Ort, an dem die Schnittstelle sitzt — die Stelle, an der Verhalten austauschbar wird. |
| **Adapter** | Was an einer Naht steckt. Beschreibt die Rolle, nicht den Inhalt. |

Eine **flache** Schicht — große Schnittstelle, dünne Implementierung, die nur
durchreicht — kostet Lernaufwand und liefert nichts zurück.

**Drei Prüfungen, bevor eine Schicht entsteht:**

1. **Der Löschtest.** Denk dir das Modul weg. Verschwindet die Komplexität,
   war es ein Durchreicher. Taucht sie bei N Aufrufern wieder auf, hat es
   sich verdient.
2. **Ein Adapter ist eine hypothetische Naht, zwei sind eine echte.** Keine
   Naht einziehen, solange nichts tatsächlich über sie variiert. In diesem
   Repo hat sich das bewährt: `dummy` **und** `local-llm` hinter der
   `Adapter`-Schnittstelle sind zwei — ein einzelner „Provider-Wrapper" für
   genau einen Provider wäre einer.
3. **Die Schnittstelle ist die Testfläche.** Test und Aufrufer kreuzen
   dieselbe Naht. Wer am Test vorbei ins Innere greifen muss, hat das Modul
   falsch geschnitten — nicht den Test. `@uacc/adapter-testkit` prüft genau
   diese Naht (`AdapterContext`), nicht Adapter-Internas.

Für den Rückbau bestehender Schichten gilt derselbe Maßstab; das Werkzeug
dafür ist [`ponytail-review`](../ponytail-review/SKILL.md).

### Testing

Rezept und Dateilagen: [`write-tests`](../write-tests/SKILL.md).
- vitest (forks pool), Contract-Tests via `@uacc/adapter-testkit`.
- Neuer Bug: Test zuerst, rot ohne Fix, grün mit Fix.
- **Ein Test, der beim ersten Lauf sofort grün ist, hat nichts bewiesen.**
  Entweder prüft er die falsche Stelle, oder der Bug ist nicht reproduziert.
- Timing-abhängige Tests (z. B. Event-Zählung nach fester Wartezeit) sind ein
  bekanntes Fragilitätsmuster in diesem Repo — Wartezeit großzügig bemessen
  oder auf ein deterministisches Signal warten statt auf `setTimeout`.

## Output-Format

Bei einer Architekturfrage:

```text
Schicht: <wo es hingehört>
Vertrag: <Invariant oder „keiner">
Good: <bestehendes Muster im Repo, mit Pfad>
Avoid: <Anti-Pattern, das die Frage riskiert>
```

## Protected Invariants (UACC)

Siehe [`_shared/uacc-protected-invariants.md`](../_shared/uacc-protected-invariants.md).

## Determinismus-Checkliste

- [ ] Beispiel zeigt einen echten Pfad in `packages/`, kein erfundenes Muster.
- [ ] Mindestens ein Repo-Pfad zitiert.

## Verweise

- [`gates`](../gates/SKILL.md) · [`docs/adapters.md`](../../../docs/adapters.md)
