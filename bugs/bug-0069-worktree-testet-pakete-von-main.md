---
id: BUG-0069
slug: worktree-testet-pakete-von-main
status: done
severity: S2
area: core, e2e
instance: dev
commit: "ff97c65"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/24"
epic: "P14"
created: 2026-10-27
reporter: claude
---

# BUG-0069 — Gates in einem Session-Worktree testen die `@ancientvoid/*`-Pakete des Haupt-Checkouts

## Gesehen

In einem Session-Worktree des AncientVoid-Repos (`data/worktrees/<id>/`) zeigen
alle `@ancientvoid/*`-Paket-Importe auf den Haupt-Checkout, nicht auf den Worktree.
Der E2E-Hub, den `npm run test:e2e` startet, lief deshalb mit dem
`adapter-pi`-Code von `main`. Die Änderung im Worktree war gar nicht geladen,
und der Test schlug mit dem alten Verhalten fehl. Umgekehrt ist ein grünes
E2E-Gate im Worktree kein Beleg für Änderungen an `packages/*`.

## Erwartet

Gates im Worktree prüfen den Code des Worktrees. Kann das Setup das nicht
sicherstellen, bricht das Gate laut ab, statt grün gegen fremden Code zu
laufen.

## Repro

Voraussetzung: Hub-Session auf dem AncientVoid-Repo mit Worktree-Isolation
(diese Session, `587a143d-…`), Worktree ohne eigenes `npm install`.

1. Im Worktree: `ls node_modules/@ancientvoid` → existiert nicht (nur `.vite`).
2. `readlink -f /mnt/…/AncientVoid/node_modules/@ancientvoid/adapter-pi` →
   `/mnt/…/AncientVoid/packages/adapters/pi` (Haupt-Checkout).
3. Im Worktree `packages/adapters/pi/src/index.ts` ändern (BUG-0066: kein
   `exec` mehr), dann den E2E-Spec mit pi-Stand-in laufen lassen.

**Ergebnis nach Schritt 3:** Das Stand-in bekommt weiter das alte argv
`["exec","\"Wie viele Zeilen hat notiz.txt?\""]`, also den Code von `main`.

**Häufigkeit:** immer, für jeden Worktree unter `data/worktrees/`, der im
Repo-Verzeichnis liegt (Node sucht `node_modules` aufwärts).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal, Session-Worktree |
| Commit | `ff97c65` (fix/pi-json-stream) |
| Node-Version | v26.7.0 |
| Adapter | alle (`@ancientvoid/*`, auch `@ancientvoid/core`, `@ancientvoid/hub`) |
| Repro-Weg | E2E-Lauf + Modulauflösung, 2026-10-27 00:05 |

## Logs

```text
2026-10-27T00:05 stand-in argv: ["exec","\"Wie viele Zeilen hat notiz.txt?\""]
  (Worktree-Code baut zu diesem Zeitpunkt bereits ["-p","--mode","json","--",…])
node_modules/@ancientvoid im Worktree: fehlt
```

Workaround in dieser Session: Symlinks `node_modules/@ancientvoid/<name>` →
`../../packages/…` im Worktree anlegen (gitignored). Danach löst
`import.meta.resolve('@ancientvoid/adapter-pi')` auf den Worktree auf, und derselbe
Spec ist mit Fix grün und ohne Fix rot.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Gate | `npm run gate` | grün, prüft aber nicht, woher `@ancientvoid/*` geladen wird |
| Unit | `packages/*/test` | nicht betroffen, soweit relativ importiert (`../src/…`) |

Vorschlag: ein Vorab-Check im Gate (`scripts/check-workspace-links.mjs`), der
für jedes Workspace-Paket prüft, dass `import.meta.resolve('@ancientvoid/<name>')`
unterhalb des Repo-Roots liegt, in dem das Gate läuft. Sonst bricht er mit
Hinweis ab. Ohne Fix wäre er im Worktree rot.

## Eingrenzung

- `packages/core/src/modules/workspace/worktree.ts:145`: `git worktree add`
  legt kein `node_modules` an. Das ist für Fremdprojekte richtig.
- Die Worktrees liegen unter `<repo>/data/worktrees/`, also unterhalb des
  Haupt-Checkouts. Die Node-Auflösung findet dessen `node_modules/@ancientvoid/*`
  (Workspace-Symlinks auf die Pakete des Haupt-Checkouts).
- Für den Fix gibt es zwei Optionen: (a) der Gate-Check oben (fail loud), (b)
  die Session-Einrichtung verlinkt Workspace-Pakete, wenn das Projekt npm
  workspaces nutzt. (a) ist der kleinste korrekte Schritt.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen
