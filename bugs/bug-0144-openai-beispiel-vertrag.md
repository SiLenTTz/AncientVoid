---
id: BUG-0144
slug: openai-beispiel-vertrag
status: done
severity: S3
area: adapters
instance: dev
commit: "5cddd68"
forge: ""
epic: "EPIC-P3 / EPIC-P35"
created: 2026-11-12
reporter: "Claude — beim Fix von BUG-0131"
---

# BUG-0144 — OpenAI-Beispieladapter besteht die Testkit-Vertragsprüfung nicht

## Gesehen

`runContractTests(createAdapter, …)` aus `@ancientvoid/adapter-testkit` gegen `examples/adapters/openai-compat/adapter.ts` auf main (`5cddd68`): zwei Prüfungen rot.

- „emits schema-valid events“: ohne Startprompt sendet `start()` kein einziges Event (`waitFor: timeout`).
- „stop(): clean shutdown“: `status()` meldet nach `stop()` weiter `healthy`.

Dazu fehlten `capabilities().features.modelSwitch`/`permissionModes` (Typfehler, unbemerkt, weil `examples/` vom Typecheck nur über Importe erfasst wird; in BUG-0131 mitbehoben).

## Erwartet

Laut AGENTS.md gilt: Testkit grün = hub-integrierbar. `setup.sh` registriert genau dieses Beispiel als `local-llm`.

## Fix

`start()` meldet `session ready (<baseUrl>)` als `system`-Event; `status(handle)` meldet `down`, sobald die Session gestoppt ist.

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| Vertrag | `apps/hub/test/examples/openai-compat-adapter.test.ts` (Testkit-Suite) | rot (2 Prüfungen) |
| Integration | `apps/hub/test/examples/openai-compat-adapter.integration.test.ts` — Beispiel geladen wie `setup.sh`, Session über `/api/sessions`, Folgeprompt über `/steer` | neu; deckt auch die Hub-Integration aus BUG-0131 ab |
