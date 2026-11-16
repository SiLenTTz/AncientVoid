---
id: BUG-0156
slug: hub-stop-fremde-instanz
status: done
severity: S1
area: ops
instance: local
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/64"
epic: "P27/P57, PRD K7, ADR-0074"
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
Deterministische Repros mit vollständig nachgebautem `systemctl`:
aus fremdem Checkout bzw. fremder Konfiguration wird vor dem Fix trotzdem
`systemctl --user stop ancientvoid-hub.service` aufgerufen. Negativproben
rot, Kontrollfall gleiche Instanz grün.

Ursache: Delegation ohne Instanzprüfung. Fix in zwei Stufen:
MR !451 prüfte `ANCIENTVOID_CONFIG` der Unit gegen `hub.config.json` des
eigenen Checkouts; der Abschluss-MR härtet ab (WorkingDirectory, Unit-
Umgebung inkl. individueller Konfigurationsnamen, EnvironmentFiles,
realpath-Normalisierung) und schluckt `systemctl`-Fehler nicht mehr.
ADR-0074.

## Verifikation

`scripts/hub-instance.test.mjs`: sechs Modi über einen nachgebauten
`systemctl` — fremdes Checkout, fremde Konfiguration, per Unit-Umgebung
gesetzte fremde Konfiguration, unbekannte EnvironmentFile, gleiche Instanz
und gleiche Instanz mit individueller Unit-Konfiguration; Steuerbefehle
werden nur im letzten Fall abgesetzt, `systemctl`-Fehler durchgereicht.
`apps/hub/test/hub-sh.test.ts` (aus !451) prüft dieselbe Weiche aus einem
Temp-Checkout mit PATH-Stub, jetzt gegen die strengere Identität —
hermetisch gegen geerbtes `ANCIENTVOID_CONFIG`. Vollständiges Gate
(Test/Lint/Typecheck/E2E) grün im Abschluss-MR der Session-Robustheit.
