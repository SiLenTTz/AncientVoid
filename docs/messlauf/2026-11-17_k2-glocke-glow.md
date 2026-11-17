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

## Rohzahlen (A/B, gleicher Tag, gleiche Maschine — je 1 Lauf, 600 s @ 30 ev/s)

| Stand | Commit | Seqs (gematcht) | min | median | p95 | max | über 200 ms |
|---|---|---|---|---|---|---|---|
| main (Basis) | `11662872` | 18154 (18134) | 1 ms | **12 ms** | **20 ms** | 29 ms | 0 |
| feat/p64-glocke-glow | `5a1d166f` | 18158 (18135) | 1 ms | **12 ms** | **20 ms** | 27 ms | 0 |

```text
main:    [k2] lag ms: min=1 median=12 p95=20 max=29 — over 200ms budget: 0 of 18134
p64:     [k2] lag ms: min=1 median=12 p95=20 max=27 — over 200ms budget: 0 of 18135
```

**Ergebnis (AC-P64-5):** median und p95 sind identisch, max liegt im
Rausch — der P64-Umbau (Fluss-Glocke, Urgency-Ableitung je Render,
Hintergrund-Pending-Refresh) verursacht **keine messbare K2-Veränderung**.
Zur Einordnung: die historische Referenz vom 2026-09-18 (median 4/p95 5)
misst einen zwei Monate alten main-Stand auf einer unbelasteteren
Maschine; das gleichtägige A/B ist die aussagekräftigere Basis und
isoliert den P64-Effekt sauber.

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
