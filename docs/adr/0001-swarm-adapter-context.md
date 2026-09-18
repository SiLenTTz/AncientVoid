# ADR-0001 — Kontext für den künftigen `swarm`-Adapter (P3, T3.1)

**Status:** informativ (kein Contract-Change) · **Betrifft:** `epics/EPIC-P3-adapter-flotte-sprachsuche.md` T3.1

## Kontext

`EPIC-P3` sieht einen Adapter `swarm` vor, der an eine "eigene Event-API"
andockt — die Coding-Swarm-Feature des Schwesterprojekts `custom-rag`
(`app/backend/domain/coding/`, Pfad relativ zu `arbeitsbaeume/` auf dieser
Maschine). Diese Notiz hält fest, was von dort für den Adapter-Bau gebraucht
wird, damit T3.1 nicht bei Null anfängt und die aktuell offene Lücke
(Steer/Approval) nicht übersehen wird.

**Fragilität dieser Quelle:** Die Pfade unten gelten nur, solange
`custom-rag` als Geschwister-Checkout neben `mobile-hub` liegt. Bevor T3.1
umgesetzt wird, gegenprüfen, ob die Struktur noch existiert — Domain-Code in
Fremdrepos verschiebt sich.

## Architektur der Coding-Swarm (custom-rag-Seite)

Vierrollen-Pipeline **Planner → Coder → Reviewer/Gates → Tester**,
orchestriert über einen einzigen replaybaren Record `WorkItem`
(`app/backend/domain/coding/domain/schemas.py`), der die gesamte
Session-Historie trägt:

- `task` — Ziel, Repo, Task-Klasse, erlaubte Pfade, Acceptance Criteria
- `plan` — Schritte mit `files`/`estimated_lines`/`requirement_ids`, hart
  begrenzt auf ≤3 Dateien/≤150 Zeilen pro Schritt
- `edits` — Diffs/neue Dateien, mit `applied`-Flag
- `gate_results` — pro Gate: `passed`, `blocking`, `failure_class`
  (deterministic/infra), `issues[]`
- `review` — annotierend, **nie gatend**: `approved` ist eine Empfehlung,
  kein Kontrollfluss
- `ladder`/`budgets` — Eskalationsstufen 0–5, Wall-Time/Token/Cost/Datei-/
  Zeilen-Limits
- `approval_decisions` — menschliche HITL-Entscheidungen (Wer/Wann/Warum)
- `status` (`RunStatus`) — `pending`/`running`/**`awaiting_approval`**/
  `succeeded`/`failed`/`aborted`/`budget_exceeded`

## API-Oberfläche (`presentation/cockpit_routes.py`)

REST unter `POST /v2/swarm/runs`, plus u. a.: `list_runs`/`get_run` (Summary/
Detail mit `gate_ampel`-Liste), `get_events`/`stream_events` (strukturierter
Event-Log), `get_live_events`/`stream_live` (separater Kanal für rohe
Engine-Stdout-Zeilen), `get_artifacts` (Diffs, Test-Output, Rationale),
`start_run` (Body: `RunSubmission{allowlist_key, goal, origin, task_class,
auto_approve_level, dry_run, context_keys}` — **niemals ein Dateisystempfad
im Request**, nur ein `allowlist_key`), `decide_run`
(`RunDecision{action: approve|reject|override, reason, gate}`), `halt_run`,
`replan_run`, `post_chat_message`/`list_chat`, `get_trajectory`, `get_metrics`.

## Event-/Live-Bus-Format (`application/live_bus.py`)

Zwei getrennte Ströme:

1. **Strukturierter Event-Log** (`RunEvent{seq, kind, at, node, payload}`) —
   direkt vergleichbar mit UACCs `NormalizedEvent`.
2. **Live-Bus** (`RunLiveBus`) für rohe Engine-Ausgabezeilen: `seq` (monoton
   je Kanal), `kind` (`"live.line"`/`"live.done"`/`"gap"`), nie-blockierendes
   Publizieren mit **Drop-Oldest bei voller Queue** + explizitem
   `gap`-Marker statt stillem Verlust — konzeptionell fast identisch zu
   UACCs eigenem K5/K8-Anspruch ("nie blockieren", "Verlust sichtbar
   machen").

## Mapping-Hinweise für `@uacc/adapter-swarm`

- UACCs `EVENT_TYPES` (`user|assistant|thinking|tool_use|tool_result|gate|
  error|system`, `packages/contracts/src/event.ts`) enthält bereits
  **`"gate"`** als First-Class-Typ — die Contracts sind für diese
  Integration schon vorbereitet. Jedes `GateResult` (name, passed, blocking,
  issues) kann direkt zu einem `gate`-Event werden.
- `PlanStep`/`CodeChange`/`ReviewSummary` mappen auf
  `assistant`/`tool_use`/`tool_result`/`system`-Events; `thinking`-Events
  entstehen aus den Reasoning-Modellen im `planning`/`review`-Capability-Tier.
- `run_allowlist.yaml`-Muster (Client sendet nur einen `allowlist_key`, nie
  einen Pfad; Server löst gegen `roots` auf, Symlink-Escape wird verweigert)
  ist ein direkt übernehmenswertes **Sicherheitsmuster** für den
  `swarm`-Adapter — passt zu UACCs eigenem Anspruch "Freie Shell vom Handy:
  nein — nur registrierte Adapter-Operationen" (README "Sicherheit").
- `capabilities()` des künftigen Adapters lässt sich direkt ableiten:
  `{reasoning: true, tools: true, cost: true, steer: true}`.

## Offene Abhängigkeit: Steer/Approval-Lücke

UACCs `SteerInput` (`packages/contracts/src/adapter.ts`) kennt nur
`prompt|stop|park|resume` — es gibt **keinen** "approve/reject Gate X"-Steer-
Typ. Swarms `decide_run` (approve/reject/override mit Pflicht-`reason` bei
override) hat keine 1:1-Entsprechung im aktuellen Contract.

**Diese Lücke kann erst sauber geschlossen werden, wenn `EPIC-P2`
(Diff/Approvals/Budgets) eine Approval-Queue-Abstraktion bereitstellt**, an
die ein `blocking`-`GateResult` samt `ApprovalRequest` angehängt werden kann.
T3.1 ist damit nicht unabhängig von P2 umsetzbar — siehe Vermerk in
`EPIC-P3-adapter-flotte-sprachsuche.md`.

## Konsequenzen

- Kein Contract-Change durch dieses ADR — reine Wissenssicherung vor T3.1.
- T3.1 sollte erst begonnen werden, wenn P2s Approval-Queue-Contract steht,
  oder als zwei Teilschritte geplant werden: (1) Event-Mapping ohne
  Steer-Erweiterung, (2) Approval-Integration nach P2.
- Vor Umsetzung: Pfade in `custom-rag` erneut verifizieren (Fragilität oben).

## Nachtrag (2026-09-18): Pfade real gegengeprüft, echte Abweichungen gefunden

P2 ist jetzt grün (`EPIC-P2-diff-approvals-budgets.md`, T2.4/T2.5s
Approval-Service) — die oben genannte Blockade ist strukturell aufgelöst.
Vor dem eigentlichen Bau wurde `custom-rag` wie oben gefordert erneut
geprüft. Ergebnis: **die Fragilität hat sich bereits ausgewirkt**, die
Struktur ist real, aber an mehreren Stellen anders als hier notiert:

- `WorkItem`/`GateResult`/`RunStatus` liegen real in `domain/contracts.py`
  bzw. `domain/enums.py`, **nicht** in `domain/schemas.py` (diese Datei
  existiert, enthält aber nur generische Token-/Schema-Registry-Hilfen).
- `RunEvent{seq, kind, at, node, payload}` ist real, liegt aber in
  `presentation/cockpit_schemas.py`, nicht in `application/live_bus.py`.
- Der reale Router-Prefix ist `/v2/swarm` (`presentation/routes.py`), die
  Cockpit-Routen werden **programmatisch** registriert
  (`register_cockpit(router)` in `cockpit_routes.py`), nicht per
  `@router.get(...)`-Dekorator — u. a. deshalb liefert ein einfaches
  Dekorator-Grep keine Trefferliste.
- Die reale Freigabe-Route ist `POST /v2/swarm/runs/{run_id}/decisions`
  (Body `RunDecision{action: approve|reject|override, reason, gate}`,
  `override` erzwingt real eine nicht-leere `reason` per Pydantic-
  Validator) — **nicht** `/decide` wie oben vermerkt.
- `RunSubmission` ist real bestätigt:
  `{allowlist_key, goal, origin="cockpit", origin_ref, task_class=
  "scoped_bugfix", auto_approve_level="assisted", dry_run, context_keys[]}`
  — kein Dateisystempfad, wie oben beschrieben.
- Jede Cockpit-Route verlangt real `Depends(require_admin)` — der Adapter
  bräuchte ein **eigenes, separates Credential** für `custom-rag`s
  Admin-Auth, das UACC nicht besitzt und das hier nicht erfunden wird.
- **Real nicht auffindbar in der verfügbaren Zeit:** das konkrete
  Vokabular der `RunEvent.kind`-Werte (wie z. B. „plan_created" oder
  „edit_applied" tatsächlich heißen) — die Events werden aus einem
  internen Record-Format gelesen (`read_event_records`), dessen
  Konstruktionsstellen ein einfaches Grep nicht zuverlässig findet, und
  eine tiefere Analyse von `custom-rag`s eigener Codebasis sprengt den
  Rahmen dieser Session.

**Konsequenz für T3.1:** Ein Normalizer, der `RunEvent.kind`-Werte auf
UACCs `EVENT_TYPES` abbildet, ohne die echten Werte zu kennen, wäre
genau das geratene Mapping, das R9.7 ausschließt — eine falsche Zuordnung
würde reale Swarm-Events später still falsch kategorisieren. T3.1 bleibt
deshalb bewusst **nicht implementiert**, mit einem jetzt korrigierten,
realen Fahrplan für den nächsten Versuch: (1) `custom-rag`s
Event-Konstruktionsstellen gezielt aufsuchen (voraussichtlich in
`application/`, wo `read_event_records` seine Quelle liest) für das
echte `kind`-Vokabular, (2) ein Admin-Credential für die Cockpit-API
beschaffen/konfigurieren, (3) danach normalizer + adapter wie ursprünglich
geplant bauen. Kein Adapter-Code wurde für dieses Vokabular geraten.
