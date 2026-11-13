---
id: BUG-0156
slug: hub-stop-fremde-instanz
status: fixed
severity: S1
area: ops
instance: local
commit: "02fd546"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/64"
epic: "P27/P57, PRD K7"
created: 2026-11-13
reporter: "Session-Laufzeit-Audit (GitLab #64, Datei hier materialisiert)"
---

# BUG-0156 — hub.sh steuert aus einem anderen Checkout die Produktiv-Unit

## Gesehen

`scripts/hub.sh start|stop|status` leitet an `systemctl --user …
ancientvoid-hub.service` weiter, sobald irgendeine solche Unit existiert —
unabhängig davon, zu welchem Checkout sie gehört. Am 13.11.2026 stoppte der
P57-Messlauf aus einem temporären Klon heraus so die produktive Hub-Unit
(14 min Downtime, 15:17–15:31; Vorfall dokumentiert im
TTFS-Bericht [`docs/messlauf/2026-11-13-ttfs.md`](../docs/messlauf/2026-11-13-ttfs.md)
§Funde). GitLab-Issue [#64](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/64)
(Quelle dieses Texts; Audit-Bericht dort referenziert).

## Erwartet

Eine systemd-Unit wird nur bei **nachgewiesener gleicher
Checkout-/Config-Identität** angesprochen (Vergleich der Unit-Umgebung
`ANCIENTVOID_CONFIG` mit `$PWD/hub.config.json`, Muster aus `setup.sh`
`own_hub_pid`/`port_conflict`). Gehört die Unit einem anderen Checkout:
laut weigern (Exit ≠ 0) und `HUB_LOCAL=1` als Weg nennen — die Unit bleibt
unberührt.

## Repro

Voraussetzung: `ancientvoid-hub.service` installiert (Produktiv-Checkout),
zweiter Checkout (z. B. Messlauf-Klon) mit `scripts/hub.sh`.

1. Im zweiten Checkout: `bash scripts/hub.sh stop` (ohne `HUB_LOCAL=1`).
2. Beobachten: `systemctl --user stop ancientvoid-hub.service` läuft.

**Ergebnis nach Schritt 1:** Produktiv-Unit wird gestoppt; Skript-Exit 0.

**Häufigkeit:** immer, wenn eine Unit existiert und `HUB_LOCAL` nicht
gesetzt ist (deterministisch, `scripts/hub.sh` Case-Weiche vor `start/stop`).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (omarchy), Unit `ancientvoid-hub.service` aktiv |
| Commit | `02fd546` (Verhalten seit hub.sh-Unit-Weiche, P53-Umfeld) |
| Repro-Weg | bash (`scripts/hub.sh`) mit PATH-Stub für `systemctl` |

## Logs

Journal der Produktiv-Unit am 13.11.2026 (Vorfall):

```text
15:17:42 ttfs-messlauf-Skript ruft scripts/hub.sh stop im Klon auf
15:17:42 systemd: Stopping ancientvoid-hub.service …
15:31:08 systemd: Started ancientvoid-hub.service (manueller Neustart)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit (neu) | `apps/hub/test/hub-sh.test.ts` (systemctl-Stub) | rot: Fremd-Stop wird ausgeführt |

## Eingrenzung

`scripts/hub.sh`, Case-Weige vor `start|stop|status` (~Zeile 92–101): fehlender
Identitätsvergleich der Unit (`systemctl --user show -p Environment`) gegen
das eigene Checkout — `setup.sh` trägt das Muster bereits (`port_conflict`).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue [#64](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/64) (Quelle)
- [x] bugfix läuft (Branch `fix/bug-0156-hub-stop-fremde-instanz`)
