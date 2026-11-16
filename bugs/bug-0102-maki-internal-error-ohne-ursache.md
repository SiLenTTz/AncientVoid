---
id: BUG-0102
slug: maki-internal-error-ohne-ursache
status: done
severity: S2
area: adapters
instance: live
epic: ""
created: 2026-11-07
reporter: "Nutzer (PWA, Session 471cbf58, Event #582)"
---

# BUG-0102 — maki „Internal error" ohne Ursache

## Gesehen

Prompt an eine maki-Session endet sofort mit „Fehler beim Provider — Internal
error" (Kategorie `unknown`).

## Erwartet

Die Fehlermeldung nennt die Ursache und ordnet sie ein (hier: Verbindung zum
Modell-Server).

## Ursache

Der Worker-Log (`data/workers/ancientvoid-471cbf58-….log`) zeigt
`{"error":{"code":-32603,"message":"Internal error","data":"could not connect,
check the server is running and the base URL is correct"}}`. Der JSON-RPC-Client
(`packages/adapters/jsonrpc/src/index.ts`, `handleLine`) übernahm nur
`error.message` und verwarf `error.data`. Zusätzlich kannte
`classifyProviderError` „could not connect" nicht als Netzwerkfehler.

## Fix

`error.data` wird an die Fehlermeldung angehängt; „could not connect" /
„connection refused" zählen als `network`. Der eigentliche Verbindungsfehler
von maki zum Modell-Server liegt außerhalb des Hubs.

## Tests

`packages/adapters/acp/test/rpc-error.test.ts` (ohne Fix rot),
`packages/contracts/test/harness/provider-error.test.ts`.
