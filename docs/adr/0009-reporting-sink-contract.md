# ADR-0009 — Reporting-Sink-Contract (`onSessionComplete`)

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/reporting.ts`,
`packages/core/src/digest.ts`, `packages/core/src/sessionmanager.ts`, T4.1/T4.2
(`EPIC-P4-brain-windows-mcp-oss.md`)

## Kontext

EPIC-P4 §3 verlangt eine strikte Grenze: "Der OSS-Kern definiert einen
Reporting-Sink-Contract (Webhook/Plugin): `onSessionComplete(sessionSummary)
→ void`. Brain ist *ein* Konsument, kein Bestandteil." Der Hub-Kern darf also
wissen, *dass* eine abgeschlossene Session einen Digest bekommt, aber nicht,
*wohin* dieser Digest geht oder was der Empfänger damit tut — kein
Brain-spezifischer Code, kein Vault-Pfad, keine Neuronen-Struktur im OSS-Kern
(EPIC-P4 §3 "Keine Brain-Interna im Repo").

## Entscheidung

Neuer Contract in `@ancientvoid/contracts` (`packages/contracts/src/reporting.ts`):

```ts
export type ReportingSink = (summary: SessionSummary) => void | Promise<void>;
```

`SessionSummary` (zod-Schema) enthält:
- Session-Metadaten (id, adapter, project, Zeiten, costUsd, tokensEst).
- `lessons: DigestLesson[]` — jede mit `kind` (`decision`/`failure`/
  `budget`/`approval`), einem kurzen `text` und **`eventSeq: number[]`**
  (Quote-Grounding: welche echten Event-Sequenznummern diese Lesson
  belegen — EPIC-P4 §3 "jede Lesson zitiert Event-Sequenz-IDs").
- `archiveRef` — der relative Pfad zum rohen JSONL-Archiv
  (`sessions/<id>/events.jsonl`, `EventStore`s eigene Konvention), **nie**
  Volltext (EPIC-P4 §3 "Roharchiv-Verweis statt Volltext").

Extraktion (`packages/core/src/digest.ts`, `buildSessionSummary()`) ist
**regelbasiert, keine Zusammenfassung durch ein Sprachmodell** — dieses Repo
hat keine eingebaute LLM-Fähigkeit, und eine vorgetäuschte Zusammenfassung
wäre R9.7-Bruch. Stattdessen werden real bereits bedeutungstragende
Event-Typen/-Kinds extrahiert:
- `type: "gate"` → `kind: "decision"`
- `type: "error"` → `kind: "failure"`
- `system`-Events mit einem der real bereits von `SessionManager` selbst
  emittierten `payload.kind`-Werte: `session.approval_decided` →
  `approval`; `session.budget_exceeded`/`session.daily_cap_exceeded`/
  `session.budget_warning` → `budget`; `session.worktree_failed`/
  `session.start_failed`/`session.recovery_failed`/`adapter.down` →
  `failure`; `session.parked` → `decision`.

Aufruf: `SessionManager.stop()` ruft nach dem echten `"session.stopped"`-
Event `store.replay(sessionId)`, baut die Summary und ruft **jeden**
konfigurierten Sink fire-and-forget auf — ein werfender/ablehnender Sink
darf den Stop-Pfad nie beeinflussen (Isolationsgrenze, siehe Kontext). Ein
fehlschlagender Sink erzeugt ein `session.digest_sink_failed`-System-Event
(fail loud, AGENTS.md Regel 6), statt den Fehler stumm zu verschlucken.

Sinks werden dem `SessionManager`-Konstruktor als optionaler, letzter
Parameter `reportingSinks: ReportingSink[] = []` übergeben — additiv, exakt
das gleiche Muster wie `worktrees`/`approvals` (T2.1/T2.4): jeder bestehende
Aufrufer bleibt unverändert (leeres Array = keine Sinks = keine Digests,
exaktes Vor-T4.1-Verhalten).

Referenz-Sink (Webhook, T4.1 "Plugin-Skelett"): `examples/reporting-sinks/webhook/`
— **kein** Teil des OSS-Kerns, ein Beispiel wie `examples/adapters/openai-compat/`.
POSTet die `SessionSummary` als JSON an eine konfigurierte URL, kein Retry,
kein Vault-Wissen. Ein echter Brain-Sink lebt außerhalb dieses Repos.

## Konsequenzen

- Kein neues Netzwerk-Egress standardmäßig — `reportingSinks` ist per
  Default ein leeres Array, muss explizit in `hub.config.json` konfiguriert
  werden (gleiches "default aus" Prinzip wie das MCP-Gateway, OD-2).
- Digest-Qualität ist bewusst grob (regelbasiert, kein LLM) — dokumentiert
  als v1-Grenze, nicht als versteckte Einschränkung.
- `archiveRef` setzt voraus, dass der Sink-Konsument Zugriff auf denselben
  `dataDir` hat (oder die Datei separat einsammelt) — für einen entfernten
  Webhook-Sink ohne Dateisystemzugriff ist `archiveRef` nur ein Verweis,
  keine automatische Zustellung. Bewusst nicht gelöst — das würde den Sink
  zu einem Bestandteil des Kerns machen, statt eines Konsumenten.
