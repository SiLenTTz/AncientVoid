---
id: BUG-0206
slug: terminal-css-bricht-token-ratchet
status: done
severity: S3
area: pwa
instance: dev
commit: "b92ce253"
forge: "https://github.com/securesight-ai/AncientVoid/issues/126"
epic: "P63-Ratchet (Folge), ADR-0087 (betroffene Seite)"
created: 2026-11-17
reporter: Agent (EPIC-P56, beim main-Einmischen)
---

# BUG-0206 — Terminal-CSS aus PR #125 bricht den css-tokens-Ratchet: main ist rot

## Gesehen

`apps/pwa/test/css-tokens.test.ts` ist mit Stand `origin/main` (`b92ce253`,
Merge PR #125) rot: `colorLiteralsOutsideTokens: 3 > 0`, `varFallbacks: 2 >
0`, `unknownVarTokens: 1 > 0`. Die Quellen stehen alle in
`apps/pwa/src/app/styles/52-terminal.css`.

## Erwartet

Der css-tokens-Ratchet (AC-P63-1/3) bleibt bei jedem Merge grün — Farben
nur über Tokens, keine `var(--x, #literal)`-Fallbacks, keine unbekannten
Token-Namen.

## Repro

1. `npx vitest run apps/pwa/test/css-tokens.test.ts` auf einem Stand, der
   `origin/main` enthält (hier: main-Einmischen in den P56-Branch).

**Ergebnis:** 3 fehlerhafte Ratchet-Zähler; `grep` in `52-terminal.css`:
`var(--border, #30363d)`, `background: #0d1117`, `var(--danger, #f85149)`;
`--danger` ist in `00-tokens.css` nie definiert (der Button-Baustein nutzt
`--err`).

**Häufigkeit:** immer (jeder test:fast-Lauf gegen main — auch die CI).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (Unit-Tests, kein Hub nötig) |
| Commit | `b92ce253` (origin/main, Merge PR #125) |
| Node-Version | 26 |
| Adapter | — |
| Repro-Weg | Unit-Test (css-tokens-Ratchet) |

## Logs

```text
FAIL  apps/pwa/test/css-tokens.test.ts > EPIC-P63 css-tokens-Ratchet (AC-P63-1)
AssertionError: colorLiteralsOutsideTokens: 3 > Ratchet 0
AssertionError: varFallbacks: 2 > Ratchet 0
AssertionError: unknownVarTokens: 1 > Ratchet 0
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/css-tokens.test.ts` | rot (dieser Bug) |

Der Ratchet fängt den Defekt ein; PR #125 ist vermutlich im
CI-Überlappungsfenster gemerged (verify lief noch/gegen älteren Stand). Der
Fix braucht keine neue Testdatei.

## Eingrenzung

`apps/pwa/src/app/styles/52-terminal.css`: drei Farbliterale/Fallbacks und
der nie definierte Token `--danger`. Zudem nutzt
`apps/pwa/src/features/terminal/TerminalPage.tsx` die rohen Klassen
`btn`/`btn primary` statt des Button-Bausteins (ui-primitives-Ratchet,
AC-P63-4, ebenfalls 2 > 0). Gefixt im P56-Branch (PR #123), weil
dessen verify sonst am rot-gewordenen main hängt: `var(--border)` ohne
Fallback, `background: var(--gray-950)` statt `#0d1117`, `color: var(--err)`
statt des Phantom-Tokens; Buttons auf den `Button`-Baustein (subtle/primary).
Visuell gleichwertig (gleiche dunkle Fläche, Fehlerrot bleibt rot — `--err`
bzw. dunkle Theme-Variante).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt ([#126](https://github.com/securesight-ai/AncientVoid/issues/126))
- [x] `bugfix` erledigt (Fix im PR #123)
