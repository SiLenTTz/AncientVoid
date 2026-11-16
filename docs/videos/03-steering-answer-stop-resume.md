# 03 — Steering: answer, stop, resume

**Ziel:** Prompts reach the running agent; stop ends the turn; resume continues the same session.
**Dauer:** ≤ 180 s · **Sprache:** EN · **Seed-Szenen:** Running dummy session, composer answer, stop button, resume
**Playlist:** AncientVoid Features · **Endcard:** github.com/SiLenTTz/AncientVoid · Guide: docs/guide/README.md
**Status:** Skript fertig — Aufnahme/Publish sind Nutzeraufgaben (docs/demo-media.md, Video-Export-Checkliste).

## Shot-Liste

| # | Szene (Seed-Zustand) | Dauer | Overlay/Text |
|---|---|---|---|
| 1 | Demo-Hub Öffner (overview-01-Szene) | 6 s | „AncientVoid — agents in your pocket“ |
| 2 | Fokus-Flow der Feature-Story | ~100 s | Schrittnamen als Overlay |
| 3 | Ergebnis/Zustand nach der Aktion | ~20 s | einer Satz Ergebnis |
| 4 | Endcard | 6 s | Repo-URL + Guide-Link |

## Sprechtext (EN, ca. 188 Wörter)

> Steering means your words reach a running agent. Open a session and type into the composer at the bottom. Send, and the prompt is delivered to the exact process doing the work; no second instance is started, so a double-tap on send cannot fork your session. If the agent is mid-turn, your prompt waits for the turn boundary and then runs; the queue position is visible. Press stop when a turn goes sideways: the worker ends, the turn closes with a reason, and the chat says so. Later, press resume: AncientVoid rebuilds the conversation from its own event log and hands the agent the same native session, so context is not lost. If a resume is not supported by an adapter, the interface says exactly that instead of pretending. Every steer, stop, and resume is one event in the log, which is why the state survives restarts and why two devices never write against each other: a lease decides who drives, and the other screen sees the conflict. That is the whole loop: watch, answer, stop, continue. Links to the repository and the guide are on the endcard.

## Aufnahme-Hinweise

- Nur Demo-Seed-Daten (`npm run demo:seed`); nie den Alltagshub filmen.
- Vollbild, Do-not-disturb, eigenes Browser-Profil ohne echte Accounts.
- Untertitel: Englisch (stummes Autoplay); Thumbnail aus Guide-Screenshot.
