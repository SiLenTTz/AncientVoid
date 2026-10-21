---
id: BUG-0060
slug: recovery-weiter-ueber-k7-trotz-parallelisierung
status: open
severity: S2
area: core
instance: prod
commit: ""
forge: ""
epic: "P0"
created: 2026-10-21
reporter: jan
---

# BUG-0060 — Recovery braucht weiter über 12 s trotz paralleler Wiederherstellung (K7)

## Gesehen

BUG-0050 (9.10.) startet bis zu sechs Sessions gleichzeitig. Der Neustart am 21.10. dauerte trotzdem
12,6 s für 31 Sessions (`recovery exceeded K7 budget`, Journal). Die Neustarts am 20.10. lagen bei
10,8 s und 11,6 s (29 Sessions). Mit sechsfacher Parallelität wäre bei 0,5 s je Session etwa 3 s zu
erwarten; die tatsächliche Zeit ist vier- bis fünfmal so lang.

## Erwartet

K7: Zustand in unter 3 s wiederhergestellt.

## Repro

1. Hub mit ~30 nicht beendeten Sessions (darunter ACP-/Codex-/Cursor-Sessions) neu starten.
2. `journalctl --user -u uacc-hub | grep "recovery"`.

**Ergebnis nach Schritt 2:** `elapsedMs` ≈ 12.600.

**Häufigkeit:** immer.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub, 31 Sessions, workerRunner tmux |
| Commit | main 2026-10-21 (enthält BUG-0050) |

## Logs

Das Journal enthält keine Zeiten pro Session; die Verteilung ist unbekannt. Deshalb loggt
`recoverAll` seit dieser Änderung bei Überschreitung zusätzlich `recovery detail`:
`sessionsMs`, `reconcileMs`, `healMs`, `reapMs`, Summe je Adapter und die fünf langsamsten Sessions.

## Tests

| Ring | Befehl / Datei | Stand |
|---|---|---|
| Integration | `packages/core/test/modules/sessions/recovery-parallel.test.ts` „… nennt, welcher Adapter …" | Messung, rot ohne Änderung |

## Eingrenzung

Offen: erst die Messung des nächsten Neustarts zeigt, ob die Zeit in `adapter.recover()` einzelner
Adapter (ACP-`session/load` mit großer Historie, Codex-Handshake), in `flow.reconcile()` oder in
`runner.reapOrphans()` liegt.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] Messung auswerten, dann Fix (ggf. Adapter-Recovery im Hintergrund: Zustand sofort, Handshake danach)
