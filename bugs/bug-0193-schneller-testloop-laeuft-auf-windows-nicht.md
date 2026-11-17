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
