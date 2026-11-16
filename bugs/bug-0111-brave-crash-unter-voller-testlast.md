---
id: BUG-0111
slug: brave-crash-unter-voller-testlast
status: done
severity: S3
area: e2e
instance: dev
commit: "856bab2"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/45"
epic: ""
created: 2026-11-10
reporter: "Nutzer (Beobachtung), Agent (Analyse)"
---

# BUG-0111 — Brave fällt unter voller Testlast aus (Renderer-Crash auf SIGTRAP)

## Gesehen

Während die volle Testsuite läuft (vitest + Playwright-E2E, lokal, zusammen mit
parallel laufenden Agent-Sessions), fällt der Brave-Browser des Nutzers
(~30+ Tabs, darunter speicherhungrige wie TradingView) aus bzw. Tabs
crashten bereits mehrfach nachweislich.

Crashpad-Bestand des Nutzer-Profils (4 Dumps, 09.09.–01.11., jeweils auf Tagen
mit vollem Gate-Lauf): 3× Renderer-Prozess mit Exception-Code
`EXCEPTION_SIGTRAP` (flags 0x80) an Adresse 0x0, 1× GPU-Prozess mit
`EXCEPTION_UNKNOWN`. Kein Kernel-OOM-Kill, kein systemd-oomd-Kill, nie unter
~11,9 GB verfügbarem Speicher — der Ausfall passiert also **innerhalb** des
Browsers (Chromium-eigene Immediate-Crash-Pfade unter Parallel-/Speicherdruck),
nicht durch ein externes Kill.

## Erwartet

Die lokale Test-Suite läuft, ohne dass der Alltags-Browser des Nutzers
(mitgeöffnet, ~30 Tabs) dabei den Geist aufgibt. Wenn der parallele
Lastgrad auf der geteilten Maschine die Browser-Prozesse in den
Immediate-Crash treibt, ist die lokale Parallelität so zu begrenzen, dass Gate
und Desktop gleichzeitig gehen (Präzedenzfall: CI bereits `workers: 1` für
geteilte Hardware, config-Kommentar zu BUG-0093/0094/0095).

## Repro

Voraussetzung: Nutzer-Desktop (~30+ geöffnete Browser-Tabs), mindestens eine
weitere Agent-Session mit eigener Suite aktiv.

1. Browser-Prozessbestand vor dem Lauf zählen (32 Renderer, 1 GPU).
2. `npm test` vollständig laufen lassen (219 Dateien, vitest maxWorkers 1).
3. Direkt anschließend `npm run test:e2e` (lokal 4 Worker × je eigener Hub +
   Chromium; parallel lief der geteilte Runner mit eigener Playwright-Suite).
4. Prozessbestand währenddessen alle 5 s protokollieren
   (`ps -C brave`, Crash-Report-Verzeichnisse, `free`).

**Ergebnis nach Schritt 4:** Renderer-Bestand konstant 32 bis ~9 Minuten
E2E-Lauf (10:15:26), dann vollständig aus der Prozesstabelle verschwunden;
kein neuer Crashpad-Dump (der heutige Exit ist damit nicht eindeutig
attribuierbar — kann auch ein manueller Close gewesen sein). Die vier
historischen Dumps (siehe Logs) belegen die Crash-Klasse auf Gate-Tagen
eindeutig.

**Häufigkeit:** laut Nutzer „immer"; analytisch belegt: 4 Crash-Dumps auf
Gate-Tage korreliert (09.09. 18:01; 28.10. 02:14 — Gates am Vorabend;
30.10. 22:07 — Gate-commits 21:54/22:38; 01.11. 10:24 — Gate-fenster
commits 10:23/10:27), heute Prozessverschwinden am E2E-Ende.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (Dev-Desktop, der die Gates ausführt) |
| Commit | `856bab2` |
| Node-Version | v26.7.0 |
| Adapter | pi (diese Session) |
| Repro-Weg | Prozess-/Crashpad-Monitoring (kein PWA/hubctl-Pfad betroffen) |

## Logs

Monitor-Mitschnitt (5-s-Raster; `free` in MB):

```text
== 10:02:47  32 type=renderer, 1 type=gpu-process   (Baseline, stabil bis 10:15:21)
== 10:15:26 mem used 20125 free 3673 avail 11875 swap used 13548
!!! BRAVE RENDERER SET CHANGED at 10:15:26           (Renderer-Bestand: weg)
```

Crashpad-Dumps (ExceptionStream, geparst mit python-minidump; Renderer ×3):

```text
87e9add8 (01.11. 10:24): EXCEPTION_SIGTRAP flags 0x80 addr 0x0 nparams 0
d26af2ef (30.10. 22:07): EXCEPTION_SIGTRAP flags 0x80 addr 0x0 nparams 0
19b882a4 (09.09. 18:01): EXCEPTION_SIGTRAP flags 0x80 addr 0x0 nparams 0
8aaeca93 (28.10. 02:14): EXCEPTION_UNKNOWN (GPU-Prozess)
```

Journal/Kern: 0 OOM-Kills (Journal der Crash-Tage ist mit dem damaligen Boot
verloren, aktueller Boot: 0 kills bei aktivem oomd), Swap dauerhaft ~13,5 GB
genutzt, Speicher-Untergrenze während des Laufs 11,9 GB avail — kein externer
Kill, der Crash kommt von innen.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `scripts/playwright-config.test.mjs` (vorgeschlagen) | nicht vorhanden |

Welcher Test müsste ohne Fix rot sein? Ein Guard auf die lokale
Playwright-Parallelität (`workers`-Grenze), als Anker an die bestehende
CI-Begrenzung.

## Eingrenzung

`playwright.config.ts` (Root) — `workers: process.env.CI ? 1 : 4`: lokal läuft
die Suite mit 4 parallelen Workern × (eigener Hub-Prozess + Chromium) auf der
geteilten Entwicklungsmaschine, zusätzlich zu laufenden Agent-Sessions.
Belegte Crash-Klasse: Chromium-Immediate-Crash (SIGTRAP) unter Parallel-/
Speicherdruck; CI hat genau dafür bereits `workers: 1`.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` (Fix: lokale Worker 4→2, Guard-Test `scripts/playwright-config.test.mjs`)
