---
name: epic-creation
description: Scaffoldet neue EPIC-Pn-Dateien nach dem bestehenden Muster (Ziel/Scope/Design-Details/Aufgaben/AC/Premortem/DoD). Aktiv bei „neues Epic", „P5 planen", „Feature planen". Kein epic.yaml, kein PM-Board — Git/Markdown ist SSOT.
---

# Skill: epic-creation

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md) ("Epic-Gating: P(n)
startet erst, wenn die Exit-Kriterien von P(n-1) grün sind"). Feinscoping
einer einzelnen Aufgabe innerhalb eines Epics: [`concept-phase`](../concept-phase/SKILL.md).

## Zweck

Eine neue Phase (`EPIC-Pn`) wird nach dem in diesem Repo bereits etablierten,
schlanken Schema angelegt — kein 8-Schritt-Apparat, kein separates Manifest.
Vorbild: [`epics/EPIC-P3-adapter-flotte-sprachsuche.md`](../../../epics/EPIC-P3-adapter-flotte-sprachsuche.md)
(reichste Struktur bisher).

## Wann benutzen (Trigger)

- „neues Epic", „P5 planen", „Feature-Phase aufsetzen".

**Nicht:** Story-/Task-Feinscoping innerhalb einer bestehenden Phase
(`concept-phase`); Bugfix (`bugfix`).

## Hard Rules

- ✅ Premortem **nie überspringen** — auch bei „kleinen" Phasen.
- ✅ Epic-Gating: neue Phase referenziert die Exit-Kriterien der vorigen.
- ✅ Jede Aufgabe hat eine Messlatten-Referenz, wo eine existiert (K1–K10, PRD §9).
- ❌ Kein `epic.yaml`, kein PM-Board-Manifest, keine G1–G9-Liefergarantien —
  das ist Prozess-Overhead für dieses Repo, nicht die bestehende Praxis.
- ❌ Keine leere Phasen-Datei als Platzhalter.

## Das 7-Abschnitt-Schema

```markdown
# EPIC-Pn — <Titel>

**Status:** offen · **Phase:** Pn · **Dauer:** <Schätzung> · **Abhängigkeit:** P(n-1) grün

## 1. Ziel
## 2. Scope (In / Out)
## 3. Design-Details
## 4. Aufgaben (Checkliste T<n>.<m>)
## 5. Acceptance Criteria (AC-Pn-k)
## 6. Premortem (Failure-Modi + Mitigation)
## 7. Definition of Done
```

## Phasen/Prozess

1. **Vorherige Phase prüfen** — Exit-Kriterien/DoD von `EPIC-P(n-1)-*.md`
   tatsächlich grün? Sonst: Epic-Gating verletzt, nicht anlegen.
2. **Datei anlegen** unter `epics/EPIC-Pn-<kebab-titel>.md`, Schema oben
   ausfüllen. `epics/EPIC-P3-adapter-flotte-sprachsuche.md` als Formatvorbild
   nehmen (Design-Details-Unterabschnitte, nummerierte AC, 4-Punkt-Premortem).
3. **Premortem**: mindestens 3–4 realistische Failure-Modi mit Mitigation —
   nicht generisch, sondern spezifisch für diese Phase.
4. **`epics/README.md`** aktualisieren (neue Phase verlinken, Status).
5. **E2E-Gate in die DoD**: jede DoD nennt „`npm run gate` lokal grün;
   GitHub-Actions-Lauf (`verify`, `k8`, `e2e`) auf dem Abschluss-PR grün;
   jede neue UI-Funktion/jeder Ablauf mit Spec in `e2e/specs/`“. Rote CI
   allein wegen der Umgebung wird benannt, nie als Pass gezählt.
   Geltung: [`docs/testing-e2e.md`](../../../docs/testing-e2e.md).
6. **Erreichbarkeit als Teil der DoD**: ein Feature, das technisch fertig,
   aber nirgends registriert/erreichbar ist (z. B. ein Adapter, der nicht in
   `hub.config.json`/der README-Status-Matrix auftaucht), zählt nicht als
   done.

## Output-Format

```text
Epic: EPIC-Pn <titel>
Datei: epics/EPIC-Pn-<slug>.md
Abhängigkeit: EPIC-P(n-1) — <grün|offen>
Aufgaben: <n>
Premortem: <n> Failure-Modi
Index aktualisiert: epics/README.md <ja|nein>
```

## Determinismus-Checkliste

- [ ] Alle 7 Abschnitte vorhanden.
- [ ] Premortem nicht übersprungen.
- [ ] Abhängigkeit zur Vorphase explizit genannt.
- [ ] Kein `epic.yaml`, kein PM-Board-Bezug.

## Verweise

- [`concept-phase`](../concept-phase/SKILL.md)
- [`retro`](../retro/SKILL.md)
- Agent: [`.claude/agents/epic-planner.md`](../../agents/epic-planner.md)
