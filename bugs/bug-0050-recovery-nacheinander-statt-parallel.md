---
id: BUG-0050
slug: recovery-nacheinander-statt-parallel
status: done
severity: S2
area: core
instance: prod
commit: ""
forge: ""
epic: "P0"
created: 2026-10-09
reporter: jan
---

# BUG-0050 — Hub-Recovery braucht 12–14 s statt unter 3 s (K7)

## Gesehen

Jeder Hub-Start meldet `recovery exceeded K7 budget`. Das Journal zeigt es an allen vier
dokumentierten Neustarts: 13,4 s (06.10.), 12,8 s (07.10.), 14,0 s (08.10.), 12,6 s (09.10.),
jeweils für 22–25 Sessions. K7 verlangt: Zustand wiederhergestellt in unter 3 s.

## Erwartet

Recovery unter 3 s bei diesem Bestand.

## Repro

1. Hub neu starten (`systemctl --user restart uacc-hub`).
2. `journalctl --user -u uacc-hub` nach `recovery exceeded K7 budget` durchsuchen.

**Ergebnis nach Schritt 2:** `elapsedMs` ≈ 12.600.

**Häufigkeit:** immer.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub, 24–25 nicht beendete Sessions |
| Commit | seit mindestens 2026-10-06, nicht durch EPIC-P15 verursacht |
| Repro-Weg | Journal |

## Logs

```text
recovery exceeded K7 budget  elapsedMs=12613 budgetMs=3000   (recovered 25, failed 0)
```

Messung: das Nachlesen der Event-Logs aller Sessions kostet zusammen **83 ms**. Die Zeit liegt in
`adapter.recover()` (je ca. 0,5 s: Prozess prüfen, Handshake), das nacheinander lief.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Integration | `packages/core/test/modules/sessions/recovery-parallel.test.ts` (12 Sessions à 150 ms Wartezeit) | rot ohne Fix (sequenziell ≥ 1800 ms) |

## Eingrenzung

`SessionManager.recoverAll()`: `for … await` über alle Sessions. Sessions sind unabhängig. Fix:
höchstens sechs gleichzeitig (`mapLimit`), Ergebnis wie bisher gezählt; ein fehlschlagender Adapter
zählt nur sich selbst. Ob die 3 s am echten Bestand erreicht werden, zeigt erst der nächste Neustart
(Messwert wird nachgetragen).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
