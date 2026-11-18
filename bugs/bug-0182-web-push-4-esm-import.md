---
id: BUG-0182
slug: web-push-4-esm-import
status: done
severity: S1
area: core
instance: dev
commit: "d40eadce"
forge: "https://github.com/securesight-ai/AncientVoid/pull/26"
epic: "EPIC-P28"
created: 2026-11-16
reporter: "Codex"
---

# BUG-0182 — web-push 4 verhindert den Hub-Import

## Gesehen und erwartet

Das Dependabot-Update in PR #26 stellt auf web-push 4 (ESM) um. Der Hub
importiert weiterhin dessen nicht mehr vorhandenen Default-Export und kann
nicht starten. Erwartet: Hub und Web-Push funktionieren nach dem Update.
Messlatten: K1–K10 müssen durch einen startbaren Hub überhaupt prüfbar bleiben.

## Repro und Logs

Am 16.11.2026 auf Node 26.7.0 mit dem Lockfile aus PR #26:

```sh
npm ci
node --input-type=module -e 'await import("./apps/hub/src/app.ts")'
npx vitest run packages/core/test/modules/push/push.test.ts
```

Der Import scheitert immer mit:

```text
push.ts:1 import webpush from "web-push";
SyntaxError: The requested module 'web-push' does not provide an export named 'default'
```

Die sieben vorhandenen Push-Tests scheitern ebenfalls (VAPID-Schlüssel).
Repro über Modulstart und Tests bestätigt; kein laufender Hub/PWA-Repro,
weil bereits das Laden des Hubs scheitert. Derselbe Fehler steht im K8-Job
des [roten CI-Laufs](https://github.com/securesight-ai/AncientVoid/actions/runs/43889215018).

## Ursache und Fix

`packages/core/src/modules/push/push.ts:1`: web-push 4 exportiert
`generateVAPIDKeys` und `sendNotification` als benannte Funktionen.
Der Hub verwendet diese direkt. Kein Kompatibilitäts-Shim und keine
Änderung an Contracts, Push-Payload oder Persistenz.

## Tests

Bestehende sieben Tests vor Fix rot, nach Fix grün. Ein zusätzlicher Test
ruft den echten Produktionssender mit ungültigem VAPID-Subject auf:
vor Fix falscher Importfehler, nach Fix die erwartete VAPID-Validierung,
ohne einen Netzwerkrequest. Der native Node-Hub-Import ist danach grün.
Weitere Gate-Nachweise stehen im PR #26.
