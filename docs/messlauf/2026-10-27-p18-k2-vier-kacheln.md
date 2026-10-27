# Messlauf — EPIC-P18 T18.6: K2 mit vier Kacheln

**Datum:** 2026-10-27 · **Commit:** `09c787b` (Branch `feat/p18-desktop-workspace`) ·
**Messlatte:** AC-P18-5 (K2: kein Frame-Lag über 200 ms bei 30 ev/s, hier vier Sessions gleichzeitig)

## Prüfstand

| Feld | Wert |
|---|---|
| Maschine | omarchy, Arch Linux, AMD Ryzen 7 5800X (16 Threads), 31 GiB RAM |
| Node | 26.7.0 |
| Browser | Chromium 155.0.8059.84 (System, Playwright), Viewport 2560 × 1440 |
| Hub | echter Hub-Prozess im Skript (`createHubApp`), In-Memory-DB, Loopback |
| Last | vier Sessions des Dummy-Adapters, je 30 Ereignisse/s, 4 × 30 = 120 ev/s in einem Browser |
| Fremdlast | **nicht leer:** Load Average 4–8 während der Läufe (andere Prozesse des Rechners, u. a. ein Streaming-Client) |
| Werkzeug | `scripts/k2-tiles.mjs` (neu). Wanduhr beider Seiten (Server-Emit → Zeile in der DOM-Kachel), `MutationObserver` je Kachel, Aufwärmphase ausgeschlossen. Methode wie `scripts/k2-frame-lag.mjs` |

Kommando: `K2_TILES=4 node scripts/k2-tiles.mjs 600`

## Ergebnis (600 s, Endstand)

| Größe | Wert |
|---|---|
| gesendet und in der Kachel gerendert | 72.490 von 72.490 (je Kachel 18.122–18.123) |
| Aufwärm-Ereignisse (ausgeschlossen) | 11 |
| Verzögerung Min / Median / p95 / p99 / Max | 1 / 36 / 91 / 106 / **176 ms** |
| Ereignisse über 200 ms | **0 von 72.490** |
| Kachel mit Fokus (Median / p95 / Max) | 13 / 28 / 89 ms |
| Kacheln im Hintergrund (Median / p95 / Max) | 49–52 / 93–94 / 150–176 ms |
| Drift | keine: Median 36–37 ms und p95 89–92 ms in jeder der zehn Minuten |

**AC-P18-5: erfüllt.**

## Weg dorthin (alle Läufe, auch die schlechten)

| Lauf | Dauer | Stand | p95 | Max | über 200 ms |
|---|---|---|---|---|---|
| 1 Kachel (Kontrolle) | 20 s | Ausgangslage | 11 ms | 40 ms | 0 / 605 |
| 4 Kacheln | 20 s | Ausgangslage | 880 ms | 1.366 ms | 606 / 2.422 |
| 4 Kacheln | 20 s | Zeilen nur bei Änderung neu rendern (`memo`) | 89 ms | 123 ms | 0 / 2.422 |
| 4 Kacheln | 600 s | nur `memo` | 120 ms | 306 ms | 29 / 72.517 |
| 4 Kacheln | 240 s | nur `memo`, bei hoher Fremdlast | 239 ms | 2.237 ms | 1.793 / 28.995 (Ausreißer in einer Minute) |
| 4 Kacheln | 180 s | dazu Bündelung (Fokus je Frame, Hintergrund 100 ms) | 170 ms | 254 ms | 193 / 21.745 |
| 4 Kacheln | 120 s | Bündelung im Hintergrund auf 50 ms | 143 ms | 287 ms | 44 / 14.502 |
| 4 Kacheln | 120 s | dazu Hintergrund-Kacheln auf 150 Zeilen begrenzt | 102 ms | 163 ms | 0 / 14.489 |
| **4 Kacheln** | **600 s** | **Endstand `09c787b`** | **91 ms** | **176 ms** | **0 / 72.490** |

Die drei Maßnahmen: (1) `EventRow` ist `memo` und rendert nur bei geänderten Daten, (2) neue Ereignisse werden gebündelt
(Fokus-Kachel einmal je Frame, andere höchstens alle 50 ms), (3) eine Kachel ohne Fokus hält nur die neuesten 150 Zeilen im DOM
und sagt es sichtbar („N ältere Einträge — Kachel anklicken zeigt alle“), der Fokus bringt alle zurück.

## Was das nicht sagt

- **Eine Maschine, ein Browser.** Chromium 155 auf einem 16-Thread-Rechner. Ein Laptop oder ein anderer Browser kann anders liegen.
- **Dummy-Adapter, keine echten Agenten.** Gemessen ist die Oberfläche, nicht die Last echter Agenten mit großen Tool-Ausgaben.
  Der Dummy sendet kurze Ereignisse; große Blobs (K5) sind nicht Teil dieses Laufs.
- **Der Lauf war nicht auf einer ruhigen Maschine.** Ein früherer 240-s-Lauf bei hoher Fremdlast hatte einen Ausreißer von 2,2 s in
  einer Minute. Der Endlauf ist grün, bei erneuter Fremdlast kann eine einzelne Spitze über 200 ms liegen. Für eine
  belastbare Streuung wären mindestens drei Läufe nötig, hier gibt es zwei 600-s-Läufe mit unterschiedlichem Stand (der erste, nur mit `memo`, war
  mit 29 von 72.517 über dem Budget nicht grün, das ist der Grund für Bündelung und Zeilenbegrenzung).
- **Kein Test mit mehr als 4 Kacheln** und keiner mit einer Kachel im Hintergrund-Tab des Browsers.
- Die Kacheln im Hintergrund zeigen bewusst nur 150 Zeilen. Das ist eine Produktentscheidung, kein Messtrick, steht aber in der
  Oberfläche, nicht nur hier.
