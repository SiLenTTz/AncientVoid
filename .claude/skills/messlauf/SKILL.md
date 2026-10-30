---
name: messlauf
description: Faehrt einen Messlauf gegen die AncientVoid-Messlatten (K1-K10, PRD §9) und legt ihn nachvollziehbar ab. Aktiv bei Messlauf, Benchmark, Durchsatzmessung, Latenzmessung, oder immer dann, wenn eine Messzahl (z.B. "605 ev/s", "K6 <= 1,5s") zitiert werden soll.
---

# Skill: messlauf

Messen ist der leichte Teil. Der schwere ist, dass die Zahl in einem Monat
noch etwas bedeutet.

Kanonische Regeln: [`epics/2026-09-12-PRD-Unified-AI-Agent-Command-Center.md`](../../../epics/2026-09-12-PRD-Unified-AI-Agent-Command-Center.md)
§9 (K1–K10).

## Die eine Regel

> Eine Zahl ohne **Prüfstand**, **Modell/Version** (bei LLM-Adaptern:
> Modellname + Quantisierung), **Datum** und **Messwerkzeug** wird nicht
> zitiert.

## Ablauf

### 1. Vorher

- Welche Messlatte wird geprüft (K5 Payload, K7 Recovery-Zeit, K8 Durchsatz,
  K6 STT-Latenz, …)? Nummer nennen.
- Wiederholungen festlegen. Ohne Wiederholung keine Streuung, ohne Streuung
  keine Aussage über Stabilität.

### 2. Während

- `npm run loadtest` (K8) läuft gegen den lokalen Hub — Maschine sonst in
  Ruhe lassen, Fremdlast verfälscht Zeiten.
- Bei P1/P3-Adaptern (`claude`, `codex`, `swarm`): Modellversion und
  Sampling-Parameter (Temperatur etc.) mitschreiben — sie bestimmen das
  Ergebnis mit.

### 3. Danach: ablegen, bevor zitiert wird

```bash
mkdir -p docs/messlauf
```

Datei `docs/messlauf/YYYY-MM-DD-<kurzname>.md` mit: Umgebung (Node-Version,
Hardware/Maschine), Commit (`git rev-parse --short HEAD`), Kommando, Rohzahl(en),
Streuung (Median + Ausreißer), betroffene K-Nummer.

## Was in jeden Bericht gehört

| Pflicht | Warum |
|---|---|
| Streuung neben jedem Mittelwert | Ein Mittelwert ohne Streuung ist eine Behauptung |
| Abschnitt „Was das nicht sagt" | Vorbehalte gehören in den Bericht, nicht in den Kopf des Autors |
| `n/a` statt `0` | Ein ungelesener Wert ist kein Nullwert |

## Drei Fallen (aus Erfahrung anderer Projekte, hier vorwegnehmend)

1. **Mittelwert über einen abgeschnittenen Lauf.** Ein einzelner Timeout
   verschiebt den Durchschnitt stark. Median statt Mittelwert, wenn ein
   Ausreißer dabei war — und den Ausreißer benennen.
2. **Ein gemeldeter Seed ist keine Reproduzierbarkeit.** Sobald LLM-Adapter
   (`claude`, `codex`, `swarm`) gemessen werden: prüfen, ob ein Seed
   tatsächlich bis zum Sampler durchgereicht wird, statt dem Feld im
   Response-Objekt zu glauben.
3. **Die Bedienung des gemessenen Systems gehört ins Manifest.** Bei K6
   (STT-Latenz): welches Whisper-Modell, welche Quantisierung, lokal oder
   Server — das bestimmt die Zahl mit und gehört in die Messlauf-Datei, nicht
   nur ins Gedächtnis.

## Wann dieser Skill **nicht** greift

Für einen einzelnen Smoke-Test, der nichts belegen soll, reicht ein Lauf ohne
Ablage. Sobald die Zahl im README, einem ADR oder einer Epic-DoD auftaucht,
gehört sie unter `docs/messlauf/`.
