---
id: BUG-0207
slug: sound-taste-schwebt-mittig-im-panel-kopf
status: done
severity: S4
area: pwa
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/146"
epic: "EPIC-P65 T65.4 (Sound-Taste nachträglich in den Kopf gebaut)"
created: 2026-11-18
reporter: Nutzer (Kai)
---

# BUG-0207 — Sound-Taste schwebt fast mittig im Benachrichtigungs-Panel-Kopf statt neben ✕

## Gesehen

Im Benachrichtigungs-Panel sitzt die Sound-Taste (🔇/🔊) nicht direkt links
neben der ✕-Taste, sondern fast mittig zwischen Titel und ✕.

## Erwartet

Titel links, Sound-Taste und ✕ rechts benachbart in einer Zeile.

## Repro

Hub läuft, PWA im Browser (Pixel-7-Fläche).

1. Glocke öffnen.
2. Kopfzeile des Panels ansehen / vermessen.

**Ergebnis:** Playwright-Messung (e2e, `boundingBox()`): Spalt zwischen
Sound-Taste und ✕ **82 px** — die Taste steht isoliert zwischen Titel und
✕. Erwartet ≤ 12 px (benachbart).

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E-Hub, mobiles Projekt Pixel 7) |
| Commit | `9effd963` (main) |
| Node-Version | 26.7.0 |
| Adapter | — (reines PWA-Layout) |
| Repro-Weg | PWA (Playwright-Geometrie) |

## Logs

```text
Error: Spalt 82 px zwischen Sound-Taste und ✕
Expected: <= 12, Received: 82
  (e2e/specs/notifications.spec.ts, mobile-Projekt, Stand ohne Fix)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/notifications.spec.ts` „die Sound-Taste sitzt direkt links neben ✕ im Panel-Kopf (BUG-0207)" | nicht vorhanden |

Ohne Fix rot (Spalt 82 px > 12 px), mit Fix grün (1,6 s).

## Eingrenzung

`apps/pwa/src/app/styles/14-notifications.css` — `.notif-panel-head`:
`justify-content: space-between` verteilt **drei** Kinder (Titel, Sound-Taste,
✕); die mittlere Taste rutscht in den freien Raum. Die Sound-Taste kam mit
EPIC-P65 T65.4 in den zuvor zweikindrigen Kopf, ohne die Verteilung
anzupassen. Dazu eine doppelte `padding`-Deklaration in derselben Regel
(`12px 12px 8px`, überschrieben von `4px`).

Fix: Der Titel (`> strong`) bekommt `flex: 1`, beide Tasten liegen rechts
benachbart; tote `padding`-Zeile entfernt, `space-between` entfällt.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix` gelaufen (gleicher Repro nach Fix grün)
