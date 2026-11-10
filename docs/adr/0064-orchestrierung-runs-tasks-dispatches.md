# ADR-0064 — Orchestrierung: Runs, Tasks und Dispatches mit Hermes als Koordinator-Harness

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/orchestration/`,
`packages/core/src/modules/orchestration/`, `apps/hub/src/modules/orchestration/`,
`apps/pwa/src/features/orchestration/`, EPIC-P40 (Umsetzung freigegeben durch Nutzer 10.11.2026; P39-Exit grün, MR !357)

## Kontext

P40 (Auftrag 10.11.2026): Hermes soll einen menschlich gestarteten Auftrag zerlegen und passende
AV-Sessions mit verschiedenen Harnesses steuern — Aufgaben, Versuche, Fragen und Ergebnisse in der
PWA nachvollziehbar. Bestand: `LoopConnector` (ADR-0038) reserviert `agents: hub` und gehört je Loop
einer Factory (securesight besitzt `orchestrators: self/hermes` nur für sich, P19/P26); der Hermes-Adapter
(P13) ist ein normaler Harness; Gateway/Policy (ADR-0004) erlaubt Agenten keine ungefragten Writes;
P38 gibt Sessions eigene Worktrees. Ein generisches Run/Task/Dispatch-Modell existiert im Hub nicht.

## Entscheidung

1. **Eigentümer: hub-eigenes Orchestrierungsmodul über Ports.** Das Epic verlangt Steuerung
   *beliebiger* Harnesses — kein LoopConnector. `core/modules/orchestration/` erhält als Ports
   `SessionPort` (create/steer/stop/get/events) und `Clock`, injiziert vom Hub mit dem echten
   SessionManager. Keine Adapter-Imports im Core; Loop-Fabriken bleiben unberührt (eine
   Lifecycle-Autorität pro Run: der Hub; Hermes ist Koordinator-*Harness*, nicht Autorität).
   Bestehende Factory-/Loop-Steuerung (P19/P26) wird nicht second-guessed: Runs dispatchen nur
   über `SessionManager.create` mit Adapter-Allowlist; `loop:*`-Adapter sind darin nicht enthalten.
2. **Datenmodell (Contracts `orchestration/`).** `Run` (Ziel/Rahmen/Eigentümer), `Task`
   (Spezifikation, Abhängigkeiten, Status), `Dispatch` (Versuch: Session-ID, Generation, Adapter),
   `Gate` (menschliche Frage mit Optionen), `Delivery` (Ergebnis-Zustellung mit Ack). Erfolgsnachricht
   trägt Task-ID + Dispatch-ID; ein Dispatch schließt nur ab, wenn er der **aktive** Versuch seines
   Tasks ist (stale-Verweigerung). DAG wird beim Start validiert (Zyklen/Fehlende → 422).
   Statusübergänge deterministisch in `engine.ts` (T40.2, Orca-Testvorlage umgesetzt auf AV).
3. **Koordinator = Hermes-Session, Plan als Daten.** Ein Run startet (optional, Default an) eine
   Koordinator-Session mit dem konfigurierten Koordinator-Adapter (Standard `hermes`; im Testkit
   ein deterministischer Fake). Deren Endergebnis muss einen **JSON-Taskplan** enthalten
   (`{"tasks":[{"title","prompt","adapter"?,"dependsOn":[]}]}`); der Hub validiert den Plan gegen
   den menschlichen Rahmen (Adapter-Allowlist, Tiefe 1, max Tasks/Dispatches/Parallelität) und
   legt Tasks an. Ohne Koordinator-Adapter oder mit `plan`-Übergabe beim Start entfällt die
   Plan-Session (menschlich gegliederter Auftrag ist gleichwertig). Fehlgeschlagene Planerkennung
   wird zu einer Gate-Frage, nie zu stillen Tasks.
4. **Befugnisse (§3.4).** Neue Policy-Operation `orchestration.manage` (human allow, alles andere
   deny): Run-Start, Cancel, Gate-Antworten. `orchestration.read` (human/agent allow) für
   Run/Task-Abfragen — der Koordinator-Worker liest seinen Run über die bestehende Session-API
   nicht; der Hub schiebt ihm Kontextpakete per steer. Agenten-Sessions eines Runs dürfen ihre
   eigene Arbeit erledigen, aber keine Gates beantworten, keine Workers spawnen (Tiefe 1 wird vom
   Hub erzwungen: nur der Run-Owner dispatcht) und keine fremden Sessions stoppen (Cancel stoppt
   nur Run-eigene Dispatch-Sessions). Kein Run-Grant-Objekt im MVP: Der Rahmen steht im Run-Datensatz
   und wird serverseitig bei jedem Dispatch geprüft.
5. **Ausführung.** Worker starten über `SessionPort.create` mit `workspaceMode: "worktree"` (P38,
   getrennte Worktrees; gleicher Basis-Branch erlaubt). Ergebnis eines Dispatch: Session erreicht
   `idle` nach ihrem ersten Zug → letzte Assistant-Nachricht (≤4 KB Metadaten, größere via Blob-Ref
   aus dem EventStore) wird als Delivery übernommen, Dispatch `done`, Task `done` (oder `failed`,
   wenn die Session `error` endet oder das Rahmenbudget aufgebraucht ist). Erneuter Versuch =
   neue Generation; altes `worker_done` einer früheren Generation wird verworfen (Invariante mit
   Test). Crash/Restart: Journal+Snapshot rekonstruieren Runs (K7 wie Reviews); Dispatches mit
   unbekanntem Ausgang werden `unknown` und blockieren automatische Retry — nur der Mensch
   entscheidet Retry über die Ansicht.
6. **Fragen.** `Gate` ist ein Run-Datensatz mit Frage, Grund (z. B. „Plan unlesbar“, „Adapter nicht
   freigegeben“, „Worker fragt“) und Antworten; die PWA zeigt sie zentral mit Stop. Hermes/Koordinator
   sehen Gates nicht als beantwortbar (nur `orchestration.manage`).
7. **UI.** Eigene ListPage `orchestrierung` (Slug `runs`) mit Dock-Item „Runs“: Liste der Runs,
   Run-Detail mit Task-/DAG-Liste (Status, Adapter, Modell, Versuch, Ergebnisquelle), offene Gates
   mit Antwortknöpfen, Stop. Offline zeigt letzten Stand mit Zeitstempel (K10). Popout wie jede
   Tool-Seite.
8. **Nicht Teil (bewusst).** Worker-spawn-Worker (Tiefe > 1), automatische Merge-Freigaben,
   freie Agenten-Shell, zweiter Koordinator neben einer Factory, Voidwarden-Integration,
   Cron/Automation (P41), Cross-Host-Dispatch (Fleet folgt später über Proxy-Allowlist).

## Alternativen

- **LoopConnector für Orchestrierung erweitern** — verdrahtet generelle Runs an eine Loop-Factory
  und deren Orchestrator-Semantik; falscher Eigentümer, abgelehnt.
- **Koordinator als Hub-Prozess mit eigenem LLM-Parsing** — der Hub würde Modellabhängigkeiten
  bekommen; Planerkennung gehört zum Koordinator-Harness (Hermes), der Hub validiert nur Daten.
- **EventStore als primäre Run-Wahrheit** — Runs sind Hub-Zustand, keine Session; Journal+Snapshot
  (Reviews-Muster) ist die etablierte K7-Form, SQLite nur optionale spätere Projektion.

## Folgen

- Ein Run mit N Tasks erzeugt bis zu N+1 Sessions (Koordinator + Worker) — Framework-Rahmen
  (maxDispatches, Parallelität) erzwingen Obergrenzen hostweit pro Run; K8 bleibt durch die
  bestehenden Session-Grenzen unberührt.
- Verspätete Antworten alter Generationen sind nutzlos, aber sichtbar (Journal behält sie).
- Hermes-Live-Qualität des Plans ist best effort: Fehlschlag = Gate, kein Fake-Plan.
