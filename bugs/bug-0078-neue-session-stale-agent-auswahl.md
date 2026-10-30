---
id: BUG-0078
slug: neue-session-stale-agent-auswahl
status: done
severity: S2
area: pwa
instance: dev
commit: "2f9224a"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/32"
epic: ""
created: 2026-10-30
reporter: "Maki (Session 3cc3df35)"
---

# BUG-0078 — Gemerkter Skill/Agent blockiert Session-Start bei Adaptern ohne Unterstützung

## Gesehen

Neue Session erstellen mit Adapter maki (auch pi, codex, omp, …) schlägt mit
„maki kennt keine Agenten." fehl, sobald für das Projekt einmal ein Skill
oder Agent (z. B. mit claude) gemerkt wurde. Der Nutzer sieht keine
Möglichkeit, das im Formular zu korrigieren.

## Erwartet

Die gemerkte Auswahl gilt nur für Adapter, die deren Art unterstützen
(`features.skills` / `features.agents`); sonst startet die Session ohne das
Argument — analog zu `permissionMode`, das beim Adapterwechsel bereits
zurückgesetzt wird (`CreateSession.tsx:112`).

## Repro

Voraussetzung: Hub läuft (`127.0.0.1:7373`), Adapter claude (agents+skills)
und maki registriert; für ein Projekt liegt eine gemerkte Auswahl vor
(`localStorage["uacc.skill.<project>"]`, gesetzt über den Skill-Picker oder
Empfehlungs-Übernahme im Composer).

1. Mit claude für Projekt P einen Agenten auswählen → wird pro Projekt
   gemerkt (`SkillOverlay.tsx:18`).
2. Neue Session, Projekt P, Adapter maki: `CreateSession.tsx:166` lädt die
   gemerkte Auswahl ungeachtet der Adapter-Features; der Picker ist für
   maki versteckt (`CreateSession.tsx:349`), `submit()` sendet
   `args.agent` mit (`CreateSession.tsx:204`).
3. Server lehnt ab: `refuseSpec` (`packages/core/src/modules/harness/features.ts:18`)
   → SessionManager (`packages/core/src/modules/sessions/session-manager.ts:435`).

**Ergebnis nach Schritt 3 (Repro per HTTP, identisch zum PWA-Submit, 2026-10-30 10:49:27):**

```text
POST /api/sessions {"adapter":"maki","project":"…","prompt":"repro","args":{"agent":"reviewer"}}
→ HTTP 422 {"error":"maki kennt keine Agenten."}
```

**Häufigkeit:** immer (für die Kombination gemerkte Auswahl × nicht
unterstützender Adapter); registrierte Features live abgefragt: nur claude
(skills+agents) und copilot (agents) unterstützen sie, alle anderen nicht.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`, systemd `uacc-hub.service`, Start 09:14) |
| Commit | `2f9224a` (Dienst-Start); Analyse auf `origin/main` `4f5d43a` |
| Node-Version | 26.7.0 (mise) |
| Adapter | maki (via `@uacc/adapter-acp`, preset maki), claude |
| Repro-Weg | HTTP-API (= exakter PWA-`createSession`-Body), PWA-Pfad im Code nachvollzogen |

## Logs

```text
Oct 30 10:49:27 omarchy node[1329]: {"level":30,"res":{"statusCode":422},
  "responseTime":3.93,"msg":"request completed"}   # req-z7f = Repro-POST
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit (PWA) | `apps/pwa/test/features/composer/skill-selection.test.ts` (neu) | rot (3 failed, Funktion fehlte) → grün (3 passed) |

Kein bestehender Test deckt die Kombination gemerkte Auswahl ×
Adapter-Features; `features.test.ts` (core) prüft nur die Server-Seite.

## Eingrenzung

PWA: `CreateSession.tsx` lädt die pro Projekt gemerkte Skill-/Agent-Auswahl
(`useEffect` auf `[project]`) ohne Abgleich mit `features` des gewählten
Adapters und sendet sie in `submit()` mit. Server-Verhalten ist korrekt
(fail loud). Fix: gemerkte Auswahl beim Laden an `features.skills` bzw.
`features.agents` koppeln (reine Hilfsfunktion + Test, Komponente nutzt sie).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` 2026-10-30: `rememberedSkill(project, features)` koppelt die
  gemerkte Auswahl an `features.skills`/`features.agents`
  (`SkillOverlay.tsx`), `CreateSession.tsx` nutzt sie im Lade-Effekt.
  Gates: test 1103/1103, lint, typecheck, e2e 266/0.
