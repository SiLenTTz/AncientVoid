# ADR-0011 — Session-Identität, Discovery, Writer-Lease

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/identity.ts`,
`packages/contracts/src/session.ts`, `packages/core/src/discovery.ts`,
`packages/core/src/sessionmanager.ts`, `packages/server/src/routes.ts`,
T5.1–T5.6 (`EPIC-P5-session-discovery-handoff-recovery.md`)

## Kontext

Audit G01–G04: der Hub listet nur eigene SQLite-Records. Native Provider-IDs
leben in Adapter-Maps und überleben keinen Neustart als Steuer-Handle.
`recoverAll()` zählte eine Session als recovered, auch wenn `recover()`
`null` lieferte. Zwei Clients konnten denselben Steer zweimal auslösen.
`attachCmd` hing am Status, nicht an einem lebenden Pane.

## Entscheidung

1. **Identität.** Hub-`id` bleibt der stabile Schlüssel. Externe Identität
   ist `hostId + adapter + nativeSessionId`. `controlMode` ist
   `observed | managed | controllable`, `harness` ist `cli | ide | desktop-app`.
   `resumeVersion` ist `RESUME_SCHEMA_VERSION` (aktuell 1). Jede andere
   Version wird in Discovery als `unsupportedResume` angezeigt und nicht
   als steuerbar behandelt. Credentials stehen nicht in diesen Feldern.
2. **Persistenz.** Migration 7 legt die Felder auf `sessions` und die
   Tabelle `session_inputs` an. Bestehende Rows bekommen Defaults
   (`managed`, `cli`, `local`, Version 1). Snapshot schreibt dieselben
   Felder mit; SQLite bleibt die Wiederherstellungsquelle für die Identität.
3. **Discovery.** `GET /api/discovery` mischt Hub-Records und registrierte
   `DiscoverySource`s, dedupliziert über die externe Identität (Hub-Record
   gewinnt) und paginiert per `cursor`/`limit`.
4. **Eingaben.** Optionales `inputId` wird nach erfolgreichem Steer
   gespeichert; ein zweites Mal mit derselben Id führt nicht noch einmal
   aus. Optionales `revision` muss der aktuellen `inputRevision` entsprechen,
   sonst `revision conflict`. Optionales `clientId` hält 30 s eine
   Writer-Lease; ein anderer Client bekommt `writer lease held`.
   **Nachtrag 2026-09-23 (T5.5):** `takeover: true` übernimmt die Lease
   bewusst. `inputId` und `revision` gelten weiter, die Übergabe steht als
   `session.writer_takeover { from, to, actor }` im Verlauf. Die PWA bietet
   „Übernehmen“ erst nach einem `writer lease held` an, nie automatisch.
   Die Steers einer Session laufen nacheinander (BUG-0017), damit kein
   zweiter Aufruf Lease und Revision während eines laufenden Steers prüft.
5. **Recovery.** Eine nicht gestoppte Session ohne Handle nach `recover()`
   wird `observed` und zählt nicht als recovered. `keepWorkers` enthält
   nur Sessions mit Handle, damit Reaping sie nicht wegräumt.
6. **Attach.** `attachCmd` nur bei Runner `tmux`, Status `working` und
   einem vom Runner gelisteten Worker.

## Konsequenzen

- Live PC→Handy→PC je echtem Harness (AC-P5-2) ist damit vorbereitet,
  aber nicht abgenommen: dafür fehlen Gerät und Provider-Lauf.
- Alte Clients, die Steer ohne `inputId`/`revision`/`clientId` senden,
  verhalten sich wie vorher.
- Forks (`fork: true`) sind sichtbar und zählen nicht als native Handoff.
