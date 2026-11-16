# 04 — Approvals: answer from anywhere

**Ziel:** An agent asks, you decide on the phone — decisions are attributed and crash-safe.
**Dauer:** ≤ 180 s · **Sprache:** EN · **Seed-Szenen:** Seeded approval request, approval card, approve action
**Playlist:** AncientVoid Features · **Endcard:** github.com/SiLenTTz/AncientVoid · Guide: docs/guide/README.md
**Status:** Skript fertig — Aufnahme/Publish sind Nutzeraufgaben (docs/demo-media.md, Video-Export-Checkliste).

## Shot-Liste

| # | Szene (Seed-Zustand) | Dauer | Overlay/Text |
|---|---|---|---|
| 1 | Demo-Hub Öffner (overview-01-Szene) | 6 s | „AncientVoid — agents in your pocket“ |
| 2 | Fokus-Flow der Feature-Story | ~100 s | Schrittnamen als Overlay |
| 3 | Ergebnis/Zustand nach der Aktion | ~20 s | einer Satz Ergebnis |
| 4 | Endcard | 6 s | Repo-URL + Guide-Link |

## Sprechtext (EN, ca. 178 Wörter)

> Agents ask questions. AncientVoid makes sure you actually answer them, from wherever you are. When an agent needs a decision, a request lands in the approvals page and a notification reaches your devices. Open it and you see who asked, what it wants to do, and the exact input it plans to run. Approve, reject, or type an answer directly. The decision is attributed to the device that made it, so a week later you know which phone said yes. Pending approvals survive a hub crash: they are events, not variables, and after recovery each one runs exactly once. The same gate protects session starts requested by agents: an agent can propose, only a human starts. On the phone, the approval card sits on the start queue with command, estimate, and remaining time, so you can decide with one thumb while walking. If you reject, the agent sees the rejection and reacts; nothing is silently dropped. This is the pattern for everything here: risky actions are visible, attributed, and replay-safe. Repository and guide links follow on the endcard.

## Aufnahme-Hinweise

- Nur Demo-Seed-Daten (`npm run demo:seed`); nie den Alltagshub filmen.
- Vollbild, Do-not-disturb, eigenes Browser-Profil ohne echte Accounts.
- Untertitel: Englisch (stummes Autoplay); Thumbnail aus Guide-Screenshot.
