---
id: BUG-0036
slug: acp-recovery-replayed-historie
status: done
severity: S1
area: adapters
instance: dev
commit: "97e552c"
forge: ""
epic: "P7"
created: 2026-09-28
reporter: jan
---

# BUG-0036 — ACP-Recovery replayed die geladene Historie als neue Events

## Gesehen

Nach jedem Hub-(Neu)start wächst die betroffene Session um eine vollständige
Kopie ihres alten Zuges: thinking, tool_use, „The user rejected permission",
assistant, task-Abbrüche — alle Events eines Blocks in derselben Sekunde
(Session `6f03a88e`, Blöcke #77–89, #91–103, #105–117 … je Neustart heute;
a61453e3 auf #334, 821b0ec8 auf #721 gewachsen). Der Nutzer sah „eine
andere Session" — es waren Duplikate in derselben.

## Erwartet

`recover()` übernimmt/stellt die Session again und spielt NUR Neues in den
Stream — die Hub-Tail hat die Historie bereits (ADR-0014).

## Repro

1. opencode-ACP-Session mit Zug-Historie (native id vorhanden).
2. Hub neu starten (tmux-Worker weg, z. B. nach Reboot).
3. Tail ansehen.

**Ergebnis nach Schritt 3:** `session.recovered`, direkt danach die komplette
alte Zug-Sequenz als neue Events, alle mit dem Recover-Zeitstempel.

## Eingrenzung

`packages/adapters/acp/src/index.ts` `recover()`: ohne überlebenden Worker
wird `session/load` (bzw. `session/resume`) mit der native id gerufen. Der
Kommentar „replayed history is already in the hub's tail" nimmt an, opencode
sei beim Load still — opencode **re-notifiziert** die geladene Konversation
aber als `session/update` (live beobachtet: 13 Events in einer Sekunde,
identisch zum alten Zug). `UpdateMapper.map()` emittiert tool_call/
tool_call_update direkt, und jeder Tool-Rand flusht gepufferte thinking/
assistant-Texte — nur der finale `flush()` am Ende von recover() verwirft.

## Fix-Richtung

Während des `session/load`/`session/resume` in recover() emission klemmen
(`state.silent`): onNotification map+emit überspringen, danach Puffer
verwerfen. Nur echt neue Meldungen des Agenten kommen in den Stream.

## Tests

Ohne Fix rot müsste: ein Adapter-recover-Test, dessen Stand-in-Agent beim
`session/load` die alten Updates erneut notifiziert — erwartet KEINE
zweiten Events; danach ein neuer Prompt liefert normal.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue (kein Forge-Eintrag; Solo-Fix auf `feat/p12-backup-restore`)
- [x] `bugfix`

## Behebung (2026-09-29, Commit `25c5efe`)

**Root-cause:** wie Eingrenzung — opencode re-notifiziert die geladene
Konversation als `session/update`; `UpdateMapper` emittete direkt.

**Fix:** `state.replay` klemmt in `connect()`s `onNotification` map+emit,
solange `session/load`/`session/resume` läuft (`resumeNative()` setzt
das Flag, verwirft danach den Puffer). Adoptierte Worker sind nicht
betroffen. Ein Agent ohne load-Fähigkeit meldet weiter sichtbar
`acp.context_lost`.

**Tests:** `packages/adapters/acp/test/adapter.test.ts` — „BUG-0036:
recover() plays a loaded history back silently" und „a stopped run
continues in its loaded conversation … silent replay (BUG-0036)".

**Offen:** Die vor dem Fix entstandenen Duplikat-Blöcke in den
betroffenen Sessions (#77–117, #334, #721) bleiben im EventStore —
historische Daten, keine Nachbereinigung (K7: Append-Only).
