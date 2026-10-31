# ADR-0043: Factory-Integration — Treiber/Beobachter, Start-Flow, Steuer-Allowlist

**Status:** angenommen (2026-10-30) · **Epic:** [EPIC-P26](../../epics/EPIC-P26-factory-integration.md)
· **Schnittstelle:** [factory-schnittstelle](../factory-schnittstelle.md) v1

## Kontext

Ein Factory-Lauf im Projektmodus besteht aus zwei Rollen (EPIC-P26 §3.1):
dem **Treiber** — einer normalen Claude-Session im Projektverzeichnis, die den
projektlokalen Skill `/factory` ausführt (nur `claude`: maki führt Slash-
Commands im getriebenen Modus nicht aus, P25-Befund) — und dem **Beobachter** —
der Loop-Session `securesight-factory` im Modus `project`, die nur liest.
Heute kann der Hub (a) Projekte ohne `scripts/betrieb.py` nicht anbinden,
(b) keine der beiden Sessions koordiniert anlegen, (c) nicht steuern
(`control()` lehnt alles ab). Es fehlt: Start-Flow, Verknüpfung, Stop- und
Recovery-Semantik (K7) und eine menschen-exklusive Steuerung mit Audit.

## Entscheidung

### 1. Start-Flow: Alternative A — Core-Orchestrierung (T26.5)

`POST /api/factory/start` (Policy `factory.start`: Mensch erlaubt, Agent
abgelehnt — Muster `loops.start`, ADR-0038/P19) legt **beide** Sessions an:

1. Treiber: `SessionManager.create()` mit Adapter `claude`, `workdir` =
   Projektpfad, erster Prompt `/factory` ( нормaler Prompt-Weg, kein Sonderkanal).
2. Beobachter: Loop-Session `securesight-factory` (Modus `project`, erkennbar
   über `.factory/config.json`), `options.driver = <treiberSessionId>`.
3. Verknüpfung: auf **beiden** Sessions ein System-Event
   `payload.factory = { role: "driver"|"observer", partner: <id> }` und im
   Beobachter-`LoopStartSpec.options.driver` (im Loop-Snapshot persistiert).
   K7: nach Hub-Neustart sind beide Sessions aus JSONL+Snapshot wieder da;
   die Verknüpfung ergibt sich aus Snapshot (options) + Events (Anzeige).

Verworfen: **B** — der Connector startet den Treiber selbst via
`ctx.spawnWorker`: bricht die Kapselung „`packages/loops/*` importiert nur
`@ancientvoid/contracts`" und würde Adapter-Internas (SessionManager) in einen Loop
ziehen (verstößt gegen AC-P19-6). **C** — Nutzer legt beide Sessions von Hand
an: kein neuer Code, aber kein „sauber integriert" (Jans Kriterium) und keine
Verknüpfungs-/Stop-Garantien.

### 2. Stop-Semantik

„Lauf beenden" (Allowlist, unten) beendet **beide** Sessions in einer
Transaktion (Beobachter `stop()`, Treiber normal stoppen). Endet nur der
Treiber (natürlich oder Fehler), meldet der Beobachter „Treiber beendet" —
Statusabzeichen, **nicht** „fertig": der Connector prüft die Treiber-Session
über den Hub-Status (per `io`-Rückfrage ist tabu; stattdessen: Core markiert
dem Loop-Adapter den Treiber-Exit als Event auf der Beobachter-Session —
`payload.factory.driverEnd`). Kein automatischer Folgelauf.

### 3. Steuerung: feste Allowlist, nur Mensch (T26.6)

Neue Policy `factory.control` (human allow, fleet/agent deny). Befehle über
`POST /api/factory/:observerId/command` mit fester Allowlist, alles andere
wird **laut mit Grund** abgelehnt (4xx + Audit-Event mit Grund):

| Befehl | Wirkung | Bestätigung |
|---|---|---|
| `set_mode` | project: `factory init --reconfigure --modus a\|b` (execFile, Vertrag v1); repo: `betrieb.py mode` | ja bei `a` (auto_merge-Außenwirkung) |
| `continue` | neue Eingabe an die Treiber-Session (normaler Prompt-Weg) | nein |
| `notify_ack` | nur Modus `repo` (`betrieb.py notify-ack`, bestehender P19-Pfad) | nein |
| `end_run` | beide Sessions beenden (oben) | ja |

Jeder Befehl — auch jede Ablehnung — erzeugt ein Audit-Event
(`payload.factory.command = { kind, actor, ok, detail? }`) auf der
Beobachter-Session. Der Hub ruft nur dokumentierte Kommandos auf und schreibt
nie in Projektdateien.

### 4. Connector-Modi `repo`/`project` (T26.3)

Erkennung nach [Schnittstelle v1](../factory-schnittstelle.md): `repo` =
`scripts/betrieb.py` (Verhalten unverändert, 9 Testkit-Checks + 13
Paket-Tests bleiben grün); `project` = `.factory/config.json` ohne
`scripts/betrieb.py` — Quellen `factory progress show`,
`.factory/lauf-status.json`, Fehlerbelege, `.factory/intake/state.json`,
jede Quelle einzeln fallibel (⇒ `loop.broken` mit Grund). Contract-Änderung:
**keine** — `LoopConnector`/`LoopStartSpec` reichen (Modus ist
Implementationsdetail des Connectors; `capabilities().modes` bleibt leer, bis
die Factory Betriebsarten als Fähigkeit meldet).

### 5. Onboarding (T26.4)

`onboard()` (bestehender Contract-Baustein, ADR-0038) für
`securesight-factory`: Felder Projektpfad, optional PRD-Pfad, Modus (a|b),
Provider (anthropic|zai) ⇒ `factory init …` (execFile). Ergebnis =
Init-Checkliste (Zeilen der Factory, unverändert); „bereit" nur bei
gemeldtem `ready` (REQ-3001). Der Hub setzt weder Trust noch Berechtigungen.

## Konsequenzen

- Der Hub bekommt mit `/api/factory/*` eine zweite menschen-exklusive
  Ressourcenfamilie neben `loops.onboard` — gleiche Policy-Mechanik, kein
  neues Auth-Modell.
- `packages/loops/securesight-factory` bleibt auf `@ancientvoid/contracts`
  beschränkt; die Orchestrierung (zwei Sessions, Verknüpfung, Stop) liegt in
  Core/Server — Kapselung aus ADR-0038 bleibt intakt.
- Treiber-Exit muss dem Beobachter signalisiert werden (Core → Loop-Adapter →
  Event); damit bleibt „Treiber beendet" aus JSONL rekonstruierbar (K7).
- Harness-Wahl bleibt ausgeblendet, bis `factory capabilities --json`
  existiert (Schnittstellenwunsch 1, AC-P26-9) — kein Rateversuch.
- Tests: Policy-Test (Agent 403, auch kein Antrag), Recovery-Test
  (Hub-Neustart, beide Sessions + Verknüpfung < 3 s, AC-P26-6),
  Allowlist-Ablehnung laut, Audit-Event bei jedem Befehl.
