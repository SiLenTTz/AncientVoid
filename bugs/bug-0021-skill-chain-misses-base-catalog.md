---
id: BUG-0021
slug: skill-chain-misses-base-catalog
status: fixed
severity: S2
area: server
instance: dev
commit: ""
forge: ""
epic: "EPIC-P5 T5.7/T5.10"
created: 2026-09-23
reporter: "Claude Opus 5.5 (E2E-Gate, workspace.spec.ts)"
---

# BUG-0021 — Skill-Kette ist kürzer, wenn vorher niemand die Skill-Liste geöffnet hat

## Gesehen

Eine Session startet mit `args.skill = "neon"` (`extends: task`). Das
Event `session.skill_chain` sagt `Skills neon`. Ruft man vorher einmal
`/api/skills` auf, sagt dieselbe Anfrage `Skills task → neon`.

## Erwartet

Die Kette hängt nur von den Skill-Dateien ab, nicht davon, welche Seite
vorher offen war: immer `task → neon`.

## Repro

1. Frischer Hub, `projectRoots` ohne `.claude/skills/`.
2. `POST /api/sessions` mit `args: { skill: "neon" }` für ein Projekt, dessen
   `neon` `extends: task` nennt.

**Ergebnis:** `Skills neon`. `task` fehlt im Prompt.

**Häufigkeit:** immer beim ersten Start vor jeder Skill-Anzeige.

## Eingrenzung

`packages/server/src/routes.ts`: `ensureBaseSkills()` lief nur in
`skillsFor()` (Skill-Liste, Empfehlung). `resolveSkillChain()` in core fand
dann keinen Katalog und lief mit `findSkillCatalogRoot()` ohne Grenze nach
oben, auf einem echten Rechner bis `~/.claude/skills`.

## Fix

`catalogRootFor()` legt den Basis-Katalog der zuständigen Projektwurzel an
und wird auch vor `POST /api/sessions` aufgerufen. Damit findet
`findSkillCatalogRoot()` immer zuerst den Katalog der Projektwurzel.

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| Integration | `packages/server/test/skill-chain-route.test.ts` | rot (`Skills neon`) | grün |
| E2E | `e2e/specs/workspace.spec.ts` „extends-Kette“ | rot | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
