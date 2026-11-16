# 05 — Agent teams: plan, dispatch, gates

**Ziel:** A team of agents as cards: DAG plan, model choice, gates and deliveries.
**Dauer:** ≤ 180 s · **Sprache:** EN · **Seed-Szenen:** Seeded team page, worker cards, gate question
**Playlist:** AncientVoid Features · **Endcard:** github.com/SiLenTTz/AncientVoid · Guide: docs/guide/README.md
**Status:** Skript fertig — Aufnahme/Publish sind Nutzeraufgaben (docs/demo-media.md, Video-Export-Checkliste).

## Shot-Liste

| # | Szene (Seed-Zustand) | Dauer | Overlay/Text |
|---|---|---|---|
| 1 | Demo-Hub Öffner (overview-01-Szene) | 6 s | „AncientVoid — agents in your pocket“ |
| 2 | Fokus-Flow der Feature-Story | ~100 s | Schrittnamen als Overlay |
| 3 | Ergebnis/Zustand nach der Aktion | ~20 s | einer Satz Ergebnis |
| 4 | Endcard | 6 s | Repo-URL + Guide-Link |

## Sprechtext (EN, ca. 182 Wörter)

> One agent is a conversation; a team is a plan. On the teams page you define work as a directed graph: each task has a prompt, an adapter, optionally a model from an allowlist you control, and dependencies that say what must finish first. Start the team and the detail view fills with one card per running worker. Cards show live status, so parallel work is observable at a glance, not guessed from logs. When a worker hits a gate, a question arrives in your approvals, you answer it, and the worker continues with your decision in context. Deliveries accumulate as they finish, and the run ends with a summary of what each worker produced. Only humans start, answer, or stop a team; agents propose, people decide. The same engine drives scheduled automations, which we cover separately. Wide teams are capped at eight parallel workers by default, because your machine is the limit that matters. Everything a team does is evented, so a restart resumes the plan instead of losing it. The repository and the full guide are linked on the endcard.

## Aufnahme-Hinweise

- Nur Demo-Seed-Daten (`npm run demo:seed`); nie den Alltagshub filmen.
- Vollbild, Do-not-disturb, eigenes Browser-Profil ohne echte Accounts.
- Untertitel: Englisch (stummes Autoplay); Thumbnail aus Guide-Screenshot.
