---
id: BUG-0087
slug: factory-start-verwirft-maki
status: done
severity: S2
area: server
instance: lokal
commit: "778afb7"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/37"
epic: EPIC-P26
created: 2026-11-02
reporter: Jan
---

# BUG-0087 — Factory-Start verwirft maki und Modellwahl

## Gesehen

maki/Z.ai gewählt, der gestartete Treiber nutzt Claude.

## Erwartet

Gewählten Treiber und Modell übernehmen; maki führt den projektlokalen Factory-Skill aus.

## Repro und Belege

Nutzerbericht über die echte PWA. Lokale JSONL-Belege vom 2026-11-02:
`voidwarden`: Treiber `851e37f9` / Beobachter `6aa0ccd1` um 21:54:52 UTC;
zweites Paar `3b9346a2` / `7268794a` um 21:55:05 UTC. Beide Treiber:
`adapter=claude`, `model=null`, `workdir=data/worktrees/<id>`.
Projektkonfiguration: `provider=zai`.

Im automatisierten Repro ohne Fix rot: Factory-Integrationstest maki + zai/glm-5.3; E2E mit echtem ACP-Fixtureprozess.

## Ursache

CreateSession sendet weder adapter noch model; factory.routes.ts erzwingt claude.

## Fix und Prüfung

Gewählten Treiber und Modell übernehmen; maki führt den projektlokalen Factory-Skill aus. Bezug: PRD §9 K7/K9, EPIC-P26 AC-2/6/9.
Tests: Factory-Integrationstest maki + zai/glm-5.3; E2E mit echtem ACP-Fixtureprozess. Vollständige Gate-Ergebnisse stehen in der MR.

## Handoff

Repo-Skills bug-report → bugfix → gates → pr-review; GitLab-MR als Abschlusslog.
