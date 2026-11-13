# ADR-0074 — Session-Aktivitätsregister: idle nur bei belegter Abwesenheit von Arbeit

**Status:** akzeptiert · **Betrifft:** BUG-0155 ([#62](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/62)), `packages/core/src/modules/sessions/session-manager.ts`, `packages/contracts` (additiv), Adapter (folge) · **Bezug:** PRD K7/K10, EPIC-P17/P27, Session-Audit 2026-11-13

## Kontext

Am 13.11.2026 meldete die P57-Session (`a257b3d1-…`) nach jeder Antwort `idle`,
obwohl Messlauf- und Diagnose-Jobs (`systemctl --user`-Units) weiterliefen.
Der Nutzer sah eine „steckengebliebene" Session; die Arbeit lief unsichtbar
weiter. Root cause: `adapterTurn("idle")` (`session-manager.ts:2616`) setzt
`idle`, sobald der Adapter das Zugende meldet — das Register `activeWorkers`
erfasst nur Zug-Prozesse über die Hub-Naht (`trackTurn`/`adoptWorker`).
Hintergrundarbeit, die der Agent selbst startet (Subagenten, systemd-Units,
Watcher), existiert für den Hub nicht. Beobachtetlive in
[`docs/messlauf/2026-11-13-ttfs.md`](../messlauf/2026-11-13-ttfs.md) §Funde
und Issue #62.

## Entscheidung

1. **Ein Aktivitätsregister je Live-Session** vereinheitlicht die
   Arbeits-Sicht. Aktivitätsquellen (additiv, jede mit stabilem Schlüssel):
   - `turn:<workerKey>` — Zug-Prozesse über die Hub-Naht (bestehende
     `activeWorkers`-Zählung geht darin auf),
   - `turn:persistent` — Zug-Marker adapter-persistenter Worker
     (bestehende `turn()`-Meldung),
   - `job:<uuid>` — **explizit registrierte externe Jobs** (Subagenten,
     systemd-Units, Watcher), mit `label` für Menschen.
2. **Idle nur bei leerem Register.** `adapterTurn("idle")` und die
   `trackTurn`-Settle-Phase prüfen das Register statt nur `activeWorkers`:
   Ist eine Aktivität offen, bleibt die Session `working` und der Hub
   emittiert `session.activity_pending` (siehe 3) statt `session.turn_end`.
   Erst die letzte beendete Aktivität löst `idle` + `turn_end` aus.
   „Bereit zwischen Aufträgen" eines Providers zählt **nicht** als Arbeit.
3. **Vertrag additiv:** neue System-Events `session.activity_begin`
   (`{ id, source, label }`) und `session.activity_end` (`{ id, code }`) sowie
   `session.activity_pending` beim verhinderten Idle-Übergang. Kein
   bestehendes Event ändert Bedeutung; alte Streams bleiben lesbar.
4. **K7-Recovery:** Öffentliche Aktivitäten stehen im JSONL (Events aus 3);
   nach Hub-Neustart rekonstruiert der SessionManager offene Aktivitäten aus
   dem Event-Rückrechnen (letztes `begin` ohne `end`, mit Altersgrenze und
   laufender Nummer, damit `end`s alter Generationen nicht streuen). Snapshots
   führen `openActivities` als projektionierte Kurzfassung.
5. **Zwei Registrierungs-Nahtstellen, keine Dritte:**
   - **Adapter-native Kenntnis:** Adapter, deren Harness Hintergrundarbeit
     kennt (z. B. opencode-ACP: Hintergrund-Shells), halten `turn("working")`
     offen bzw. registrieren über den erweiterten `AdapterContext`
     (`registerActivity(label)` → `{ id, end() }`, additiv zum Contract).
   - **Explizite Agent-Registrierung:** für Arbeit, die nur der Agent kennt
     (systemd-Units, Subagenten anderer Harnesses), eine lokale Naht:
     `hubctl session activity <id> begin --label …` / `end <activityId>` gegen
     die Hub-API. Auth: Device-Token (bestehende Rollen; Schreiben nur für
     `display:`/volle Device-Tokens, `agent:` bleibt lesend — PRD §8).
6. **Nicht-Ziele:** Kein Parsen von Assistant-Text als Steuerinformation
   (PRD §8.5 Prompt-Injektions-Grenze); keine Prozessbaum- oder
   systemd-Heuristik („fail loud", nicht raten); keine Änderung der
   Freigabe-/Fehler-Sicht (bleiben orthogonal sichtbar).

## Konsequenzen

- Sessions bleiben ehrlich `working`, solange zugehörige Arbeit läuft —
  das „stecken geblieben"-Erlebnis aus dem Audit wird sichtbar belegt.
- PWA/Statusanzeigen zeigen später das Register (Label je Aktivität) —
  UI-Arbeit folgt getrennt (nicht Teil dieses ADRs).
- Alte Adapter verhalten sich unverändert (Register leer → heutige Semantik).
- Implementierung in Stufen (jede für sich testbar und lieferbar):
  **T1** Register + Idle-Gate + Events + K7-Recovery + Tests (Kern, Contract
  additiv); **T2** `AdapterContext.registerActivity` + opencode-ACP-Anbindung
  (Hintergrund-Shells); **T3** Server-Route + `hubctl session activity`;
  **T4** PWA-Anzeige offener Aktivitäten. T1 ist Voraussetzung, T2–T4
  unabhängig danach.
- Tests (aus Issue #62): Hauptzug endet bei laufendem registriertem Job →
  Session bleibt `working`; letzter Job endet → `idle` + `turn_end`;
  Hub-Neustart während offener Aktivität → Register wiederaufgebaut;
  verspätetes `end` aus alter Generation → kein falsches Idle; Fehler und
  offene Freigaben bleiben sichtbar (orthogonal).

## Alternativen (verworfen)

- **Idle allein über Heartbeat des Adapters:** misst Provider-Bereitschaft,
  nicht Arbeit („bereit" ≠ beschäftigt) — genau das heutige Versagen.
- **Prozessgruppen-/systemd-Beobachtung durch den Hub:** Heuristik über
  Sessionsgrenzen hinweg, false positives bei fremden Units, widerspricht
  „fail loud" und der Adapter-Isolation.
- **Assistant-Text-Konvention („Ich starte jetzt…"):** Prompt-Injektions-
  Grenze PRD §8.5, nie Steuerinformation aus Agentenoutput.
