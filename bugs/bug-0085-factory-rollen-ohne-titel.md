---
id: BUG-0085
slug: factory-rollen-ohne-titel
status: done
severity: S2
area: pwa
instance: lokal
commit: "778afb7"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/35"
epic: EPIC-P26
created: 2026-11-02
reporter: Jan
---

# BUG-0085 — Factory-Beobachter erscheint ohne Auftrag

## Gesehen

Der Nutzer sieht zwei Sessions, eine davon ohne Auftrag.

## Erwartet

Treiber und Beobachter verständlich benennen und gegenseitig verlinken.

## Repro und Belege

Nutzerbericht über die echte PWA. Lokale JSONL-Belege vom 2026-11-02:
`voidwarden`: Treiber `851e37f9` / Beobachter `6aa0ccd1` um 21:54:52 UTC;
zweites Paar `3b9346a2` / `7268794a` um 21:55:05 UTC. Beide Treiber:
`adapter=claude`, `model=null`, `workdir=data/worktrees/<id>`.
Projektkonfiguration: `provider=zai`.

Im automatisierten Repro ohne Fix rot: Factory-Integrationstest und Factory-E2E prüfen Titel und Partnerlinks.

## Ursache

apps/hub/src/modules/factory/factory.routes.ts: Beobachter ohne title; SessionTail ohne factory.linkage-Anzeige.

## Fix und Prüfung

Treiber und Beobachter verständlich benennen und gegenseitig verlinken. Bezug: PRD §9 K7/K9, EPIC-P26 AC-2/6/9.
Titel-Fallback gilt auch für bereits vorhandene Beobachter ohne Titel.

Tests: Factory-Integrationstest und Factory-E2E prüfen Titel und Partnerlinks. Vollständige Gate-Ergebnisse stehen in der MR.

## Handoff

Repo-Skills bug-report → bugfix → gates → pr-review; GitLab-MR als Abschlusslog.
