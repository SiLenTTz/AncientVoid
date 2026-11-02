---
id: BUG-0086
slug: factory-start-doppelte-laeufe
status: done
severity: S2
area: pwa
instance: lokal
commit: "778afb7"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/36"
epic: EPIC-P26
created: 2026-11-02
reporter: Jan
---

# BUG-0086 — Factory-Start bleibt im Formular und erzeugt doppelte Läufe

## Gesehen

Ein weiterer Klick startet ein zweites Session-Paar.

## Erwartet

Startformular schließen, Treiber öffnen, weitere aktive Läufe desselben Projekts verhindern.

## Repro und Belege

Nutzerbericht über die echte PWA. Lokale JSONL-Belege vom 2026-11-02:
`voidwarden`: Treiber `851e37f9` / Beobachter `6aa0ccd1` um 21:54:52 UTC;
zweites Paar `3b9346a2` / `7268794a` um 21:55:05 UTC. Beide Treiber:
`adapter=claude`, `model=null`, `workdir=data/worktrees/<id>`.
Projektkonfiguration: `provider=zai`.

Im automatisierten Repro ohne Fix rot: Factory-E2E auf Desktop/Mobile; Integrationstest mit zwei parallelen POSTs.

## Ursache

factory.routes.ts gibt hostId=local statt des tatsächlichen Hosts in beiden SessionRecords zurück; Fleet-Routing scheitert. main.tsx: replaceState aktualisiert route nicht; CreateSession öffnet observer; Route ohne Start-Sperre.

## Fix und Prüfung

Startformular schließen, Treiber öffnen, weitere aktive Läufe desselben Projekts verhindern. Bezug: PRD §9 K7/K9, EPIC-P26 AC-2/6/9.
Tests: Factory-E2E auf Desktop/Mobile; Integrationstest mit zwei parallelen POSTs. Vollständige Gate-Ergebnisse stehen in der MR.

## Handoff

Repo-Skills bug-report → bugfix → gates → pr-review; GitLab-MR als Abschlusslog.
