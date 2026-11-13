# Wizard-Fehler lesen und beheben (`./setup.sh`)

**Art:** how-to

Der Wizard bricht laut ab und sagt den Grund in der letzten Zeile. Er ist
idempotent: nach dem Beheben einfach erneut ausführen. Die Exit-Codes selbst
stehen generiert in [`referenz-wizard.md`](referenz-wizard.md); diese Seite
sagt, was du dagegen tust. Hilft das nicht, kann ein Agent mit dem Skill
`setup-wizard` diagnostizieren.

| Exit | Typische Ursache | Was tun |
|---|---|---|
| 2 | Node fehlt oder ist zu alt; `npm` oder `git` fehlt; unbekannte Option oder Adapter; ungültige `baseUrl`/Modell-ID | Node 22.18+, 24 oder 26+ installieren; Meldung nach `FEHLT:`/`unbekannt` lesen; Eingabe korrigieren |
| 3 | `hub.config.json` ist kein gültiges JSON oder `dataDir` unlesbar | Datei mit `node -e 'require("./hub.config.json")'` prüfen; Komma/Klammer korrigieren. Die Datei wird nie überschrieben |
| 4 | Token konnte nicht ausgestellt oder der Hub nicht gestartet werden; `/api/ready` antwortet nicht | `scripts/hub.sh logs` lesen; `dataDir` beschreibbar? Dann `scripts/hub.sh start` |
| 5 | `npm install` fehlgeschlagen | Netzwerk/Registry prüfen, Meldung von npm lesen, erneut ausführen |
| 6 | Port 7373 gehört einem anderen Hub/Dienst | Anderen Port wählen: `./setup.sh --port=7474` bzw. `server.port` in der Config. Der Wizard hat nichts verändert |

## Hub neu starten, Status, Log

```bash
scripts/hub.sh status
scripts/hub.sh stop && scripts/hub.sh start
scripts/hub.sh logs
```

Nach einem Neustart kommen Sessions identisch zurück (K7). Als dauerhafter
Dienst (systemd), Updates und Sicherungen: [`operations-runbook.md`](operations-runbook.md),
[`backup-restore.md`](backup-restore.md).

## Hub läuft, aber die PWA lässt dich nicht rein

- **Token abgelehnt:** falsches/widerrufenes Token → neu ausstellen
  ([`howto-geraete-und-tokens.md`](howto-geraete-und-tokens.md)).
- **Hub nicht erreichbar vom Handy:** läuft Tailscale auf beiden Geräten und
  `scripts/setup-tailscale-serve.sh` einmal? `curl https://<host>.<tailnet>.ts.net/api/health`
  muss `ok` liefern.
