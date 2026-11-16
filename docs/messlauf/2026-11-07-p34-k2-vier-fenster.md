# Messlauf — EPIC-P34 T34.12: K2 mit vier eigenen Fenstern, K1 im eigenen Fenster, K8

**Datum:** 2026-11-07 · **Commit:** `91eea9d` (Branch `av-p34-impl`) plus die Skripte `scripts/k2-windows.mjs` (neu) und
`K1_WINDOW` in `scripts/messlauf-approve-latency.mjs` aus dem Commit, der diesen Bericht enthält ·
**Messlatten:** AC-P34-12 (K2: kein Frame-Lag über 200 ms bei 30 ev/s, vier Sessions in vier Fenstern), K1/AC-P2-3 (Approve < 5 s), K8

## Prüfstand

| Feld | Wert |
|---|---|
| Maschine | workstation, Arch Linux, 16 Threads, 31 GiB RAM |
| Node / Browser | 26.7.0 / Chromium 155.0.8059.84 (System, Playwright), `--no-sandbox` |
| Hub | echter Hub im Skript (`createHubApp`), In-Memory-DB, Loopback |
| Last | vier Dummy-Sessions, je 30 ev/s (120 ev/s), jede in einem eigenen Fenster `/?window=1#/sessions/<id>`, dazu ein Hauptfenster |
| Fremdlast | **nicht leer, hoch:** Load Average 9–20 während aller Läufe (moonlight, Brave, ein Dashboard-Prozess, CI-Runner-Jobs) |
| Werkzeug | `scripts/k2-windows.mjs`: Wanduhr beider Seiten (Server-Emit → Zeile im DOM des Fensters), `MutationObserver` je Fenster, Aufwärmphase ausgeschlossen |

Kommando: `node scripts/k2-windows.mjs 600` (Lauf 1/2 mit `K2_SHARED=1`-Aufbau, siehe unten)

## Ergebnis K2 (Lauf 4, 600 s, Endstand)

| Größe | Wert |
|---|---|
| gesendet und gerendert | 72.284 von 72.284 (je Fenster 18.071) |
| Aufwärm-Ereignisse (ausgeschlossen) | 61 |
| Verzögerung Min / Median / p95 / p99 / Max | 1 / 11 / 19 / 23 / **110 ms** |
| Ereignisse über 200 ms | **0 von 72.284** |
| je Fenster Max | 110 / 79 / 106 / 109 ms |
| Drift | keine: Median 11 ms, p95 18–19 ms in den vollen Minuten |

## Alle Läufe (auch die schlechten)

| Lauf | Aufbau | Dauer | p95 | Max | über 200 ms |
|---|---|---|---|---|---|
| 1 | vier Tabs in **einem** Browser-Kontext | 600 s | 204 ms | 1.079 ms | 3.627 / 72.389 |
| 2 | dto., Flags gegen Hintergrund-Drosselung | 600 s | 750 ms | 1.208 ms | 10.961 / 72.263 |
| Probe | **ein Kontext je Fenster** | 60 s | 20 ms | 72 ms | 0 / 7.216 |
| 3 | ein Kontext je Fenster | 600 s | 22 ms | 721 ms | **66 / 72.150** (alle in Minute 1) |
| **4** | ein Kontext je Fenster | 600 s | 19 ms | 110 ms | **0 / 72.284** |

Lauf 1 und 2 waren ein **Messaufbaufehler**: Nur das zuletzt geöffnete Fenster (Fenster 4) war sauber, Fenster 1–3 zeigten ~1-s-Takt.
Tabs eines Kontexts gelten im Hintergrund nicht als sichtbar, die Drosselungs-Flags änderten daran nichts. Echte Fenster sind je
für sich sichtbar, deshalb bildet ein Kontext je Fenster den Betrieb besser ab. Das ist eine Einschätzung aus dem Muster und der
Probe, nicht gesondert bewiesen. Lauf 3 verfehlte das Budget einmalig (66 Ereignisse in einer Minute, Maximum 721 ms) bei Load 19,
Lauf 4 nicht. **Das Ergebnis ist damit nicht stabil grün, sondern „2 von 2 vollen Läufen im richtigen Aufbau: 1 grün, 1 mit Ausreißer“.**

## K1 im eigenen Fenster und K8

| Messung | Ergebnis |
|---|---|
| K1 Hauptfenster (`K1_WINDOW=0`, 20 echte WebAuthn-Zeremonien, virtueller Authenticator) | median 11 ms, p95 14 ms, max 14 ms |
| K1 eigenes Fenster (`K1_WINDOW=1`, Popout-Hülle der Session) | median 11 ms, p95 13 ms, max 13 ms |
| K8 `npm run loadtest` (20 Sessions × 30 ev/s × 10 s) | 6.087 Ereignisse, 603 ev/s, rss 150 MB, kein Verlust |

## Was das nicht sagt

- **Eine Maschine, ein Browser, hohe Fremdlast.** Chromium 155; Lauf 3 zeigt, dass unter Last Spitzen über 200 ms vorkommen. Für eine belastbare Streuung fehlen mehr Läufe auf ruhiger Maschine.
- **Dummy-Adapter, keine echten Agenten, keine großen Blobs (K5).**
- **Fenster sind Chromium-Kontexte, keine echten Betriebssystemfenster.** Mehrere Monitore, Hyprland/Wayland und Firefox sind nicht gemessen; das ist Jans Live-Abnahme (AC-P34-13).
- **K1 misst WebAuthn und HTTP im Seitenkontext**, mit Chromiums virtuellem Authenticator. „Im eigenen Fenster“ heißt hier: die Seite läuft als Popout-Hülle; ein Unterschied zum Hauptfenster ist nicht zu erwarten und wurde nicht gefunden (13 vs. 14 ms p95), das ist kein Beleg für UI-Verhalten beim Bestätigen.
- Der Push-Anteil von K1 ist weiterhin nicht Teil der Messung (siehe Skriptkopf).
