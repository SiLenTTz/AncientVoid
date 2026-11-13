---
id: BUG-0158
slug: codex-ablehnung-als-erfolg
status: done
severity: S2
area: adapters
instance: local
commit: "17d7c87"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/61"
epic: "Session-Robustheit (Issue #61)"
created: 2026-11-13
reporter: "Session-Audit im Nutzerauftrag (GitLab #61, Datei hier materialisiert)"
---

# BUG-0158 — Codex bestätigt abgelehnte Folgeeingaben als angenommen

## Gesehen

Bei einer RPC-Ablehnung von `turn/steer` lieferte der Adapter `{ ok: true }`
ohne Fehlerereignis; bei Ablehnung von `turn/start` gab es zwar
`provider.error`, der Steer-Aufrufer bekam aber ebenfalls Erfolg (Issue #61,
Session-Audit 13.11.2026).

## Erwartet

Nachweislich abgelehnte Eingaben erhalten ein negatives Ack samt sichtbarem
Grund; die Idempotenz-ID wird nicht als erfolgreich angenommen verbucht
(`commitSteer` läuft nur auf positivem Ack). Transport-Timeouts bleiben
„Ergebnis unbekannt" — keine blinden Retries.

## Root-cause

`packages/adapters/codex/src/app-server.ts`:
- `steer(prompt)` fing die `turn/steer`-Ablehnung mit leerem `catch` ab → `{ ok: true }`.
- `startTurn()` propagierte die `turn/start`-Ablehnung nicht; der Aufrufer
  ackte trotzdem Erfolg.

## Fix

- `startTurn()` liefert `null` (angenommen) oder den sichtbaren
  Ablehnungsgrund zurück; `steer(prompt)` baut daraus ein negatives Ack.
- `turn/steer` wird nicht mehr leer geschluckt: Ablehnung →
  `{ ok: false, detail }` mit der Meldung des Providers.
- `rejectDetail()` unterscheidet nachweisliche Ablehnung („abgelehnt — <msg>")
  von Transport-Timeout („Ergebnis unbekannt … nicht als angenommen
  verbucht"); STUMM/Warte-Semantik (T17.4) bleibt unberührt.
- Fake-codex (`e2e/support/bin/codex`): neues Keyword `ABLEHNEN` antwortet
  auf `turn/steer` und `turn/start` mit RPC-Fehler −32000
  „provider rejected input".

## Repro / Tests

`packages/adapters/codex/test/app-server.test.ts`:
- „a rejected turn/steer acks negative with the provider's reason"
- „a rejected turn/start acks negative and keeps the provider.error visible"

**Vor dem Fix deterministisch rot** (Stash-Wiederholung 13.11.2026: 2 failed),
danach grün (11/11 der Suite).

## Handoff

- [x] Fix + Regressionstests (MR folgt)
- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue [#61](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/61)
- [x] Hub-Integration Idempotenz/Queue-Erhalt und E2E der sichtbaren
  Ablehnung (Abschluss-MR Session-Robustheit): persistente Hub-Queue für
  Adapter ohne Live-Eingabe hält die Nachricht bis zum bestätigten Ack
  (`session-queue.test.ts`), E2E `session-robustheit.spec.ts` prüft die
  sichtbare Ablehnung samt Abbrechen, `harness.spec.ts` die
  Exactly-once-Zustellung nach Zugende
