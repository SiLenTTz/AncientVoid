---
id: BUG-0132
slug: setup-verwendet-fremden-hub
status: open
severity: S2
area: ops
instance: dev
commit: "9d97e19"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/53"
epic: "EPIC-P53"
created: 2026-11-11
reporter: "Codex — Setup-/Modellanbindungs-Audit"
---

# BUG-0132 — Wizard erklärt einen fremden Hub zum erfolgreichen eigenen Setup

## Gesehen

Ein erfolgreiches GET /api/ready reicht, damit Setup den Prozess am gewünschten Port übernimmt. Config und Tokens stammen jedoch aus dem aktuellen Checkout.

## Erwartet

AC: Bereits laufenden Hub nur nach belegter Identität von Checkout/Config/Datadir verwenden; sonst klarer Konflikt ohne Token- oder Dienständerung. Zwei isolierte Hubs auf verschiedenen Ports testen, eigene PID-/Logzuordnung vorsehen. K7, P53 AC-2/3; keine automatischen Stops fremder Prozesse.

## Repro und Umgebung

Shell-Probe im temporären Checkout mit existierender Config/Token-Marker: curl-Stand-in liefert immer exit 0, npm-Stand-in exit 0; `bash setup.sh --yes --adapter=dummy --no-pwa` endet 0 und meldet "läuft bereits ein Hub — verwende bestehenden". Kein echter Zweithub/PWA-Repro; Entscheidungszweig bestätigt. Produktionsdienst nicht angefasst.

Umgebung: isolierter Linux-Worktree, Node v26.7.0, keine produktiven Dienste geändert.
Häufigkeit: deterministisch im genannten Repro; reine Codebefunde sind ausdrücklich markiert.

## Logs

Ergebnis des Repros vom 11.11.2026 siehe oben; keine Tokens oder Schlüssel aufgezeichnet.

## Eingrenzung und Abgleich

`setup.sh` Schritt 5 prüft nur HTTP-Erfolg; Standard-Port kann zudem eine systemd-Unit eines anderen Checkouts starten. `scripts/hub.sh` verwendet für alle lokalen Daemons dieselbe /tmp-PID-/Logdatei. Kein Duplikat von BUG-0073: jener verhindert Doppelstart, dieser bindet den falschen Hub an.

## Tests / Handoff

AC: Bereits laufenden Hub nur nach belegter Identität von Checkout/Config/Datadir verwenden; sonst klarer Konflikt ohne Token- oder Dienständerung. Zwei isolierte Hubs auf verschiedenen Ports testen, eigene PID-/Logzuordnung vorsehen. K7, P53 AC-2/3; keine automatischen Stops fremder Prozesse.

- [x] Im Bug-Index erfasst.
- [x] GitLab-Tracker verlinkt.
- [ ] Fix und Verifikation (Status oben; Gate-Beleg im [Audit](../docs/2026-11-11-setup-modelle-audit.md)).
