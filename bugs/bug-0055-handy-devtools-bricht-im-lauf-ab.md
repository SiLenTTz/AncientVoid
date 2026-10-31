---
id: BUG-0055
slug: handy-devtools-bricht-im-lauf-ab
status: done
severity: S3
area: e2e
instance: dev
commit: "8661491"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/13"
epic: "P16"
created: 2026-10-09
reporter: jan
---

# BUG-0055 — Die DevTools-Verbindung zum Handy-Chrome bricht mitten im Lauf ab

## Gesehen

Ein Volllauf von `npm run test:phone` verliert nach den ersten Tests die
Verbindung zu Chrome auf dem Handy. Jeder weitere Test scheitert nach 15 s
beim Verbinden, ohne die App zu öffnen.

## Erwartet

Die weitergeleitete DevTools-Verbindung hält den ganzen Lauf. Bricht sie ab,
endet der Lauf laut an der Stelle, statt dutzende Tests als Produktfehler zu
zählen.

## Repro

Voraussetzung: Pixel 9 Pro XL per `adb` (drahtlos), entsperrt, Chrome im
Vordergrund, `npm run test:phone -- --portrait`.

1. Suite starten.
2. Warten, bis Tests über die DevTools-Verbindung laufen.

**Ergebnis nach dem zweiten Test (Lauf 8, 2026-10-09, 16,7 min):**
`connectOverCDP` läuft in 15 s in den Timeout. 3 bestanden, 51 fehlgeschlagen,
4 übersprungen, 2 nicht gestartet. Danach lag der Fokus nicht mehr auf Chrome
(Brave, WebappActivity); der Socket `@chrome_devtools_remote_2445` antwortete
nicht mehr. Der nächste Volllauf (Lauf 9, ohne `--portrait`) lief 8,5 min
durch, ohne diesen Abbruch.

**Häufigkeit:** einmalig (ein von drei Vollläufen). Nicht erneut reproduziert.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Test-Hub, Handy per `adb forward` auf `127.0.0.1` |
| Commit | `8661491` |
| Node-Version | v26.7.0 |
| Adapter | — (die Tests erreichen die App nicht) |
| Repro-Weg | PWA (Chrome auf dem Pixel 9 Pro XL) |

## Logs

Quelle: `/tmp/phone-run8.log`. Kein Token.

```text
Error: Handy nicht erreichbar (http://127.0.0.1:34883): browserType.connectOverCDP: Timeout 15000ms exceeded.
Call log:
  - <ws preparing> retrieving websocket url from http://127.0.0.1:34883
```

Der Socket gehörte zu Beginn des Laufs zu `com.android.chrome`
(`@chrome_devtools_remote_2445`). Der Socket ohne Nummer auf demselben Gerät
gehört Brave, nicht Chrome.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `scripts/phone-e2e.mjs`, `e2e/support/phone.ts` | kein Test, der einen abgebrochenen Socket von einem Produktfehler trennt |

Den roten Test schreibt `bugfix`, falls sich der Abbruch festnageln lässt.
Einmalig ist kein stabiler Rot-Beweis.

## Eingrenzung

`e2e/support/phone.ts` (`chromium.connectOverCDP`). Offen, ob Chrome die
DevTools-Sitzung beendet, wenn der Tab geschlossen wird, oder ob der Fokus
auf Brave den Socket abbricht.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] behoben (2026-10-09)

## Behoben

Der Abbruch selbst (Chrome beendet den Socket) ist nicht reproduzierbar
nachgestellt. Was behoben ist: ein toter Socket oder ein Wechsel ins
Querformat beendet den Lauf, statt jeden folgenden Test 15 s warten zu
lassen. `scripts/phone-run-guard.mjs` liest `mDisplayRotation=ROTATION_90`
(das alte `mRotation=1` steht in `dumpsys` so nicht) und nennt den
Abbruchgrund. `e2e/support/phone.ts` schreibt eine Flagge und schickt dem
Playwright-Elternprozess SIGINT. Unit: `scripts/phone-run-guard.test.mjs`.
