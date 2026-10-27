---
id: BUG-0074
slug: hub-heap-oom-absturz
status: open
severity: S1
area: core
instance: prod
commit: "21706d8"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/29"
epic: "P17"
created: 2026-10-27
reporter: jan
---

# BUG-0074 — Der Hub stürzt wiederholt mit „JavaScript heap out of memory“ ab

## Gesehen

Der Produktiv-Hub bricht mit `SIGABRT` ab (`FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`,
ca. 4 GB). Heute: 79 Neustarts zwischen 09:13 und 12:11, 17 weitere zwischen 15:36 und 16:12. Dazwischen lief er stundenlang stabil (12:14–14:41 bei
~430 MB, 14:41–15:36). Mit `KillMode=control-group` (BUG-0072) hat jeder Absturz alle Sessions unterbrochen.

## Erwartet

Der Hub bleibt bei einigen hundert MB und stürzt nicht ab.

## Repro

**Nicht reproduziert.** Der Absturz kam nur im Produktivbetrieb vor, mit 52 Sessions (39 live), zwei Fleet-Peers und geöffneten PWA-Fenstern.

1. Hub starten, wie üblich benutzen.
2. Nach einigen Minuten bis rund einer Stunde wächst der Speicher auf ~4 GB und der Prozess bricht ab.

**Häufigkeit:** gebündelt (zwei Schleifen heute), Auslöser unbekannt.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub omarchy, Node 26.7.0, Linux 7.2 |
| Commit | `21706d8` (davor Stand von 08:11) |
| Sessions | 52 (39 live), Adapter claude, codex, opencode, pi, hermes u. a. |
| Repro-Weg | Journal (`journalctl --user -u uacc-hub`), kein Klickweg |

## Logs

```text
12:08:51 node[3461788]: FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
12:11:00 systemd: uacc-hub.service: Main process exited, code=dumped, status=6/ABRT
12:11:00 systemd: Consumed 3min 47.108s CPU time over 1min 52.600s wall clock time, 4.5G memory peak
09:13:43 systemd: Consumed 17min 19.577s CPU time over 1h 2min 28.715s wall clock time, 4.4G memory peak   (erster Absturz)
```

Vor dem Absturz um 15:36:49 gab es **keinen Anfragen-Sturm** (140 Anfragen in 110 s, Polling), aber Antworten mit 2,3 / 2,5 / 3,0 / 7,0 s (GC-Druck). In
einer ruhigen Phase (15:00–15:02, 639 Anfragen) keine einzige Antwort über 1,5 s. Die Session-Dateien sind klein (max. 2,3 MB), die Worker-Logs ebenso
(max. 6,8 MB). `opencode.db` ist 1,4 GB groß, enthält aber nur 72 MB Nutzdaten.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| — | — | kein Test möglich ohne Ursache |

Vorschlag nach der Ursache: ein Speicher-Test im Loadtest (K8) mit 50 Sessions, 1 h, RSS-Obergrenze.

## Eingrenzung

Offen. Ausgeschlossen: Anfragen-Flut, große Session- oder Worker-Dateien, Claude-Transkript dieser Session (16 MB). Nächster Schritt: Heap-Snapshot bei
niedrigerem Heap-Limit (`--max-old-space-size=1536 --heapsnapshot-near-heap-limit=1`) per Dienst-Drop-in, dazu ein RSS-Protokoll im Minutentakt. Der
Diagnose-Report (`--report-on-fatalerror`) hat bei den Abstürzen von 15:36–16:12 **keine** Datei geschrieben. Mit BUG-0072 behoben stören Abstürze die
Sessions nicht mehr, die Ursache bleibt offen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` offen, Ursache unbekannt
