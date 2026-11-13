---
id: BUG-0156
slug: hub-stop-fremde-instanz
status: done
severity: S1
area: ops
instance: local
commit: "02fd546"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/64"
epic: "P27/P57, PRD K7"
created: 2026-11-13
reporter: "Session-Laufzeit-Audit"
---

# BUG-0156 — hub.sh steuert aus einem anderen Checkout die Produktiv-Unit

## Gesehen

Der P57-Messlauf stoppte am 13.11. die produktive Hub-Unit, obwohl ein
isolierter Mess-Hub gemeint war. Auslöser und Journal-Zeiten stehen im
[Audit](../docs/2026-11-13_session-laufzeit-audit.md). `hub.sh` bevorzugte
jede installierte `ancientvoid-hub.service`, unabhängig von Checkout oder
`ANCIENTVOID_CONFIG`. Laufende Nutzeraufträge wurden dadurch unterbrochen.

## Erwartet

Eine systemd-Unit darf nur bei nachgewiesener gleicher Checkout-/Config-
Identität angesprochen werden. Andere Test-Hubs brauchen `HUB_LOCAL=1`.
Nicht zuordenbare Instanzen werden abgelehnt, nicht geraten.

## Repro und Eingrenzung

Live-Inzident bestätigt, kein erneuter produktiver Stop zum Reproduzieren.
Deterministischer Repro in `scripts/hub-instance.test.mjs` mit vollständig
nachgebautem `systemctl`: aus fremdem Checkout bzw. mit anderer Konfiguration
wird vor dem Fix trotzdem `systemctl --user stop ancientvoid-hub.service`
aufgerufen. Beide Negativproben rot, Kontrollfall gleiche Instanz grün.

Ursache: `scripts/hub.sh:91`, Delegation ohne Instanzprüfung.
Fix: kanonischer Checkout und Standard-Konfiguration müssen zur Unit passen;
bei fehlender/fremder Identität Exit 1, kein Unit-Kommando. ADR-0074.

## Verifikation

Die Instanztests sind mit Fix grün, inzwischen sechs Modi über einen
nachgebauten `systemctl`: fremdes Checkout, fremde Konfiguration, per
Unit-Umgebung gesetzte fremde Konfiguration, unbekannte EnvironmentFile,
gleiche Instanz und gleiche Instanz mit individueller Unit-Konfiguration.
`systemctl`-Fehler beim Stop/Restart werden nicht mehr geschluckt.
Vollständiges Gate (Test/Lint/Typecheck/E2E) grün im Abschluss-MR;
Live-Deployment im selben Zug nachgezogen.
