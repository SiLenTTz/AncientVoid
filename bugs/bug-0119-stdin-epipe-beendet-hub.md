---
id: BUG-0119
slug: stdin-epipe-beendet-hub
status: done
severity: S2
area: workers
instance: dev
commit: "80c8e66"
forge: ""
epic: "EPIC-P43 (Fund im Gate T43.3)"
created: 2026-11-11
reporter: "Claude"
---

# BUG-0119 — Ein gebrochenes stdin eines Workers beendet den ganzen Hub (EPIPE)

## Gesehen

Im Gate-Lauf zu T43.3 brach `packages/adapters/acp/test/adapter.test.ts` mit einem unbehandelten
`Error: write EPIPE` ab. Fünf Wiederholungen derselben Datei waren grün. Häufigkeit: manchmal.

## Erwartet

Schreibt der Hub an einen Worker, der seine Eingabe schon geschlossen hat (oder schon beendet ist),
bleibt der Hub stehen und der Fehler ist im stderr des Workers sichtbar.

## Repro

1. `ProcessRunner().spawn({ cmd: ["sh", "-c", "exec 0<&-; sleep 1"], … })`.
2. Nach 200 ms `write("x".repeat(1 << 20))`.

**Ergebnis nach Schritt 2:** `Unhandled 'error' event` auf dem stdin-Socket, der Prozess endet
mit Exit-Code 1. Im Hub träfe das jede Session mit `ProcessRunner` (Systeme ohne tmux, ACP-Adapter).
Schreiben nach dem Ende des Kinds verschwand dagegen still (`write` gibt `false` zurück).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | vitest (forks pool), Node 26.7 |
| Commit | `80c8e66` |
| Adapter | acp (über `ProcessRunner`) |
| Repro-Weg | Unit-Test |

## Logs

```text
Error: write EPIPE
Serialized Error: { errno: -32, code: 'EPIPE', syscall: 'write' }
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/workers/test/process.test.ts` | rot (unbehandelter EPIPE, stilles Verwerfen) |

## Eingrenzung

`packages/workers/src/process.ts`: `write: (data) => proc.stdin.write(data)` ohne `error`-Handler
auf `proc.stdin`.

## Fix

`proc.stdin` bekommt einen `error`-Handler, der den Grund als `stdin: …` an die stderr-Abonnenten
meldet; `write` an ein geschlossenes stdin meldet ebenso statt still zu verwerfen (AGENTS.md
„Fail loud“).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt — nicht angelegt, Fund und Fix im selben MR
- [x] `bugfix`
