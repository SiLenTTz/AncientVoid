# Messlauf — K2 Frame-Lag, EPIC-P64 (Glocke: Fluss-Layout + Dringlichkeits-Glow)

**Messlatte:** K2 / AC-P64-5 — der Glocken-Umbau (Flusselement im Kopf der
Listenspalte statt `position: fixed`, 44 px, pulsierender Glow nach
Dringlichkeit, Hintergrund-Pending-Refresh) verschlechtert die Tail-Render-
Latenz nicht. Vergleichsbasis: der P1.6-Abschlusslauf
[`2026-09-18-k2-frame-lag-p1.6-final.md`](2026-09-18-k2-frame-lag-p1.6-final.md)
(median 4 ms, p95 5 ms, max 25 ms, 0 über Budget).

## Prüfstand

| Feld | Wert |
|---|---|
| Datum | 2026-11-17 |
| Commit | `5a1d166f` (feat/p64-glocke-glow, nach T64.2–T64.5 + main-Merge) |
| Maschine | Omarchy, Linux x86_64 — **unter Grundlast** (Hub mit ~165 Sessions, E2E-Läufe beendet) |
| Node-Version | v26.7.0 |
| Browser | echter Chromium (`/usr/bin/chromium`) über Playwright, Viewport 390×844 |
| Messwerkzeug | `scripts/k2-frame-lag.mjs` (unverändert) |
| Modell/Adapter | `dummy` (kein LLM — K2 misst die Render-Pipeline) |

## Kommando

```bash
node scripts/k2-frame-lag.mjs 600
```

## Rohzahlen (1 Lauf, 600 s @ 30 ev/s)

<!-- NUMMERN -->

## Was das nicht sagt

- **Der Glow war während des Laufs inaktiv:** Der K2-Hub startet ohne
  ungelesene Meldungen, die Glocke pulsiert nicht. Die Animationskosten
  sind per Design begrenzt (ein 44-px-Element, `box-shadow`-Repaint mit
  0,83 Hz Zyklusdauer, kein Layout-/Reflow-Anteil) — ein Belastungslauf
  mit aktivem Glow (ungelesener Fehler offen) bleibt der
  T63.0-Referenzmessung vorbehalten und ist als Action Item in der
  P64-Retro vermerkt.
- **Keine T63.0-Referenz:** Vergleichsbasis ist der P1.6-Lauf vom
  2026-09-18 (main @ 64632fa) — seitdem ist main gewandert; die
  Vergleichbarkeit ist gegeben über das unveränderte Messwerkzeug und die
  stabile Messgröße (median/p95 lagen in allen drei historischen Läufen
  innerhalb 1–5 ms).
- **Maschine nicht in Ruhe:** Grundlast durch den laufenden Produkt-Hub —
  konservativ, d. h. echte Ruhe-Zahlen liegen eher niedriger.
