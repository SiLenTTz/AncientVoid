# ADR-0074 — Offene Arbeit und automatische Wiederaufnahme

**Status:** angenommen · **Datum:** 2026-11-13

## Kontext

BUG-0158/0155 und der Nutzerauftrag vom 13.11. verlangen verlässliche
Eingabeannahme, Aktivstatus für Hintergrundarbeit und Fortsetzung nach
unbeabsichtigten Unterbrechungen (K2/K7/K10). Der bestehende Heartbeat,
JSONL-EventStore und die serialisierten Session-Eingaben bleiben die Naht.

## Entscheidung

- `AdapterContext.activity()` meldet strukturierte Arbeitseinheiten mit
  stabiler ID, Art und Zustand; `interrupt()` meldet einen unabsichtlichen
  Transport-/Laufverlust. Beide SDK-Erweiterungen sind optional und additiv.
- `session.activity`-Events sind die Wahrheit über offene Arbeit, auch nach
  Neustart. Ein Zugende bei offenen Aktivitäten hält `working`; erst das
  letzte Ende erlaubt `idle`. Ausfälle erzeugen sichtbaren Klärungsbedarf.
- Externe Jobs können über eine authentifizierte Activity-Route und hubctl
  registriert werden. Ihre laufende Registrierung hat einen Heartbeat;
  eine abgelaufene Registrierung gilt als unklar, niemals als Erfolg.
- Keine `heartbeat.md`, keine zusätzliche Cron-Infrastruktur: der vorhandene
  Heartbeat prüft Provider, registrierte Arbeit und ausstehende Fortsetzungen.
- `promptDelivery: "next-turn"` verweist Adapter ohne native Live-Eingabe auf
  die persistente Hub-Queue. Ein Queue-Eintrag bleibt bis zum bestätigten Ack
  erhalten; seine ID ist zugleich die Eingabe-Idempotenz-ID. Ein vor dem
  Senden journalisierter Claim ohne bestätigtes Ergebnis wird nach Crash als
  unklar angezeigt und niemals automatisch ein zweites Mal gesendet.
- tmux-Handles zielen auf unveränderliche Pane-IDs, nicht auf wiederbenutzte
  Sessionnamen. Jede Worker-Generation hat eigene Log-/Offset-/FIFO-Dateien;
  `@ancientvoid_log` ermöglicht Adoption, der bisherige `.log`-Pfad bleibt
  als Latest-Symlink für Diagnose erhalten. Alte Worker ohne Marker nutzen
  weiterhin den bisherigen Recovery-Pfad. Verzögerte Exits/Signale können
  dadurch keinen Nachfolger beenden oder dessen Nachrichten konsumieren.
- Automatische Fortsetzung verwendet denselben Arbeitsort, dieselbe native
  Session und die Eingabeserialisierung. Adapter müssen native Fortsetzung
  ausdrücklich unterstützen. Ein fester Fortsetzungshinweis bittet um
  Prüfung bereits erledigter Schritte; es wird kein alter Schreibbefehl replayt.
- Nutzer-Stopp/Pause, Kontingente und nicht-technische Providerfehler werden
  nicht automatisch wiederholt. Erkannte Netzwerk-/Serverfehler können eine
  Fortsetzung auslösen. Rate-/Wochenlimits bleiben sichtbar. Ein fehlendes
  Native-Handle oder fehlgeschlagener Wiederanlauf bietet Abbruch/Übergabe an.
- Neue Interrupt-Ereignisse tragen die Wiederaufnahmeberechtigung. Alte
  unterbrochene Aufträge werden beim Aktivieren nicht ungefragt neu gestartet.
- Höchstens drei Wiederaufnahmen ohne erfolgreichen Zugabschluss. Der Zähler
  folgt aus dem Journal; Neustarts setzen ihn nicht zurück. Danach ist eine
  menschliche Entscheidung nötig. Ein ausdrücklicher neuer Auftrag setzt
  eine neue Grenze. Überlebende Provider werden erst adoptiert/abgeglichen;
  unklare externe Arbeit darf keinen zweiten Auftrag auslösen.
- Kein HTTP-Agent kann über die Resume-Route automatisches Resume erzwingen.
  Die Berechtigung bleibt intern; Activity-Meldungen starten keine Befehle.
- Health/Readiness melden optional `DeploymentIdentity` mit laufendem Hub-
  SHA (beim Start eingefroren), Checkout-SHA und PWA-Build-SHA. Vite schreibt
  dazu `version.json`; fehlende Git-/Build-Metadaten bleiben unbekannt. Die
  Statusseite zeigt einen abweichenden Stand, statt aus einem Merge ein
  erfolgreiches Deployment abzuleiten.

## Folgen und Nachweise

Tests müssen RPC-Ablehnungen, keine Wiederholung nach Nutzer-/Quota-Stopp,
Crash-/Heartbeat-Recovery, generationstreue Activity-Enden, K7-Replay,
Wiederanlauflimit sowie sichtbare Abbruch-/Übergabeaktionen abdecken.
Jeder neue UI-/HTTP-Ablauf erhält E2E-Abdeckung. Die bisherigen Adapter
bleiben ohne SDK-Nutzung lauffähig; Capability-Opt-ins brauchen Adaptertests.
