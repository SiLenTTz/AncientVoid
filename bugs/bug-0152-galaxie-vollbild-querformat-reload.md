---
id: BUG-0152
slug: galaxie-vollbild-querformat-reload
status: done
severity: S4
area: e2e
instance: dev
commit: "f92263a"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/59"
epic: "P52 (Test-Fix), P57-Fund"
created: 2026-11-13
reporter: agent (P57-Gate), aufgeklärt 13.11.2026
---

# BUG-0152 — Galaxie-E2E rot auf main: Erwartung nach Querformat-Reload zeitlich zu streng (Produkt korrekt)

## Gesehen

`e2e/specs/repo-galaxie.spec.ts` „System, Zurück-Reihenfolge und Vollbild"
rot auf `main` (z. B. im T57.9-Gate-Lauf, 610 passed/1 failed): nach
`setViewportSize(915×412)` + Reload wurde `.graph-pane` innerhalb der
10-s-Erwartung nicht gefunden („element(s) not found").

## Ursache (aufgeklärt durch Diagnose-Spec, 13.11.2026)

Das **Produkt verhält sich korrekt**: Der Hash behält `/graph` über die
Esc-Kaskade und den Reload; der Graph stellt sich danach im Vollbild wieder
her — auch im Querformat (belegt: `hash: …/graph`, `pane: "1"` nach Boot).
Rot wurde die Spec, weil der **kalte PWA-Boot nach dem Reload unter
Suite-Last länger als die 10-s-Erwartung** dauert (große Chunks, volle
Parallelität). Im Einzellauf erscheint der Pane prompt — das erklärt, warum
der Fehler nur in vollen Läufen auftrat.

## Fix

Erwartung bleibt semantisch wie ursprünglich (Graph-Vollbild nach Reload),
aber mit ausdrücklichem `timeout: 30_000` für genau diese Assertion —
dokumentiert im Spec-Kommentar. Kein Produktcode geändert.

## Repro

Voller Suite-Lauf (belastete Maschine) vs. Einzellauf: Einzellauf grün,
Suite-Lauf rot an derselben Stelle — das Timing-Muster, kein
Verhaltensmuster.

## Tests

| Ring | Datei | Stand |
|---|---|---|
| E2E | `e2e/specs/repo-galaxie.spec.ts` (Vollbild-Assertion nach Reload) | korrigiert (30 s) |

## Eingrenzung

Kein Defekt in `apps/pwa`. Die_spec kam mit dem Galaxie-Merge (!446); ihre
Erwartung war richtig, ihr Timeout zu knapp für den Kalt-Boot unter Last.

## Handoff

- [x] Spec-Timeout korrigiert (MR folgt)
- [x] Datei im Index [`README.md`](README.md) — Status done
- [x] GitLab-Issue [#59](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/59) (Kommentar folgt im MR)
