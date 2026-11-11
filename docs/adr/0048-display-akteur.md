# ADR-0048 — Display-Akteur: liest und entscheidet nur `write`-Freigaben

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/approvals/{policy,display}.ts`,
`apps/hub/src/platform/auth.ts`, `apps/hub/src/modules/approvals/approvals.routes.ts`,
`hubctl token issue --display` · **Anlass:** VoidWarden (ESP32-Statusdisplay,
Schwesterprojekt), dort ADR-0001

## Kontext

Ein Statusdisplay am Entwicklungsrechner soll den Zustand zeigen und
`write`-Freigaben per Touch entscheiden. Kein vorhandener Akteur passt
(ADR-0021): `human` darf alles, `agent` und `companion` dürfen
`approvals.decide` nicht. `destructive`-Freigaben verlangen WebAuthn
(ADR-0007) und gehören auf das Handy.

## Entscheidung

1. Neuer Akteur `display` (Token-Label `display:<name>`, `hubctl token issue
   <name> --display`).
2. Policy-Tabelle: `read` = allow, `approvals.decide` = allow, jede andere
   Operation = deny.
3. Route-Grenze in `checkAuth` (`displayTokenAllows`): nur `GET` auf Health,
   Ready, Notifications, Sessions (Liste/Detail), Approvals (Liste/Detail) und
   `POST /api/approvals/:id/decide`. Alles andere, auch WebAuthn-Routen und
   Session-Events, ist 403. Wie Bridge und Companion darf der Display-Token auch
   von Loopback ohne Tailnet-Identität kommen (USB-Brücke auf demselben Rechner).
4. Der `decide`-Handler lehnt für `display` mit 403 ab, wenn die Freigabe nicht
   Klasse `write` ist, `reasonRequired` gesetzt ist oder es eine Provider-
   Rückfrage (`tool.question`) ist. Die Entscheidung erscheint im Audit mit
   dem Label `display:<name>`. *Für Rückfragen mit vorgegebenen Optionen fortgeschrieben
   durch [ADR-0066](0066-display-beantwortet-optionsfragen.md) (Fähigkeit je Token, Standard aus).*

## Konsequenzen

- Invarianten als Test: `policy.test.ts` (Tabelle, Routen) und
  `approvals/policy.test.ts` im Hub (write ja, destructive/reasonRequired/WebAuthn
  nein, übrige Routen 403).
- Bestehende Tokens bleiben unverändert.
