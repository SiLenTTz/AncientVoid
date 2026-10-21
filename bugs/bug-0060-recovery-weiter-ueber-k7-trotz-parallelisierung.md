---
id: BUG-0060
slug: recovery-weiter-ueber-k7-trotz-parallelisierung
status: done
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

Gemessen beim Neustart am 21.10. (`recovery detail`): 12.043 ms für Sessions, `reconcile` 1 ms, `reap` 19 ms.
Je Adapter: **opencode 17 Sessions, zusammen 65.319 ms, langsamste 10.219 ms**; codex 1 Session 2.298 ms;
claude 12 Sessions 954 ms; cursor 9 Sessions 273 ms; hermes 3 Sessions 104 ms.

Ursache: `packages/adapters/acp/src/index.ts` `recover()` startete ohne überlebenden Agent-Prozess für jede
Session einen neuen Agenten, initialisierte ihn und lud per `session/load` die ganze Historie (bis MB) —
auch für Sessions, die nur herumliegen. ACP-Worker (`stdin: pipe`) überleben den Hub nicht.

Fix: träge Wiederherstellung. `recover()` merkt sich die native Session-ID (`dormant`) und gibt sofort einen
Handle zurück; der Agent startet beim ersten Prompt (`wake()`, derselbe Ladepfad wie bisher, einmal auch bei
zwei gleichzeitigen Prompts). `status()` meldet schlafende Sessions als gesund, `stop()` räumt auf.

**Nach dem Fix gemessen (Produktiv-Hub, 21.10.2026, gleicher Bestand, 31 Sessions):** Recovery **0,66 s**
(Journal: `adapters loaded` 14:06:52.845 → `recovery finished` 14:06:53.501), vorher 12,0 s; keine K7-Warnung.
Der Hub war nach 4 s gesund.

**Weckpfad live geprüft** (isolierter Hub, echtes dsh): Session mit Codewort, Hub per `kill -9` beendet,
neu gestartet → Status `idle`, `managed`, kein Agent-Prozess, Event „Agent startet mit dem nächsten Prompt".
Prompt „Wie lautet das Codewort?" → Agent startet (HTTP-Antwort in 1,5 s), lädt die Konversation, antwortet
„MANGO-77", gleiche native Session, keine doppelte Historie (BUG-0036 bleibt erfüllt).

Folge: Der erste Prompt nach einem Hub-Neustart braucht dadurch länger (Agent starten, Historie laden);
bei großen Historien (opencode bis 10 s) sieht man das als Wartezeit vor der Antwort.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Messung ausgewertet, Fix umgesetzt und nachgemessen
