# Adapter-Contract — eigene Provider, Coding-Tools & lokale Coding-Systeme

Der Adapter-Contract ist die einzige Nahtstelle zwischen Hub und Fremdwelt.
Alles, was der Hub von einem Provider weiß, steht in
`packages/contracts/src/adapter.ts`.

## Die fünf Fragen eines Adapters

| Frage | Antwort im Contract |
|---|---|
| Was kannst du? | `capabilities()` → `{reasoning, tools, cost, steer}` |
| Wie startest du? | `start(spec, ctx) → handle` |
| Was passiert? | `ctx.emit(EmittedEvent)` — jederzeit, push-Modell |
| Wie steuert man? | `steer(handle, input, ctx) → Ack` (prompt/stop/park/resume) |
| Wie gesund bist du? | `status(handle) → HealthReport` |

Optional: `recover(sessionId, lastSeq, ctx)` — Reattach/Neustart nach
Hub-Crash (K7). Ohne `recover` gilt eine Session nach Crash als `error`
(sicher, aber nicht resilient).

## AdapterContext — das ganze SDK

| Mittel | Zweck | Regel |
|---|---|---|
| `ctx.sessionId` | Identität | für `handle.sessionId` nutzen |
| `ctx.emit(event)` | Events senden | Hub setzt `seq`/`ts`; `summary` ≤ 200 Zeichen |
| `ctx.blob(data)` | Großes auslagern | alles > ~2 KB gehört in den Blob (K5) |
| `ctx.spawnWorker(cmd)` | Prozess starten | **nie** selbst `child_process` — nur über den Runner (attachbar, reapbar) |
| `ctx.log(level, msg)` | Diagnose | geht in Hub-Log, nie in den Event-Stream |
| `ctx.signal` | Stop/Park | muss jeden laufenden Fetch/Stream sofort abbrechen |
| `ctx.workdir` | Arbeitsverzeichnis | Projekt bzw. (ab P2) Worktree |

## NormalizedEvent — die gemeinsame Sprache

Typen: `user | assistant | thinking | tool_use | tool_result | gate | error | system`.

- Provider-spezifische Events **müssen** gemappt werden; Unbekanntes →
  `system`-Event mit Hinweis (`adapter.degraded`-Muster), **niemals droppen**.
- Reasoning → `thinking` (komplett in Blob, Anker im Stream).
- Der Hub erzwingt K5 (Payload ≤ 4 KB) mechanisch — trotzdem bewusst emit-ten.

## Config-Validierung

Adapter-Config kommt aus `hub.config.json`. Validiere sie beim
Factory-Aufruf (zod o. ä.) und fail laut — der Hub surface-t den Fehler beim
Start und markiert den Adapter als nicht geladen.

## Testen (Pflicht vor Integration)

```bash
npm i @uacc/adapter-testkit
```

```ts
import { runContractTests, assertContractGreen } from "@uacc/adapter-testkit";
import { createAdapter } from "./adapter.ts";

const results = await runContractTests(createAdapter);
assertContractGreen(results);
```

Die Suite prüft: Identität, Capabilities, Handle-Lebenszyklus,
Event-Schema-Validität, Health, Stop, Recovery-Signatur. Grün = der Hub kann
deinen Adapter laden — ohne dass der Hub dich kennt.

> **Bekannte Lücke (BUG-0004):** `runContractTests()` kann aktuell keinen
> Adapter prüfen, der `ctx.spawnWorker` aufruft — sein interner Kontext
> wirft dort immer. Betrifft jeden echten (nicht-synthetischen) Adapter.
> Workaround, bis das behoben ist: eigene Lifecycle-Tests direkt auf
> `makeRecordingContext({ spawnWorker: ... })` — siehe
> `packages/adapter-claude/test/adapter.test.ts` oder
> `packages/adapter-codex/test/adapter.test.ts` als Vorlage.

## Fixtures aufzeichnen (T1.4)

Ein Adapter-Mapping wird gegen echte, aufgezeichnete CLI-Streams getestet,
nicht gegen geratene Feldnamen — beide bisherigen Adapter (`claude`,
`codex`) wurden so gebaut, und beide zeigten dabei Abweichungen von der
ursprünglich angenommenen Event-Struktur.

```bash
node scripts/capture-adapter-fixture.mjs \
  --out packages/adapter-<name>/test/fixtures/<fall>.jsonl \
  -- <cli-kommando mit JSON-Streaming-Flag>
```

Das Skript (siehe Kopfkommentar für Details):

1. führt das Kommando aus und fängt stdout ab,
2. anonymisiert Home-Verzeichnis und Socket-Pfade,
3. scannt das Ergebnis auf secret-ähnliche Strings und **verweigert das
   Schreiben**, falls etwas auffällt (Fund muss von Hand geprüft werden),
4. schreibt erst dann die Datei.

Ein sauberer Scan heißt „nichts hat auf ein bekanntes Secret-Muster
gepasst" — nicht „nichts Sensibles enthalten". Datei vor dem Commit lesen.

In Tests: `checkFixture(path, normalizeFn)` aus `@uacc/adapter-testkit`
lädt die Fixture, wendet den Normalizer auf jede Zeile an und prüft jedes
Ergebnis-Event gegen den `NormalizedEvent`-Contract (Schema, Summary-Länge)
— das ist der geteilte Teil dieses Musters. Die Mapping-Logik selbst bleibt
pro Adapter in dessen eigener `normalize.ts` (T1.1: mit nur zwei echten
Adaptern ist die tatsächliche Schnittmenge ~15 Zeilen generisches
String-Handling, keine eigene Bibliothek wert).

## Laden: drei Wege

1. **Lokale Datei/Ordner**: `"module": "./adapters/my-provider/adapter.ts"`
   (relativ zur Config-Datei).
2. **npm-Paket**: `"module": "uacc-adapter-foo"` — exportiere
   `createAdapter`.
3. **Fork/PR**: Adapter nach `packages/adapter-<id>/`, Registrierung als
   Built-in + Eintrag in der README-Status-Matrix (ehrlich: `unproven`, bis
   Fixtures + Contract-Tests grün sind).

## Anti-Patterns (Review-Blocker)

- Imports aus `@uacc/core` / `@uacc/server` oder direkter Dateisystem-Zugriff
  auf Hub-Daten.
- Eigenes `child_process.spawn` statt `ctx.spawnWorker`.
- Polling-Schleifen ohne `ctx.signal`-Abbruch.
- `capabilities()`, die mehr verspricht als der Code hält.
- Secrets in Events, Logs oder Config-Defaults.
