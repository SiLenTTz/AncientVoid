---
id: BUG-0114
slug: dock-acht-ziele-mobil
status: in-progress
severity: S2
area: pwa
instance: dev
commit: "8f25ef7 mit P41-Oberfläche"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/48"
epic: "EPIC-P41 T41.5"
created: 2026-11-10
reporter: "Codex"
---

# BUG-0114 — Acht Dock-Ziele überlappen auf schmalen Displays

## Gesehen

Der P41-Eintrag „Automationen“ drängt auf einem mobilen Viewport die
Beschriftungen ineinander und „Einstellungen“ über den sichtbaren rechten Rand.
PWA-Screenshot des roten Navigationstests am 10.11.2026 geprüft (412 px).
Ein gezielter Browser-Repro bestätigte außerdem eine Schaltflächenbreite
von 42 statt mindestens 44 px. Häufigkeit: immer bei diesem Viewport/Stand.

## Erwartet

Alle acht Ziele passen bei 412 px mit lesbaren Beschriftungen und mindestens
44 px breiten Schaltflächen in den Dock. Bei 320 px bleiben die Ziele durch
internes Scrollen erreichbar; die Seite selbst läuft nicht horizontal über.

## Repro und Tests

`npm run test:e2e -- e2e/specs/dock-visibility.spec.ts --project=mobile --grep 'P41:' --workers=1`

Vor dem Fix rot:

```text
Expected: >= 44
Received: 42
```

Nach dem Fix dreimal wiederholt. Test prüft zusätzlich Beschriftungsgrenzen,
Dock-Breite bei 412 px und das Öffnen der Einstellungen bei 320 px.
Keine Screenshots oder Roh-Logs werden committet.

## Eingrenzung und Fix

`apps/pwa/src/app/styles/10-voice-and-dock.css:125`: Flex-Schaltflächen ohne
Mindestbreite und ohne Umbruch langer Bezeichnungen. Mindestbreite 44 px,
Umbruch innerhalb der Schaltfläche; horizontales Scrollen gehört bei zu wenig
Platz dem Dock. Die bestehende Höhenbegrenzung aus BUG-0098 bleibt erhalten.

## Umgebung und Handoff

Node 26.7.0, Playwright Chromium, echter isolierter Test-Hub mit Test-CLIs.
Vollständige Gates und Review im P41-Übergabebericht.

- [x] Im Bug-Index eingetragen
- [x] GitLab-Issue verlinkt; MR folgt im Übergabebericht bzw. GitLab
- [x] Vollständiges Gate und pr-review abgeschlossen (Epic-Exit bleibt offen; siehe Übergabebericht)
