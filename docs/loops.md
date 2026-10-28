# Loops / Dark Factory (EPIC-P19, ADR-0038)

Beim Start einer Session lässt sich ein **Loop** wählen (Zeile „Loop“ im Start-Formular, PWA).
Ein Loop ist ein eigenständiges System, das seine Agenten selbst ausführt; der Hub zeigt, beantwortet Fragen und steuert.

## So hängt es zusammen

```text
Start-Formular ──POST /api/sessions {loop}──▶ Hub ──▶ Session mit Adapter "loop:<id>"
                                               │         (loopAsAdapter, Snapshot für K7)
                                               ▼
                                     LoopConnector (packages/loops/<name>)
                                               ▼
                                  Loop-System (MQTT-Broker bzw. Dateien/CLI)
```

- Der **Connector** sieht nur `@uacc/contracts` (`check:arch`-Regel `loops-only-contracts`).
- Die Session trägt den internen Adapter `loop:<id>`; EventStore, Recovery, Freigaben, Push und PWA laufen unverändert.
  Die Adapter-Liste (`/api/adapters`) führt diese Shims nicht; sie stehen in `GET /api/loops`.
- Die Auswahl des Start-Formulars steht als `args.loop` im Event `session.created`.
- **Ohne Worktree:** ein Loop arbeitet im Projekt des Loop-Systems selbst.
- **Steuern über den normalen Weg:** Pause/Fortsetzen = `park`/`resume`, Betriebsart = „Modus“ (`configure`), „nächste Aufgabe“ = Prompt.
- **Wiederanlauf (K7):** je Session liegt `data/loops/<sessionId>.json` (Startvorgabe + Leseposition). Nach einem Hub-Neustart
  liest der Connector ab dort weiter — nichts doppelt, nichts fehlt.
- **Ereignisse:** `system`-Events mit `payload.kind` = `loop.info | loop.state | loop.progress | loop.gate | loop.stats | loop.report |
  loop.broken | loop.command | loop.notify`. Inhalte, die der Loop als Agenten-Output liefert, erscheinen als normale Chat-Events.
- **Fragen** des Loops kommen als Freigaben (`AskUserQuestion` bzw. Tool-Freigabe) in die vorhandene Ansicht; Antwort nur einmalig
  `allow`/`deny` bzw. Auswahl, nie „immer erlauben“.

## Einrichten (`hub.config.json`)

```json
"loops": [
  { "id": "aspark-factory",      "module": "@uacc/loop-aspark-factory",      "config": { "url": "mqtt://127.0.0.1:1883", "username": "uacc-leitstand", "passwordFile": "~/.config/uacc/aspark-mqtt.key" } },
  { "id": "securesight-factory", "module": "@uacc/loop-securesight-factory", "config": { "pollMs": 5000 } }
]
```

Schlüssel nur als Datei (`passwordFile`), nie als Wert in der Konfiguration. Ein Loop, der nicht lädt, bleibt in der Auswahl
sichtbar, gesperrt, mit dem Grund. Ohne Eintrag steht er als „nicht eingerichtet“ da.

## API

- `GET /api/loops` — Liste mit `available`, `reason` und den Fähigkeiten des Connectors (Betriebsarten, riskante Betriebsarten,
  Orchestratoren, Steuerbefehle, Optionen). Keine Secrets.
- `POST /api/sessions` mit `loop: { id, mode?, orchestrator?, options? }` statt `adapter` — nur für Menschen (Policy `loops.start`);
  ein Agenten-Token bekommt 403, ein nicht angebundener oder unbekannter Loop 422, eine Auswahl außerhalb der Fähigkeiten 422.

## Einen Connector schreiben

`createLoopConnector(config?) => LoopConnector` exportieren (`packages/contracts/src/loops/connector.ts`) und
`runLoopContractTests(createLoopConnector, …)` aus `@uacc/adapter-testkit` grün bekommen. Der Fake-Loop
(`@uacc/adapter-testkit/fake-loop`) ist die Vorlage und läuft in den E2E-Specs.

## aSPARK-Factory (`@uacc/loop-aspark-factory`)

Der Hub ist ein Leitstand-Client einer Linie (AsyncAPI 0.9.0, alle Nachrichten `v:1`). Pro Session ein MQTT-Client
`uacc-<sessionId>`, abonniert wird nur die gewählte Linie (Option `line`).

| Topic | im Hub |
|---|---|
| `agent/<line>/info` | `loop.info` (Betriebsart, Aktivität); `status:offline` (Last Will) = `loop.broken`, Status `down` |
| `…/<session>/state`, `…/progress` | `loop.state`, `loop.progress` (Aufgaben, Phase, Gate policy/review/ci/merge) |
| `agent/<line>/stats`, `…/report` | `loop.stats`, `loop.report` (Bericht über 2 KB als Blob) |
| `…/<session>/ask` | Rückfrage auf dem Handy; Antwort nach `…/answer` (`allow`/`deny`, bei Fragen Indizes + Notizen) |
| `agent/<line>/command` | `pause`, `resume`, `set-mode`, `work` (nur Issue-Nummer); geprüft gegen `commands[]` der Linie |

Grenzen: kein `allow-always` (v1 der Factory); „Nein“ auf eine Frage kennt das Protokoll nicht, die Linie handelt dann
nach ihrem `timeoutAction`. Das Passwort steht nie in der Config, nur `passwordFile`. Tests: echter `mosquitto`
auf Zufallsport (`packages/loops/aspark-factory/test/aspark.test.ts`), übersprungen, wenn er fehlt.

## securesight-Factory (`@uacc/loop-securesight-factory`)

Ein Projekt = ein Loop (Projektwurzel = die gewählte Projektauswahl, sie braucht `scripts/betrieb.py`). Der Hub liest alle
`pollMs` (Standard 15 s) und **schreibt nichts**; der Supervisor darf nur lesen und eskalieren, `notify-ack` und Fortsetzen
macht die Person im Projekt.

| Quelle | im Hub |
|---|---|
| `betrieb.py supervisor-status --json` | `loop.info` (Betriebsart, Iteration, Watchdog), Prüfungen als Gate `gates`; Exit 3 = `loop.hold` (Status degraded), Exit 4 = Watchdog ausgefallen, 5/Schemafehler = `loop.broken` |
| `.harness/notify/*.json` | `loop.notify` (Stufe, Grund, Lauf) einmal je Datei |
| `.harness/transcript/*.ndjson` | `loop.transcript`, ab Start des Loops (keine Vorgeschichte), Schema 1 und 2, Cursor je Datei |
| `.harnez/progress.json` | `loop.progress` (Story, Aufgabe, Phase) |
| `~/.hermes/ralph/<epic>-state.json` | nur bei Orchestrator `hermes` (+ Option `epic`): `loop.progress` mit `source: hermes` |

Konfiguration: `python`, `pollMs`, `hermesDir`. Jede Quelle fällt einzeln aus: ihr Fehler wird `loop.broken`, die anderen laufen weiter.

## Oberfläche

Eine Loop-Session zeigt im Kopf das Abzeichen „Loop · Name · Betriebsart“ (rot bei Störung, gelb bei Halt oder Pause) und
darunter das Panel: Fortschritt, Gate, Halt (`loop.hold`), Störungen (`loop.broken`, bis `loop.recovered`), Eskalationen,
Statistik und Tagesbericht. Alles wird aus den `loop.*`-Ereignissen der Session gefaltet (`deriveLoopView`); was der Loop
nicht gemeldet hat, bleibt leer. Pause/Weiter und der Wechsel der Betriebsart gehen als Steuerbefehl an den Connector, eine
Betriebsart mit Außenwirkung wird vorher bestätigt. Fragen des Loops erscheinen in der Freigaben-Ansicht.

Bekannte Lücke: `loop.hold` löst noch keine Benachrichtigung aus (nur Ereignis und Abzeichen); sie ist AC-P19-2 und steht in T19.7.

