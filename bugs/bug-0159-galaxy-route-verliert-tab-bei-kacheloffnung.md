---
id: BUG-0159
slug: galaxy-route-verliert-tab-bei-kacheloffnung
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: ""
epic: EPIC-P52, PRD K1
created: 2026-11-13
reporter: "E2E-Gate des Session-Robustheit-Abschluss-MRs"
---

# BUG-0159 — Graph-Deep-Link verliert den Reiter beim Öffnen der Kachel

## Gesehen

`e2e/specs/repo-galaxie.spec.ts` „System, Zurück-Reihenfolge und Vollbild"
fiel in zwei vollen E2E-Läufen (25 min, parallele Hubs) je einmal, isoliert
mit `--repeat-each` zu 20–40 %. Der Trace der fehlgeschlagenen Läufe zeigt
`frameUrl …/#/sessions/<id>` — das `/graph` des Deep-Links war aus dem Hash
entfernt, die Ansicht stand auf „Verlauf“ statt Graph-Vollbild.

## Erwartet

Ein Deep-Link auf `…/graph` (oder `…/code`, `…/datei`) landet auch dann auf
dem Reiter, wenn die Kachel für die Session erst während des Ladens geöffnet
und der Hash danach neu geparst wird.

## Eingrenzung

`apps/pwa/src/app/main.tsx`, `changeWorkspace()`: Beim Fokuswechsel schreibt
der Hash-Abgleich `sessionHash(focused)` per `history.replaceState` — ohne
Reiter-Suffix. Auf breiten Layouts öffnet der Deep-Link-Effekt die Kachel
und triggert genau diesen Rewrite. Läuft danach `openFromHash` erneut (z. B.
wenn das Token-Gate `ready` umkippt), parst es den schon gekürzten Hash; wer
die Session-Kachel asynchron erst danach mountet, startet ohne
`initialTab`. Reihenfolge = Timing → Flake.

## Fix und Verifikation

`changeWorkspace()` lässt einen bestehenden Hash stehen, der bereits auf die
fokussierte Session zeigt und nur tiefer ist (`…/graph`, `…/code`). Vorher
rot (2/10 und 4/10 in Wiederholungen, je einmal in zwei vollen Läufen),
nachher 20/20 im Wiederholungslauf plus grüne abhängige Specs
(`layout-desktop`, `herausloesen`, `repo-graph`, `browser-workspace`,
beide Projekte). Voll-Gate im Abschluss-MR.
