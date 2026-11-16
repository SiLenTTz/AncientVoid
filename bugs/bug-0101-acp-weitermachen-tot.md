---
id: BUG-0101
slug: acp-weitermachen-tot
status: done
severity: S2
area: adapters
instance: live
epic: ""
created: 2026-11-07
reporter: "Nutzer (PWA, Screenshot 2026-11-07 13:01)"
---

# BUG-0101 — „Weitermachen" auf unterbrochener maki-Session wirkt nicht

## Gesehen

Live nach sauberem Hub-Neustart (2026-11-07 11:55): Die maki-Chat-Session
„Prüfe, ob alles sauber läuft …" (64829ba8) steht korrekt auf
`interrupted` (Grund `hub_restart`), das InterruptedBanner bietet
„Weitermachen" an — ein Tap passiert nichts. Der Button ist disabled,
da `capabilities.resume.hub` fehlt; der Server würde mit „Dieser
Adapter kann nicht nativ fortsetzen" verweigern
(`session-manager.ts` resumeNow). Nutzerbericht: „Alte Sessions nicht
wieder aufnehmen … passiert nichts, wenn ich auf weitermachen klicke."

## Erwartet

„Weitermachen" lädt die alte Konversation nativ (maki/omp via ACP
`session/load`) und die Session ist ohne neue Nachricht weiter führbar.

## Repro

- Live: Hub-Neustart mit laufender maki-Session → Status `interrupted`
  → „Weitermachen" reagiert nicht (disabled).
- Test: `createAdapter({ preset: "maki" }).capabilities().resume` ist
  `undefined` — obwohl `start({ args: { resumeSessionId } })` die
  Konversation seit EPIC-P24 lädt (`resumeNative` → `session/load`).

## Ursache

`packages/adapters/acp/src/index.ts` `capabilities()` deklariert kein
`resume` — für keinen Preset. Die ADR-0044-Maschinerie (Status
`interrupted`, `POST /api/sessions/:id/resume`, PWA-Banner mit
`canResume = resume.hub === true`) ist fertig und getestet, aber kein
produktiver Adapter opt-in't je in `hub`. ADR-0041 hat die native
Fortsetzung für maki 0.6.5 und omp 18.13.3 live belegt
(`session/load`, Verlauf importiert, aus übernommenem Kontext
geantwortet) — der ACP-Adapter implementiert genau diesen Pfad in
`start()` (ohne Prompt: laden, kein Zug), deklariert ihn nur nicht.

## Fix

`capabilities()` deklariert für Presets mit ADR-0041-Beleg (maki, omp)
`resume: { argv: [<cli>, "--resume", "{sessionId}"], ref: "native",
hub: true }` — argv display-only wie ADR-0036 (echte CLI-Flags:
`maki --resume`, `omp --resume=<id>`), `hub: true` nach ADR-0044, weil
`start({ args: { resumeSessionId } })` ohne Prompt die gespeicherte
Provider-Session über das Adapter-Protokoll fortsetzt. Presets ohne
Beleg (dsh, copilot, opencode, custom) bleiben ohne Deklaration —
ehrlich; deren Sessions sind weiterhin per Folgeprompt fortsetzbar
(`continueStopped`), Kontextverlust fail-loud via `acp.context_lost`.

## Nachweis

- Roter Test ohne Fix: `adapter.test.ts` „BUG-0101: maki/omp deklarieren
  natives Hub-Resume" — `capabilities().resume` war `undefined`.
- Mit Fix grün: `npx vitest run packages/adapters/acp` (47 Tests),
  `npm test` (190 Dateien / 1334 Tests), `npm run lint`, `npm run typecheck`,
  `npm run test:e2e` (363 passed, 2 sichtbare Skips).
- Verhaltensseite war bereits belegt: `start({args:{resumeSessionId}})`
  ohne Prompt lädt die Konversation und startet keinen Zug
  (BUG-0036/BUG-0039-Tests); Core-Resume-Maschinerie seit EPIC-P27
  integriert getestet (`interrupted-session.integration.test.ts`).
