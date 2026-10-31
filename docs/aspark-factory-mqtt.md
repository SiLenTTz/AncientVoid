# aSPARK-Factory über MQTT anbinden — Anleitung für den Hub-Nutzer

Ergänzt EPIC-P19 T19.4 / [ADR-0038](adr/0038-loop-dark-factory.md): Der
Hub verbindet sich als Leitstand-Client mit **einer Linie** der
aSPARK-Factory (MQTT, AsyncAPI 0.9.0). Die Linie läuft ohne den Hub weiter;
der Hub liest, beantwortet Fragen und sendet Befehle. K1 (Antwort-Latenz)
und K9 (sichtbarer Ausfall) werden gegen die laufende Linie gemessen.

## 1. MQTT-Nutzer auf dem Broker anlegen

Der Hub braucht einen eigenen, unprivilegierten Broker-Nutzer — kein Admin,
nur Rechte auf die Topics seiner Linie (`<line>` = Linienname, z. B.
`proto-line-1`):

```text
# mosquitto ACL (Bsp.) — Hub darf lesen und antworten, sonst nichts
user ancientvoid-hub
topic read         agent/<line>/#
topic write        agent/<line>/command
topic write        agent/<line>/+/answer
```

- **Lesen:** `agent/<line>/info`, `agent/<line>/+/state`,
  `agent/<line>/+/ask`, `agent/<line>/+/progress`, `agent/<line>/stats`,
  `agent/<line>/report` (Quelle: `packages/loops/aspark-factory/src/protocol.ts`
  `topics.subscriptions`).
- **Schreiben:** Antworten `agent/<line>/<session>/answer` (QoS 1) und
  Befehle `agent/<line>/command`.
- Das Last Will der *Linie* (`info` mit `status:"offline"`) veröffentlicht
  die Linie selbst — der Hub wertet es als `loop.broken` („Linie offline")
  aus und nimmt es bei `status:"online"` zurück.

## 2. Zugangsdaten — nie in die Hub-Config

`hub.config.json` erhält **kein Passwort**, sondern nur Verweise
(`packages/loops/aspark-factory/src/index.ts`):

```json
{
  "loops": [
    {
      "id": "aspark",
      "connector": "aspark-factory",
      "config": {
        "url": "mqtt://leitstand.example:1883",
        "username": "ancientvoid-hub",
        "passwordEnvFile": "/pfad/zur/factory.env",
        "passwordKey": "MQTT_LEITSTAND_PASSWORD"
      }
    }
  ]
}
```

- `url` (Default `mqtt://127.0.0.1:1883`), `username`,
  `passwordFile` (Datei enthält das Passwort direkt) **oder**
  `passwordEnvFile` + `passwordKey` (Default
  `MQTT_LEITSTAND_PASSWORD`) — derselbe Schlüssel, den auch `factoryctl`
  in `factory.env` liest.
- Verbindungsverhalten: 5 s Connect-Timeout, Wiederverbindung alle 2 s;
  Brokerverlust und kaputtes/`v≠1`-JSON melden `loop.broken`, kein stiller
  Ausfall (K9). Retained-Nachrichten nach dem Wiederverbinden dedupliziert
  der Cursor (K7, nichts doppelt).

## 3. Linie auswählen und starten

- Mit `factoryctl` (empfohlen): `"factoryctl": "…/factoryctl"` und
  `"factoryHome": "~/.aspark-factory"` in der Config — dann listet das
  Start-Formular die bekannten Linien samt Modus und bietet „Neues Repo
  anbinden …" (Onboarding übergibt das Token per stdin, es wird nie
  gespeichert oder geloggt).
- Ohne `factoryctl`: Linienname als Freitext im Start-Formular.

## 4. Vorab prüfen (ohne laufende Linie)

Die Connector-Tests laufen gegen einen echten Mosquitto auf einem
Zufallsport und überspringen sich sichtbar, wenn er fehlt:

```bash
mosquitto -h   # installiert?
npm -w @ancientvoid/loop-aspark-factory test
```

Berichte über 2 KB landen als Blob (K5); beantwortete Fragen und
Störungszustände überleben einen Hub-Neustart (K7, Cursor je Datei).
