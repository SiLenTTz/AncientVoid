---
id: BUG-0115
slug: automation-neuanlage-aktiv
status: done
severity: S2
area: core
instance: dev
commit: "8f25ef7"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/46"
epic: "EPIC-P41"
created: 2026-11-10
reporter: "Codex"
---

# BUG-0115 — Automation-Neuanlage übernimmt Aktivierung

## Gesehen

create() übernimmt enabled=true aus dem Request statt jede Neuanlage deaktiviert zu speichern.

## Erwartet

Neue Definitionen beginnen deaktiviert. Ein Dispatch erhält ausschließlich den zur Definition passenden Prompt (EPIC-P41 §3.3/3.4).

## Repro

Am 10.11.2026 gegen `AutomationService` mit isoliertem temporärem Datadir und Fake-Launcher per Node-CLI reproduziert. PWA-/hubctl-Repro nicht separat bestätigt. Häufigkeit: immer. Node 26.7.0, Ausgangsstand `8f25ef7`.

```text
create(enabled=true) => true
```

## Eingrenzung und Fix

`packages/core/src/modules/automations/service.ts:95` (Ausgangsstand): create() normalisiert enabled=false; vorhandener Aktivierungsendpunkt bleibt der Freigabeweg.

## Tests

Regression in `packages/core/test/modules/automations/service.test.ts`: `does not accept activation supplied during creation`. Vor dem Fix rot, nach dem Fix grün (`npm test -- packages/core/test/modules/automations/service.test.ts --cache=false`). Vollständige Gates folgen im Übergabebericht.

## Handoff

- [x] Im Bug-Index eingetragen
- [x] GitLab-Issue verlinkt; MR folgt im Übergabebericht bzw. GitLab
- [x] Vollständiges Gate und pr-review abgeschlossen (Epic-Exit bleibt offen; siehe Übergabebericht)
