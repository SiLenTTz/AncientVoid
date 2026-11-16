# Video-Skript (Schablone) — `<n>-<slug>.md`

**Art:** how-to

Ein Clip = eine Feature-Story, ≤ 3 Minuten, Englisch. Reihenfolge zwingend:
Skript-Review → Demo-Szene am Seed (`npm run demo:seed`) → Aufnahme →
Schnitt ≤ 180 s → Publish-Checkliste (docs/demo-media.md). Erst der
öffentliche YouTube-Link zählt als erledigt; Rohmaterial bleibt außerhalb
des Repos.

```markdown
# <n> — <Titel> (≤ 60 Zeichen)

**Ziel:** eine Feature-Story in einem Satz.
**Dauer:** ≤ 180 s · **Sprache:** EN · **Seed-Szenen:** welche Demo-Hub-Zustände
**Playlist:** AncientVoid Features · **Endcard:** github.com/SiLenTTz/AncientVoid + docs/guide/README.md

## Shot-Liste

| # | Szene (Seed-Zustand) | Dauer | Overlay/Text |
|---|---|---|---|
| 1 | … | 8 s | … |

## Sprechtext (EN, 200–350 Wörter)

> …

## Aufnahme-Hinweise

- Vollbild, kein Systemmitteilungs-Overlay, eigenes Browser-Profil.
- Nur Demo-Seed-Daten (docs/demo-media.md).
```
