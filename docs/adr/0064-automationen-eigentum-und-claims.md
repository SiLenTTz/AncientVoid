# ADR-0064 — Automationen: Eigentum, Claims und Zeitplan-Herkunft

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/automations/`, `packages/contracts/src/approvals/policy.ts`,
`packages/core/src/modules/automations/`, `apps/hub/src/modules/automations/`, `apps/pwa/src/features/automations/`,
EPIC-P41 (Auftrag 12.11.2026; Planung entgegengenommen, Gating-Konflikt zu P40 vom Auftraggeber bewusst genommen)

## Kontext

Der Nutzer will wiederkehrende Abläufe vom Handy aktivieren: feste Termine pro Host,
Ausführung durch vorhandene Engine. Bestandsabgleich (T41.1) — was es schon gibt und
was die Automation **nicht** ist:

- **SessionManager/WorkerRunner** besitzen jede Ausführung; `LoopConnector`
  (`agents: "hub"` reserviert) verbindet externe Loop-Systeme — die Eigentümerfrage
 _loop_ trifft P40/T40.1; dieses ADR entscheidet sie nicht doppelt.
- **Codes-Modul** (`ActionDefinition`/`actionArgv`) besitzt registrierte argv-Aktionen —
  Prechecks verweisen nur auf deren IDs, niemals auf freie Shell.
- **EventStore + Blob-Store** sind der Journal-/Blob-Pfad (K5/K7); SettingsStore (SQLite)
  ist Konfiguration, kein Ausführungs-Journal.
- **P40** liefert Run/Task/Dispatch erst noch; der Ziel-Vertrag erlaubt daher beides:
  vorhandenem Session-Start oder Run-Vorlage, ohne zweiten Coordinator.

## Entscheidung

1. **Ein Eigentümer pro Rolle.** Das neue Modul `automations` besitzt Termin, Generation,
   Claim, History und den genehmigten Rahmen. Die Ausführung gehört Session-/Run-Manager:
   `dispatched` ist ein Startauftrag, nie ein Erfolg; das Ergebnis wird aus der referenzierten
   Ausführung gespiegelt (Premortem 3). Kein zweiter Scheduler neben dem Host, kein zweiter
   Coordinator neben einer Factory.
2. **Herkunft: kleine eigene Implementierung.** Der begrenzte 5-Feld-Cron (Zahlen, Bereiche,
   Schritte, Listen, `*`; So=0; keine Namen/`L`/`W`/`#`) und die DST-Rules werden selbst
   implementiert (strip-TS, kein natives Modul, kein neues Dependency); die Orca-Referenz
   (Commit `bdeb388`) dient nur als Testvorlage. Die DST-Hälfte wird bis T41.2 gegen eine
   kleine geprüfte Bibliothek verifiziert, falls die eigene Implementierung unmöglich bleibt.
3. **DST und Verpassen:** ungültige Lokalzeit (Frühjahrswechsel) wird übersprungen — Grund
   `dst_invalid`; doppelte Lokalzeit (Herbst) feuert genau einmal. Verpasste Termine werden
   höchstens einmal nachgeholt und nur binnen `grant.missedGraceMs` (0 = nie); ein Hub-Neustart
   feuert nie blind — erster Schritt nach Recovery ist Statusprüfung, dann Claim.
4. **Claim = Dedupe, atomar im Journal.** Schlüssel = `definitionsId:Generation:OccurrenceUtc`
   (`automationClaimKey`), ein Claim pro Schlüssel; Wiederaufnahme über Journal/Snapshot (K7).
   Getrennte Skip-Gründe bleiben getrennt (`dst_invalid|missed|overlap|lease|precheck|
   precheck_exit|precheck_timeout|auth|quota|host_down`); Überschneitung respektiert den
   P38-Lease des direct-Checkouts (Grund `lease`).
5. **Feste Eigentümer-Host.** Jede Definition gehört einem Host (`hostId`); Failover auf einen
   anderen Host ist nicht im MVP. Fleet zeigt und steuert, plant aber nicht selbst.
6. **Policy und K1:** neue Operationen `automations.manage` (Definition/Aktivierung/
   Deaktivierung/Generation) und `automations.runNow` (eigene Operation, §3.3): Mensch und
   Fleet-Handy erlauben, Agent/Brise/Companion/Display deny. Neue Definitionen beginnen
   deaktiviert; Aktivierung ist die Freigabe des gerahmten Auto-Modus. Neue oder geänderte
   Befugnisse invalidieren die bisherige Freigabe (Generation++ — Zähler im Journal,
   nie nachträglich heraufgesetzt).
7. **K5:** Prompt und große Ausgaben als Blob, Definition/Claim-Zeilen ≤ 4 KB
   (Prompt nur als Blob-Verweis in der Definition).

## Alternativen

- **Cron-Bibliothek (z. B. cron-parser)** — verworfen: zusätzliche Abhängigkeit für ein
  begrenztes Subset; entschieden ist die kleine eigene Implementierung, Orca nur als Testvorlage.
- **Eigene Execution-Engine** — zweiter Coordinator neben Session-/Run-Manager und P40, gegen B11.
- **Fleet-zentraler Scheduler mit Failover** — bräuchte ein Failover-Journal über Hosts; nicht im MVP.

## Folgen

- `packages/contracts/src/automations/` ist öffentlicher API; Änderungen brauchen ADR-Fortsetzung.
- Die Policy-Tabelle wächst um zwei Operationen; das Invariant-Test-Gitter (agent nie allow
  auf Writes) greift automatisch.
- Hub braucht Scheduler-Uhr + Journal (folgt im Epic in T41.2-T41.5).
