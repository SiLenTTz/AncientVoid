---
id: BUG-0004
slug: adapter-testkit-no-spawnworker-override
status: done
severity: S2
area: core
instance: dev
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/4"
epic: EPIC-P1
created: 2026-09-14
reporter: "Claude Sonnet 5 (Session 012Ga2NDi683xR9E63StoN7T)"
---

# BUG-0004 — `adapter-testkit`s `runContractTests()` kann keinen Adapter testen, der `ctx.spawnWorker` nutzt

## Gesehen

`docs/adapters.md` und `AGENTS.md` nennen `runContractTests()` aus
`@ancientvoid/adapter-testkit` als **die** Pflichtprüfung vor Hub-Integration
("Adapter bekommen die Suite aus `@ancientvoid/adapter-testkit` — grün =
hub-integrierbar"). Beim Bau von `@ancientvoid/adapter-claude` (T1.2, EPIC-P1)
zeigte sich: `runContractTests()` erzeugt seinen `AdapterContext` intern
fest über `makeRecordingContext()` ohne Override-Möglichkeit
(`packages/adapter-testkit/src/index.ts:107`), und dessen
`spawnWorker`-Default **wirft immer** (`packages/adapter-testkit/src/index.ts:39`:
`"testkit: spawnWorker not simulated — override for worker tests"`). Jeder
Adapter, dessen `start()` `ctx.spawnWorker(...)` aufruft — also **jeder
echte, nicht-synthetische Adapter** (`claude`, künftig `codex`,
`local-llm`, …) — scheitert damit schon am allerersten `start()`-Check der
Suite, bevor die eigentliche Adapter-Logik überhaupt geprüft wird.

`adapter-dummy` besteht die Suite nur, weil er nie `spawnWorker` aufruft
(reiner `setInterval`-Generator) — die Suite wurde also nie gegen einen
Adapter verifiziert, der die Kern-Regel "kein `child_process` direkt, nur
`ctx.spawnWorker`" tatsächlich befolgt.

## Erwartet

`runContractTests()` (oder eine Variante davon) sollte einen Weg bieten,
einen funktionierenden `spawnWorker`-Mock einzuspeisen, damit die Suite
auch Adapter prüfen kann, die real Prozesse starten — ohne dass jeder
Adapter seine eigene, parallele Lifecycle-Test-Infrastruktur nachbauen muss.

## Repro

```bash
# In packages/adapter-claude/test (oder jedem neuen Adapter mit spawnWorker):
node -e '
import("@ancientvoid/adapter-testkit").then(async ({ runContractTests }) => {
  import("../src/index.ts").then(async ({ createAdapter }) => {
    const results = await runContractTests(createAdapter);
    console.log(results.find(r => r.name.startsWith("start()")));
  });
});
'
```

**Ergebnis:** `start(): resolves to handle` schlägt fehl mit
`"testkit: spawnWorker not simulated — override for worker tests"` — für
JEDEN Adapter, der `spawnWorker` aufruft, unabhängig von dessen eigener
Korrektheit.

**Häufigkeit:** immer (kein Zufall, strukturelle Lücke).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal, reiner Unit-Test |
| Commit | Stand `main` nach P0-Retro (`fbb1844`) |
| Betroffene Datei | `packages/adapter-testkit/src/index.ts:39,78-156` |

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapter-testkit` hat keinen Test, der `runContractTests()` gegen einen `spawnWorker`-nutzenden Adapter fährt | Lücke besteht seit T0.6 (nie mit einem echten Adapter geprüft, weil es bis T1.2 keinen gab) |

`packages/adapter-claude/test/adapter.test.ts` umgeht die Lücke: eigene
Lifecycle-Tests direkt auf `makeRecordingContext({ spawnWorker: ... })`
(das Feld selbst **ist** überschreibbar — nur `runContractTests()`
nutzt diese Möglichkeit nicht).

## Eingrenzung

`packages/adapter-testkit/src/index.ts:78` (`runContractTests`) — Zeile 107
`const ctx = makeRecordingContext();` ohne Parameter. `ContractTestOptions`
(Zeile 65-72) hat kein Feld für einen `AdapterContext`-Override.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` — P5 T5.6: `ContractTestOptions.spawnWorker`. Default wirft
      weiter (Fail loud). Beweis: `packages/adapter-testkit/test/spawn-override.test.ts`.

**Update (T1.3):** wie vorhergesagt betroffen — `adapter-codex` musste
dieselbe Umgehung bauen (`packages/adapter-codex/test/adapter.test.ts`,
eigene `makeRecordingContext({ spawnWorker: ... })`-Lifecycle-Tests statt
`runContractTests()`). Zwei von zwei bisherigen echten Adaptern betroffen —
sollte vor T3.x (`swarm`/weitere Adapter, P3) behoben werden, sonst
wiederholt sich die Umgehung ein drittes Mal.
