# BUG-0193 — `test:fast` und `test:slow` sind auf Windows unbenutzbar

- **Status:** done
- **Schicht:** repo (Test-Skripte)
- **Schwere:** S2 — der vorgesehene schnelle Arbeits-Loop existierte auf Windows nicht;
  alle Welt lief mit nacktem `npx vitest run` und verlor die Tier-Aufteilung

## Beobachtung

```
$ npm run test:fast
Der Befehl "VITEST_SET" ist entweder falsch geschrieben oder
konnte nicht gefunden werden.
```

`package.json` schrieb `"test:fast": "VITEST_SET=fast vitest run"`. Das ist
POSIX-Inline-Umgebung. npm führt Scripts auf Windows über `cmd.exe` aus, und die kennt diese
Schreibweise nicht. Dasselbe gilt für `test:slow` — das der Nightly-Run anmacht.

## Erwartet

Beide Tier-Skripte laufen auf jeder Plattform, auf der das Repo läuft (Kais Desk ist
Windows), und setzen dabei dieselbe Tier-Auswahl wie auf Linux.

## Ursache und Fix

Kein Cross-Platform-Runner, kein neue Abhängigkeit: `scripts/vitest-set.mjs` setzt
`VITEST_SET` selbst und startet den Vitest-Einstieg (`node_modules/vitest/vitest.mjs`) mit
geerbter Ein-/Ausgabe. Die Scripts heißen jetzt:

```json
"test:fast": "node scripts/vitest-set.mjs fast",
"test:slow": "node scripts/vitest-set.mjs slow",
```

## Beleg

`npm run test:fast` auf Windows, 2026-11-17: vollständige Tier-A-Zusammenfassung —
`Test Files 52 failed | 253 passed | 2 skipped (307)`,
`Tests 137 failed | 1974 passed | 53 skipped (2164)`.

Die roten Dateien bleiben (BUG-0170, Windows-Suite), aber der Loop ist jetzt benutzbar und
liefert eine zählbare Messlatte statt eines Syntaxfehlers. Vorher gab es auf Windows für
Tier A **kein** Ergebnis.

## Betroffene Fälle

- Jeder Agent auf Windows, der den schnellen Loop probiert (AGENTS.md und Skill `gates`
  empfehlen ihn als Standard).
- `nightly.yml` ruft `npm run test:slow` — auf Windows-Runnern wäre das ebenfalls
  fehlgeschlagen.

## Nachtrag: Tier A ist 12× schneller (2026-11-17, gemessen)

Zwei Stufen, beide auf Kais Windows-Desk (20 Kerne) gemessen:

| Schritt | Dauer Tier A | Testzählung |
|---|---|---|
| Ausgangslage (seriell, Attrappen-Spawn kaputt) | **451,6 s** | 137 failed / 1974 passed |
| Spawn ohne Shell-Layer (BUG-0179, Nachtrag 3) | **246,4 s** | 112 failed / 2006 passed |
| Tier A parallel (8 Forks) | **36,3 s** | 112 failed / 2006 passed |
| Tier A parallel (automatisch: 16 Forks auf 20 Kernen) | **22,6–23,2 s** | 112 failed / 2006 passed, ein Lauf 111/2007 (der Flake aus Issue #85) |

Warum seriell überhaupt lief: `maxWorkers: 1` war der Ersatz für `singleFork` — Noetzlichkeit
wegen der zeitbasierten Tests (BUG-0001/0002). Diese und die Port-Binder stehen aber längst in
`scripts/slow-tests.json` und laufen als Tier B **weiter seriell**. Tier A enthält keine davon,
also parallel. Die Stufe skaliert automatisch (max. 16 Forks, Kerne minus zwei) und ist über
`VITEST_WORKERS` ohne Code-Änderung verstellbar. Auf einem Hosted-Runner mit 4 Kernen sind
das 2 Forks statt 16 — der Lauf läuft nicht gegen den Runner-Arbeitsspeicher.

Stabilität: drei Tier-A-Läufe parallel = 36,3 / 35,2 / 35,3 s, jeweils exakt
112 failed / 2006 passed / 53 skipped. 120 rote Testidentitäten sind in allen Läufen identisch
(BUG-0170), **drei** tauchten jeweils nur in einem Lauf auf und sind damit Flake-Kandidaten der
Parallelstufe: `handover.test.ts`, `sessions/steer-wait-timeout.test.ts` (Occupant-Pinning,
Verwandter von Issue #83), `sessions/turn-state.test.ts` (Herunterfahren mit laufenden Workern).
Dafür ist Issue #85 gemeldet; sie bleiben erst mal in Tier A, weil sie keine Ports binden.
