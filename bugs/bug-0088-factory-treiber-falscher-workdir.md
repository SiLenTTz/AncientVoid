---
id: BUG-0088
slug: factory-treiber-falscher-workdir
status: done
severity: S2
area: core
instance: lokal
commit: "778afb7"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/38"
epic: EPIC-P26
created: 2026-11-02
reporter: Jan
---

# BUG-0088 — Factory-Treiber arbeitet außerhalb des beobachteten Projekts

## Gesehen

Treiber arbeitet in data/worktrees, Beobachter liest das Originalprojekt.

## Erwartet

Beide Rollen arbeiten im selben Factory-Projekt.

## Repro und Belege

Nutzerbericht über die echte PWA. Lokale JSONL-Belege vom 2026-11-02:
`voidwarden`: Treiber `851e37f9` / Beobachter `6aa0ccd1` um 21:54:52 UTC;
zweites Paar `3b9346a2` / `7268794a` um 21:55:05 UTC. Beide Treiber:
`adapter=claude`, `model=null`, `workdir=data/worktrees/<id>`.
Projektkonfiguration: `provider=zai`.

Im automatisierten Repro ohne Fix rot: Factory-Integrationstest mit echtem Git-Projekt und WorktreeManager: worktreeSha bleibt null.

## Ursache

SessionManager.create isoliert den Treiber wie eine normale Coding-Session.

## Fix und Prüfung

Beide Rollen arbeiten im selben Factory-Projekt. Bezug: PRD §9 K7/K9, EPIC-P26 AC-2/6/9.
Tests: Factory-Integrationstest mit echtem Git-Projekt und WorktreeManager: worktreeSha bleibt null. Vollständige Gate-Ergebnisse stehen in der MR.

## Handoff

Repo-Skills bug-report → bugfix → gates → pr-review; GitLab-MR als Abschlusslog.
