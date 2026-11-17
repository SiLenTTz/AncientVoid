# ADR-0087 — PWA-Terminal: SSH über den Hub, Allowlist in der Config

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/terminal/`,
`packages/core` (`terminals` in HubConfig), `apps/hub/src/modules/terminal/`,
`apps/pwa/src/features/terminal/`.

## Kontext

Operatoren brauchen vom Handy/PC aus eine Shell auf erlaubten Hosts
(z. B. evox2), ohne Cursor/Plan-Umwege — etwa um Peer-`hub.config` zu
pflegen. Native PTY-Module sind ausgeschlossen (AGENTS.md: kein natives
Addon neben `node:sqlite`).

## Entscheidung

1. **Allowlist** `terminals[]` in `hub.config.json`: jedes Ziel hat `id`,
   `label` und entweder `ssh` (OpenSSH-Ziel/`Host`-Alias) oder `local: true`
   (Hub-Host via `script -qfc 'bash -l'`). Keine freien Hostnamen vom Client.
2. **API:** `GET /api/terminals`, Ticket `POST /api/terminals/:id/ticket`,
   Stream `GET /api/terminals/:id/stream?ticket=` (WebSocket, Auth wie STT).
3. **Transport:** JSON-Frames `{t:"i"|"o"|"r"|"x"|"e",…}` — stdin/out als
   Text, Resize als Hinweis (Start-`COLUMNS`/`LINES`; ohne node-pty kein
   zuverlässiges Live-Resize).
4. **PWA:** Tab „Terminal“ (Mehr-Menü), xterm.js, nur konfigurierte Ziele.
5. **K5:** kein EventBus — nur REST/WS. Secrets bleiben in SSH-Agent/Keyfiles
   des Hub-Prozesses, nie in der PWA.

## Konsequenzen

- Contracts + Config + Route-Tests; Inventar-Eintrag.
- Ohne `terminals[]`: leere Liste, Seite erklärt die Config.
- Fail loud: SSH-Fehler / Exit als Stream-Ereignis sichtbar.
