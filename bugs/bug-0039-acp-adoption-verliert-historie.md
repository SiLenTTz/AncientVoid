---
id: BUG-0039
slug: acp-adoption-verliert-historie
status: fixed
severity: S1
area: adapters
instance: prod
commit: "21610c1"
forge: ""
epic: "P5"
created: 2026-09-29
reporter: jan
---

# BUG-0039 — Übernommene ACP-Session zeigt keine Historie: ewiges „lädt…"

## Gesehen

Eine beobachtete opencode-Session (Entdecken → übernehmen) öffnet auf dem
Handy mit „lädt…" — dauerhaft. Der Chat bleibt leer, obwohl der Agent die
komplette Konversation per `session/load` meldet (Live-Fund 2026-09-29
10:21, Session `702391d5`, 1,18 MB Agenten-Ausgabe, 3 Events im Store,
Status `working` ohne laufenden Zug).

## Erwartet

Nach der Übernahme steht die geladene Historie im Tail; ohne Prompt geht
die Session in den Zustand zwischen Zügen (idle), nicht „working".

## Repro

1.native opencode-Session außerhalb des Hubs laufen lassen, bis die
Entdecken-Liste sie als beobachtete Zeile zeigt.
2. In der PWA übernehmen.
3. Session öffnen.

**Ergebnis nach Schritt 3:** „lädt…", keine Nachrichten; Status bleibt
`working`; `/api/sessions/<id>` meldet `lastSeq: 3`. **Häufigkeit:** immer
bei ACP-Übernahmen mit `loadSession`-fähigem Agenten.

## Eingrenzung

`packages/adapters/acp/src/index.ts` `resumeNative()`: Der BUG-0036-Fix
(25c5efe) klemmt beim `session/load` map+emit (`state.replay`) — korrekt
für Recovery (die Hub-Tail hat die Historie), aber die **Übernahme einer
beobachteten Session** läuft über `start()` mit `args.resumeSessionId`
(`session-manager.ts` Adoption, `adoptNativeSessionId`): Hier hat der Hub
die Historie *nicht*. Zusätzlich setzt der Manager nach `start()` pauschal
`working` — ohne Prompt läuft kein Zug, die PWA zeigt bei 0 Events +
`working` den Lade-Zustand (`SessionTail.tsx` empty-Branch).

## Fix-Richtung

Adoption reicht `importHistory: true` in den args; `resumeNative()` emit't
das Replay dann normal (K5 blobbing macht der EventStore). Adoption ohne
Prompt endet im Status `idle`. Recovery (BUG-0036) bleibt stumm.

## Tests

Ohne Fix rot müsste: ein Adapter-Test, der `start()` mit
`args: { resumeSessionId, importHistory: true }` ausführt und erwartet,
dass die geladenen Updates (thinking/tool/assistant) als Events ankommen;
plus ein Manager-Test, dass eine Adoption ohne Prompt auf `idle` fällt.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue (kein Forge-Eintrag; Solo-Fix über MR)
- [x] `bugfix`

## Behebung (2026-09-29)

**Root-cause:** wie Eingrenzung — Adoption und Reopen teilen sich
`args.resumeSessionId`; der BUG-0036-Fix macht jeden `session/load` stumm,
auch den der Adoption, deren Historie nur im Replay existiert.

**Fix (zwei Verhaltensänderungen):**
1. Adoption reicht `importHistory: true` (session-manager);
   `resumeNative()` emit't das Replay bei `emit=true` normal und flusht
   den Restpuffer — Recovery bleibt stumm (BUG-0036-Tests unverändert
   grün). K5: große Payloads blobbt der EventStore (ADR-P0-2).
2. Adoption ohne Prompt endet im Status `idle`, nicht `working` — die
   PWA zeigt sonst den Lade-Zustand für einen Zug, der nie lief.

**Tests:** Adapter-Test „BUG-0039: an adoption (importHistory) plays the
loaded history into the tail" (rot ohne Fix verifiziert) und Manager-Test
„passes importHistory along the native id and ends idle without a prompt".

**E2E-Verzicht, begründet:** Der E2E-Hub hat keine beobachteten
ACP-Agent-Fixtures — der Claude-Übernahme-Pfad ist dort abgedeckt
(discovery.spec, Transkript-Import); der ACP-Adoptionspfad ist über die
beiden Tests an der echten Naht (AdapterContext/SessionManager) belegt.
