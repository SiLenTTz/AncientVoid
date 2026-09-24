# ADR-0029 — Laya bleibt draußen (no-go für die Intent-Erkennung)

**Status:** akzeptiert · **Betrifft:** EPIC-P10 T10.4, ADR-0027 (Planer)

## Kontext

Laya (github.com/NandhaKishorM/laya, v0.3.20, Apache-2.0) ist ein
Encoder-Klassifikator für typisierte Entscheidungen (choice, score, …) mit
Werbung für etwa 33 ms Latenz. P10 sollte prüfen, ob er vor oder statt dem
P9-Planer die Absicht eines gesprochenen oder getippten Auftrags schneller
oder besser erkennt. AC-P10-4 legt die Schwelle fest: mindestens 95 %
richtig auf Held-out-Daten und ein messbarer Vorteil bei Latenz oder
Ressourcen.

## Messung

Details stehen in `docs/messlauf/2026-09-24-p10-stt.md` §3 und
`scripts/stt-bench/laya_eval.py`. Laya bekam eine Wahl über die 16
Katalog-Operationen plus `none`, zero-shot, auf CPU. Die Daten waren 131
Formulierungen aus der P9-Evaluation und dem Held-out-Satz.

- Richtig: 41,4 % held-out, 30,4 % dev. Der P9-Planer kommt auf 96,7 %.
- 16 von 25 Nicht-Aufträgen (Fragen, Verneinungen) bekamen eine Operation.
  Das ist die gefährliche Fehlerklasse.
- Latenz p50 234 ms auf CPU. Die Regeln brauchen unter 1 ms und decken den
  Großteil ab.
- Laya liefert keine Argumente (Ziel-Session, Text, Betrag). Der Resolver
  und meist das Modell müssten danach trotzdem laufen.

## Entscheidung

**No-go.** Laya wird weder installiert noch als optionaler Schritt eingebaut.
Der Planer bleibt so: zuerst Regeln, dann das lokale Modell mit JSON-Schema
(ADR-0027).

## Wann neu prüfen

Nur wenn beides zutrifft:

- Es gibt ein Laya-Modell, das auf unseren Daten feingetunt ist oder das
  Deutsch ausdrücklich unterstützt.
- Der P9-Rückfall auf das lokale Modell wird zum Latenzproblem, messbar an
  der Rückfallquote mal der Modelllatenz.

Selbst dann nur als Vorfilter mit kalibrierter Schwelle. Die Freigabe und die
Vorschau bleiben unabhängig vom Klassifikator.
