---
id: BUG-0036
slug: acp-recovery-replayed-historie
status: open
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

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen
