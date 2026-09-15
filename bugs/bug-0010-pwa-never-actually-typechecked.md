---
id: BUG-0010
slug: pwa-never-actually-typechecked
status: done
severity: S2
area: pwa
instance: dev
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/10"
epic: EPIC-P1.5
created: 2026-09-15
reporter: "Claude Sonnet 5 (Session 012Ga2NDi683xR9E63StoN7T)"
---

# BUG-0010 — `packages/pwa` was never actually type-checked (or built) in CI

## Gesehen

Beim Vorbereiten von T1.5-3 (Budget-Feld entfernen, Kontingent-Anzeige) fiel
auf: `tsconfig.json` (Repo-Root) schließt `packages/pwa` explizit aus
(`"exclude": ["packages/pwa"]`), und `.gitlab-ci.yml` führte bislang **weder**
`npm -w @uacc/pwa run typecheck` (den gab es nicht einmal als Skript) **noch**
`npm -w @uacc/pwa run build` aus — nur `npm run typecheck` (root, ohne PWA)
und `npm test`/`npm run lint`. Der `gates`-Skill selbst behauptet in seiner
eigenen Tabelle: „`packages/pwa/** → npm -w @uacc/pwa run build + npm run
typecheck`" — das war nie wahr, weil `npm run typecheck` die PWA gar nicht
erreicht.

Direkter Beleg, dass das kein theoretisches Risiko war, sondern real:

```bash
npx tsc -p packages/pwa/tsconfig.json --noEmit
```

lieferte **sieben echte Typfehler**, die seit T1.5 (Monitor-Dashboard)
unentdeckt im Code standen:

```text
packages/pwa/src/Dashboard.tsx(38,43): error TS2339: Property 'updatedAt' does not exist on type 'SessionRecord'.
packages/pwa/src/Dashboard.tsx(57,35): error TS2339: Property 'costUsd' does not exist on type 'SessionRecord'.
... (7 insgesamt, beide Felder mehrfach referenziert)
```

`packages/pwa/src/api.ts`s `SessionRecord`-Interface hatte weder `costUsd`
noch `updatedAt` noch `worktreeSha` — obwohl `Dashboard.tsx` `costUsd` und
`updatedAt` bereits seit T1.5 aktiv benutzt (Summe „Heute", Sortierung nach
„zuletzt aktiv"). Zusätzlich: die eigene `tsconfig.json` der PWA hatte
`allowImportingTsExtensions` nicht gesetzt, sodass **jeder** `.ts`/`.tsx`-Import
mit Endung (`./api.ts`, `./App.tsx`, …) einen weiteren Fehler warf — das
hätte selbst einen naiven ersten `tsc`-Lauf sofort rot gemacht, wäre er je
gelaufen.

**Nebenfund, bewusst nicht in diesem Bug behoben:** `eslint.config.mjs`s
`files`-Glob (`["**/*.ts", "scripts/**/*.mjs"]`) enthält kein `**/*.tsx` —
selbst mit `--no-ignore` matcht keine Regel gegen PWA-Dateien
(`npx eslint packages/pwa/src/Dashboard.tsx --no-ignore` läuft durch,
0 Probleme, weil keine Regel überhaupt greift, nicht weil der Code sauber
ist). Lint für die PWA ist damit weiterhin ein Leerlauf — Einrichtung
(JSX-Parser-Optionen, Preact-Regeln, plus der erste reale Lauf würde
vermutlich eine unbekannte Zahl bisher unentdeckter Fundstellen zeigen)
ist ein eigener, nicht trivialer Task und bewusst nicht Teil dieses Fixes.

## Erwartet

`packages/pwa`s TypeScript-Code wird bei jedem `npm run lint`/CI-Lauf
tatsächlich typgeprüft — ein Contract-Feld, das im Server existiert, aber
im PWA-Client-Typ fehlt, muss als Fehler auffallen, nicht erst durch
Zufall beim nächsten Feature-Task.

## Repro

```bash
git stash  # oder auf einen Commit vor diesem Fix
npx tsc -p packages/pwa/tsconfig.json --noEmit   # 7 echte Fehler
grep -n "typecheck" packages/pwa/package.json     # kein Skript vorhanden
grep -n "@uacc/pwa" .gitlab-ci.yml                 # kein Treffer
```

**Häufigkeit:** dauerhaft — kein Zufall, eine seit T0/T1 bestehende
Konfigurationslücke.

## Eingrenzung

- `tsconfig.json` (Repo-Root): `"exclude": ["packages/pwa"]` — bewusst,
  da die PWA einen eigenen Preact/DOM/Vite-`tsconfig.json` mit anderen
  `lib`/`jsx`-Einstellungen braucht, die mit dem Node-only-Root-Tsconfig
  kollidieren würden. Das ist an sich richtig — der Fehler war, dass
  niemand den PWA-eigenen `tsconfig.json` je über ein eigenes Skript
  ausgeführt hat.
- `packages/pwa/package.json`: kein `typecheck`-Skript.
- `.gitlab-ci.yml`: `verify`-Stage lief ohne jeden PWA-spezifischen Schritt.
- `packages/pwa/tsconfig.json`: `allowImportingTsExtensions` fehlte.
- `packages/pwa/src/api.ts`: `SessionRecord`-Interface war seit T1.5
  unvollständig (`costUsd`, `updatedAt`, `worktreeSha` fehlten), `AdapterInfo`
  seit T1.5-2 veraltet (kein `usage`-Feld in `capabilities`).

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| — | `npm -w @uacc/pwa run typecheck` | existierte nicht |
| — | `.gitlab-ci.yml` `verify`-Stage | keine PWA-Zeile |

## Fix

1. `packages/pwa/tsconfig.json`: `allowImportingTsExtensions: true` ergänzt.
2. `packages/pwa/src/api.ts`: `SessionRecord` um `worktreeSha`, `costUsd`,
   `updatedAt` ergänzt (jetzt deckungsgleich mit
   `packages/contracts/src/session.ts`); `AdapterInfo.capabilities` um
   `usage: boolean` ergänzt (T1.5-2).
3. `packages/pwa/package.json`: `"typecheck": "tsc -p . --noEmit"` ergänzt.
4. `.gitlab-ci.yml`: `npm -w @uacc/pwa run typecheck` **und**
   `npm -w @uacc/pwa run build` in die `verify`-Stage aufgenommen — beide
   liefen vorher überhaupt nicht in CI.

Verifiziert: `npx tsc -p packages/pwa/tsconfig.json --noEmit` läuft jetzt
sauber (Exit 0), `npm -w @uacc/pwa run build` weiterhin grün.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` — Typecheck-Teil behoben und in CI verdrahtet.
- [ ] **Bewusst offen gelassen:** PWA-Lint (`.tsx` fehlt im
      `eslint.config.mjs`-`files`-Glob, JSX-Parser-Optionen fehlen) — eigener
      Task, da der erste reale Lauf voraussichtlich eine unbekannte Zahl
      bestehender Fundstellen aufdeckt, die nicht im selben Atemzug wie diese
      Typecheck-Lücke behoben werden sollten.
