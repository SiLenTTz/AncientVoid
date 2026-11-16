---
id: BUG-0132
slug: setup-verwendet-fremden-hub
status: done
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

## Fix

- `setup.sh` prüft direkt nach der Config, **vor** Token und Start: Antwortet auf `host:port` irgendein Dienst, wird er nur übernommen, wenn die PID-Sperre des eigenen Datenverzeichnisses (`.ancientvoid-hub.pid`) auf einen lebenden Prozess zeigt, der laut `ss` genau auf diesem Port lauscht. Sonst Exit 6 („Konflikt … nicht nachweislich zu diesem Checkout“) — kein Token, kein Start, nichts gestoppt. Ohne `ss` gilt die Identität als unbelegt.
- Die systemd-Unit wird für den Standard-Port nur verwendet, wenn ihr `ANCIENTVOID_CONFIG` auf die Config dieses Checkouts zeigt; sonst ebenfalls Exit 6.
- `scripts/hub.sh` führt PID und Log je Checkout (`/tmp/ancientvoid-hub-<cksum des Pfads>.{pid,log}`); ein vor dem Umbau gestarteter Daemon dieses Checkouts wird anhand seines `ANCIENTVOID_CONFIG` übernommen. `status` fragt den konfigurierten Port ab. `scripts/messlauf-p6.mjs` liest den neuen Logpfad.

Tests (`scripts/setup.test.mjs`, echter Wizard und echter `hub.sh` mit Stub-Hub, der die echte PID-Sperre schreibt): zwei Checkouts auf zwei Ports starten je ihren eigenen Hub, der Wiederholungslauf übernimmt den eigenen; ein fremder Hub auf dem Zielport ergibt Exit 6 ohne `hub.db` und ohne Token-Marker. Ohne Fix beide rot (Exit 4 durch die geteilte PID-Datei bzw. Exit 0 mit fremdem Hub). Handprobe: die echte Unit des Haupt-Checkouts wird aus diesem Worktree als fremd erkannt.

## Tests / Handoff

AC: Bereits laufenden Hub nur nach belegter Identität von Checkout/Config/Datadir verwenden; sonst klarer Konflikt ohne Token- oder Dienständerung. Zwei isolierte Hubs auf verschiedenen Ports testen, eigene PID-/Logzuordnung vorsehen. K7, P53 AC-2/3; keine automatischen Stops fremder Prozesse.

- [x] Im Bug-Index erfasst.
- [x] GitLab-Tracker verlinkt.
- [x] Fix und Verifikation (Status oben; Gate-Beleg im [Audit](../docs/2026-11-11-setup-modelle-audit.md)).
