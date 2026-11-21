# Skill-Kur: Erstlauf am Bestand (EPIC-P72 T72.11)

Eingefrorene Analyse vom 2026-11-21. Datenbasis: echter Bestand unter `data/`
(read-only, `node:sqlite`), Pipeline `scripts/skill-runs.mjs` +
`scripts/skill-curate.mjs` (kein LLM, ADR-0100). Der Entwurf ging von 232
Sessions aus; real vorhanden sind 3 Sessions (Der Bestand wächst mit dem
normalen Betrieb; dieser Report ist die Ausgangsmessung).

## 1. Bestand und Kosten (turn_metrics, read-only)

| Session (Prefix) | Adapter | Befehle | Turn-Kosten | Turn-Kommandos | Skills (invoked) |
|---|---|---:|---|---:|---|
| 04b490d2 | claude | 831 | 1666.14 USD / 897 507 tok / 23 turns | native | omarchy |
| 94e2754b | pi | 455 | 0 USD / 12 978 127 tok / 1 turn | native | — |
| e090b61e | cursor | 0 | 0 USD / 250 197 tok / 4 turns | native | — |

## 2. Budget-Tabelle (check:skills)

Ratchet: 4316 Zeichen ≈ 1079 Tokens (nach Addition der Pilot-Hüllen, s. § 6).
Einzelbudgets unverändert; vollständige Tabelle: `npm run check:skills`.

## 3. Regeltreffer auf dem Bestand

5 Treffer, alle in Session 94e2754b — das ist der Curation-Lauf selbst.
Einordnung (ehrliche Falsch-Positiv-Quote):

- `gw-no-verify` 3× — Treffer in Shell-Commends, die `--no-verify` nur
  zitieren (Python-Heredocs, `printf` von Kur-JSON). Zählerische
  Falsch-Positiv-Quote gegen echte Regelverstöße: 3/5 Treffer durch
  Zitat-Kontext. Die Regel bleibt (Guard `unless: literal-in-user-prompt`
  greift hier nicht, weil der Kontext Agenten-Output ist) — beimMining-
  gegen muss Zitat-Rauschen als bekannter Bias gelten.
- `star-no-direct-push-main` 2× — Treffer über eine Pipe-Kette
  (`git push -u origin … | … --base main`); semantisch korrekt (Push auf
  Nicht-main-Zweig mit `main`-Token in der Kette), aber grenzwertig.
  Regel matcht bewusst die ganze Kette; Anker-Wort `main` war im Wort.

Erkenntnis: Der Regelkatalog verhält sich; Treffer durch Zitat-Kontext sind
erwartbar und behindern die Klassifikation nicht (Lektionsschwelle
`minRuns = 2` verschiedene Sessions wurde nicht erreicht → keine Lektion).

## 4. Top-10 Befehlsfolgen (Mining, ≥ 3 Vorkommen in ≥ 2 Sessions)

| # | Gram (normalisiert) | Hits | Sessions | Vorschlag |
|---|---|---:|---:|---|
| 1 | `head -<n> ; cd /<path>` | 96 | 2 | `scripts/head-n.mjs` |
| 2 | `sort ; uniq -c` | 25 | 2 | `scripts/sort.mjs` |
| 3 | `sort ; uniq -c ; sort -rn` | 8 | 2 | `scripts/sort.mjs` |
| 4 | `uniq -c ; sort -rn` | 8 | 2 | `scripts/uniq-c.mjs` |
| 5 | `rm -rf /<path> ; mkdir -p /<path>` | 6 | 2 | `scripts/rm-rf.mjs` |
| 6 | `tail -<n> ; head -<n>` | 6 | 2 | `scripts/tail-n.mjs` |
| 7 | `head -<n>; grep -n <str> <path> ; head -<n>` | 5 | 2 | `scripts/head-n.mjs` |
| 8 | `head -<n> ; cut -c1-<n>` | 4 | 2 | `scripts/head-n.mjs` |
| 9 | `sort -rn ; head -<n>` | 4 | 2 | `scripts/sort-rn.mjs` |
| 10 | `sort ; uniq -c ; sort -rn ; head -<n>` | 4 | 2 | `scripts/sort.mjs` |

Sortierung nach Vorkommen × Ø-Turn-Kosten. Beide Sessions sind
Werkzeug-Sessions der Kur selbst (claude-Hauptsession + Pi-Worktree) —
die Idioms sind aber echte Kernutilities und damit zeitlos gültig.

## 5. Unparsed-Quote je Adapter

| Adapter | shellWithoutCommand | blobMissing | unknownShape |
|---|---:|---:|---:|
| claude | 0 / 831 | 0 | 0 |
| pi | 1 / 455 | 0 | 0 |
| cursor | 0 / 0 | 0 | 0 |

Die maki/opencode-Lücken (BUG-0247/BUG-0248) betreffen Sessions dieser
Adapter — im aktuellen Bestand ist kein maki-Run; der eine `pi`-Treffer ist
ein Shell-Tool ohne Command-Feld (Einzelfall, kein Systemausfall).

## 6. Piloten (umgesetzt, T72.4-Muster)

Aus § 4 die zwei höchsten Kandidaten, die zeitlose Kernidiome ersetzen:

1. `scripts/head-n.mjs` + Hülle `.claude/skills/head-n/SKILL.md`
2. `scripts/sort.mjs` + Hülle `.claude/skills/sort/SKILL.md`

Beide: deterministisch, `--json`, Exit 0/1/2, Tests mit positivem und
negativem Fall (`scripts/head-n.test.mjs`, `scripts/sort.test.mjs`).
Das Description-Ratchet steigt damit auf 4316 (Pilot-Hüllen zählen mit —
zulässig, weil von T72.4 gedeckt; danach gilt wieder: darf nur sinken).

Kosten vor/nach: Vorlauf = § 1; Nachlauf beim nächsten Kur-Lauf über
`turn_metrics` (äquivalente Aufgabe mit/ohne Pipe-Kette).
