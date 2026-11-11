---
id: BUG-0113
slug: automation-prompt-update-hash
status: in-progress
severity: S2
area: core
instance: dev
commit: "8f25ef7"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/47"
epic: "EPIC-P41"
created: 2026-11-10
reporter: "Codex"
---

# BUG-0113 — Automation-Update prüft Prompt-Hash nicht

## Gesehen

update() speichert eine neue Definition vor der Prompt-Prüfung; bei falschem SHA wird der referenzierte Blob nicht gefunden und null an den Launcher übergeben.

## Erwartet

Neue Definitionen beginnen deaktiviert. Ein Dispatch erhält ausschließlich den zur Definition passenden Prompt (EPIC-P41 §3.3/3.4).

## Repro

Am 10.11.2026 gegen `AutomationService` mit isoliertem temporärem Datadir und Fake-Launcher per Node-CLI reproduziert. PWA-/hubctl-Repro nicht separat bestätigt. Häufigkeit: immer. Node 26.7.0, Ausgangsstand `8f25ef7`.

```text
update with mismatched prompt accepted => true
launcher receives missing prompt => true
```

## Eingrenzung und Fix

`packages/core/src/modules/automations/service.ts:106` (Ausgangsstand): Prompt und vorhandenen Blob vor dem Journal-Update prüfen; ungültige Updates lassen Definition und Freigabe unverändert.

## Tests

Regression in `packages/core/test/modules/automations/service.test.ts`: `rejects a mismatched updated prompt before changing the approved definition`. Vor dem Fix rot, nach dem Fix grün (`npm test -- packages/core/test/modules/automations/service.test.ts --cache=false`). Vollständige Gates folgen im Übergabebericht.

## Handoff

- [x] Im Bug-Index eingetragen
- [x] GitLab-Issue verlinkt; MR folgt im Übergabebericht bzw. GitLab
- [x] Vollständiges Gate und pr-review abgeschlossen (Epic-Exit bleibt offen; siehe Übergabebericht)
