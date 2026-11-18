---
id: BUG-0209
slug: session-bleibt-working-nach-abschluss
status: done
severity: S2
area: core
instance: local
commit: ""
forge: ""
epic: "ADR-0074 + ADR-0076, PRD K7"
created: 2026-11-18
reporter: "Nutzerfund: Qwen-Session hing 9 h auf „arbeitet“, obwohl Aufgabe gemerged"
---

# BUG-0209 — Session bleibt „working“, obwohl der Zug längst fertig ist

## Gesehen

Zwei Sessions standen über Nacht auf `working`, ohne dass etwas lief:

- `98fb6e69` (pi, Qwen3.8): ~9 h, bis zum manuellen Stop um 08:20.
- `976960bb` (opencode/ACP): seit 2026-11-17 21:28 auf `working`.

## Erwartet

Ein beendeter Zug ohne echte Hintergrundarbeit führt zu `idle`; ein beim
Hub-Neustart abgeschnittener Zug zu `interrupted` (K7).

## Repro (aus den Journalen, `data/sessions/<id>/events.jsonl`)

**pi `98fb6e69`:** Die Session ließ per `systemctl --user restart ancientvoid-hub`
den Hub neu starten, der sie selbst trägt (22:31:59). Danach nur
`session.recovered {controllable: true}` — kein `wasWorking`, kein
`session.interrupted`. Der Status blieb `working`.

**ACP `976960bb`:** Zwei Provider-Aktivitäten `tool:call_…` (21:02) bekamen nie
`activity_end`. Beim Hauptzugende (21:28:25) schrieb der Hub `activity_pending`
statt `idle`; der Hub-Restart (22:32) änderte daran nichts.

**Häufigkeit:** zweimal in einer Nacht; Variante A bei jedem Hub-Restart während
eines pi-Zugs, Variante B bei jedem Werkzeugaufruf ohne terminales Update.

## Eingrenzung

- A) `packages/adapters/pi/src/index.ts` `recover()` rief `ctx.adoptWorker()` nie
  auf. Der Hub unterbricht einen offenen Zug nur bei `session.adopted === false`
  (`session-manager.ts` recoverAll); pi lieferte ein Handle und `adopted` blieb
  `undefined`. Alle anderen Adapter mit `recover()` fragen den Hub.
- B) `adapterTurn("idle")` hielt jede offene Provider-Aktivität für Arbeit
  (ADR-0074). Für Subagenten richtig, für Werkzeugaufrufe nicht: sie gehören zu
  einem Zug. Recovery faltete sie aus dem JSONL zurück und ließ sie offen.

## Fix

- pi: `recover()` fragt `adoptWorker()` und hängt einen überlebenden Worker an.
- core: `dropOrphanedTools` schließt `tool:`-Provider-Aktivitäten beim Hauptzugende
  und in der Recovery (Journal `session.activity_end` mit `orphaned: true`);
  Recovery setzt danach `idle` + `turn_end`. Subagenten und externe Jobs bleiben.

## Tests

| Ring | Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/modules/sessions/activity-register.test.ts` (3 neue: Werkzeug bei Zugende, Subagent bleibt, Recovery) | rot (2 von 3, Subagent-Test ist Schutz) |
| Unit | `packages/adapters/pi/test/adoption.test.ts` (recover fragt Hub) | rot |

## Offen

Bereits hängende Sessions (z. B. `976960bb`) werden beim nächsten Hub-Restart
durch den Recovery-Pfad bereinigt; bis dahin hilft Stop oder Weiterführen.
