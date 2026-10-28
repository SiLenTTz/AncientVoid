# Loops / Dark Factory (EPIC-P19, ADR-0038)

Beim Start einer Session lässt sich ein **Loop** wählen (Zeile „Loop“ im Start-Formular, PWA).
Ein Loop ist ein eigenständiges System, das seine Agenten selbst ausführt; der Hub zeigt und steuert es.

## Stand (2026-10-28)

| Loop | Transport | Stand |
|---|---|---|
| `aspark-factory` (aSPARK-Factory) | MQTT-Leitstand | sichtbar, **gesperrt** — Connector T19.4 fehlt |
| `securesight-factory` (Adapter `securesight-harnez`) | CLI und Dateien, Orchestrator `self` oder `hermes` | sichtbar, **gesperrt** — Connector T19.5 fehlt |

Gesperrt heißt: in der Auswahl sichtbar mit Grund, der Start wird vom Hub mit 422 abgelehnt. Der Adapter
`securesight-harnez` läuft unabhängig davon weiter als normaler Harness.

## API

- `GET /api/loops` — Liste mit `available`, `reason`, Optionen (ohne Secrets).
- `POST /api/sessions` mit `loop: { id, options? }` — nur für Menschen (Policy `loops.start`); ein Agenten-Token bekommt 403,
  ein nicht angebundener oder unbekannter Loop 422, eine Option außerhalb der Fähigkeiten 422.

## Einen Connector anbinden

Ein Connector meldet sich beim `LoopRegistry` mit `markConnected(id)` an; ab dann ist der Loop startbar. Die Schnittstelle
`LoopConnector` selbst (T19.1) und die Pakete unter `packages/loops/*` stehen noch aus.
