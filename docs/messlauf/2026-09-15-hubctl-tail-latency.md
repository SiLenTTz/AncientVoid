# Messlauf — hubctl tail Ende-zu-Ende-Latenz (AI-P0-3, AC-P0-5)

**Messlatte:** AC-P0-5 — "`hubctl tail <session>` zeigt Events mit
< 500 ms Ende-zu-Ende-Latenz."

## Prüfstand

| Feld | Wert |
|---|---|
| Datum | 2026-09-15 |
| Commit | dieser Commit (siehe `git log` dieser Datei — Skript und Fix landen im selben Commit wie dieser Bericht) |
| Maschine | Omarchy, Linux 7.1.9-arch1-2, x86_64, 16 Kerne |
| Node-Version | v26.7.0 |
| Messwerkzeug | `scripts/messlauf-hubctl-latency.mjs` |
| Modell/Adapter | `dummy` (kein LLM — K-Nummer ist transport-, nicht modellbezogen) |

## Kommando

```bash
node scripts/messlauf-hubctl-latency.mjs --events 20 --rate 5
```

Echter Aufbau, kein In-Process-Shortcut: `createHubApp()` bindet einen
echten HTTP/WS-Socket auf `127.0.0.1`, `hubctl` läuft als eigener
Kindprozess und verbindet sich über die reale WebSocket-Strecke (`tail -f`).
Latenz = Zeit zwischen dem serverseitigen `sessions.subscribe()`-Callback
(Event geht an Abonnenten raus) und dem Erscheinen der passenden Zeile in
`hubctl`s eigenem stdout.

## Rohzahlen (3 Wiederholungen, je 20 Dummy-Events @ 5 ev/s)

| Lauf | n gematcht | min | median | p95 | max |
|---|---|---|---|---|---|
| 1 | 21 | 0.2 ms | 0.4 ms | 0.7 ms | 0.8 ms |
| 2 | 21 | 0.3 ms | 0.4 ms | 0.7 ms | 1.0 ms |
| 3 | 21 | 0.3 ms | 0.4 ms | 0.6 ms | 0.6 ms |

Lauf 1, volle Rohreihe (ms): 0.2, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 0.4,
0.4, 0.4, 0.4, 0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.7, 0.7, 0.8

**Ergebnis: AC-P0-5 erfüllt** — max. beobachtete Latenz 1.0 ms, drei
Größenordnungen unter der 500-ms-Grenze. Kein Ausreißer über allen drei
Läufen hinweg.

## Was das nicht sagt

- Gemessen auf `127.0.0.1` (Loopback) — **keine** Aussage über
  Tailscale-WAN-Latenz zwischen Handy und Hub (siehe AC-P0-3, AI-P0-2,
  noch offen). Die 500-ms-Grenze aus AC-P0-5 dürfte für den realen
  Tailscale-Pfad relevanter sein als für Loopback, wo sie nie in Gefahr ist.
- Gemessen mit dem `dummy`-Adapter (synthetisch, kein echtes CLI-Spawning
  im kritischen Pfad). Für `claude`/`codex` (P1) ist die Adapter-eigene
  Verarbeitungszeit (JSON-Parsing, Normalisierung) nicht Teil dieser Zahl.
- Kleine Stichprobe (21 Events/Lauf) und keine Last durch andere Sessions
  parallel — keine Aussage über Latenz unter K8-artiger Last
  (20 Sessions × 30 ev/s).
- `n=21` statt der erwarteten ~23 (2 Lifecycle-Events + 20 Dummy-Events +
  1 Auto-Stop-Event): die feste Wartezeit im Skript beendet die Messung,
  bevor jede letzte Zeile zwingend durch ist — für eine Latenzverteilung
  unerheblich, aber notiert statt verschwiegen.

## Nebenfund

Der erste Versuch, diesen Messlauf zu fahren, scheiterte nicht an der
Latenz, sondern daran, dass `hubctl tail -f` sich überhaupt nicht per
WebSocket verbinden konnte (`TypeError: Invalid URL`) — siehe
[BUG-0005](../../bugs/bug-0005-hubctl-tail-invalid-ws-url.md). Ohne den
echten Transport zu messen (statt eines In-Process-Shortcuts) wäre das
nicht aufgefallen.
