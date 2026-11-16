# 07 — Discovery: take over stray sessions

**Ziel:** Sessions started in a terminal appear in AncientVoid — preview, take over, or copy.
**Dauer:** ≤ 180 s · **Sprache:** EN · **Seed-Szenen:** Discovery tab with seeded found sessions, takeover
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

> Agents do not always start inside AncientVoid. You fire up a CLI in a terminal, and an hour later it matters. Open the discovery tab and AncientVoid lists sessions it found on disk: claude, codex, opencode, pi, and friends, each with a preview of the transcript and a hint whether it is currently running elsewhere. Take over: the session becomes a first-class citizen, streamable and steerable, without the agent losing its context. If you would rather not touch the original, take a copy and let the terminal keep its own. Sessions that run on another host are marked, so you never accidentally attach to the same worker twice. When an adapter cannot safely resume a foreign session, the interface says so and offers what it can do instead; unknown is never presented as working. Discovery is read-only until you choose: nothing on your disk changes just by looking. This is the bridge between your terminal habits and the hub, and it closes the biggest gap a monitoring tool can have. Repository and guide are linked on the endcard.

## Aufnahme-Hinweise

- Nur Demo-Seed-Daten (`npm run demo:seed`); nie den Alltagshub filmen.
- Vollbild, Do-not-disturb, eigenes Browser-Profil ohne echte Accounts.
- Untertitel: Englisch (stummes Autoplay); Thumbnail aus Guide-Screenshot.
