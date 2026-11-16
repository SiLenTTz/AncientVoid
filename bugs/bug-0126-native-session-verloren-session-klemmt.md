---
id: BUG-0126
slug: native-session-verloren-session-klemmt
status: done
severity: S2
area: adapters
instance: lokal
commit: "e5b6b90"
forge: ""
epic: ""
created: 2026-11-12
reporter: "Nutzer (Session c0e0ab44)"
---

# BUG-0126 — Verlorene Provider-Session klemmt die Hub-Session endgültig fest

## Gesehen

Hub-Session `44521072` (maki, „Fenster-Drag-out und Ordnerauswahl reparieren")
steht auf `status: error`; **jeder** Prompt — auch „Weitermachen" nach
Hub-Neustart — endet in `session.start_failed` mit
„Resource not found: not found: CgwwyS3Xtsp6JntW2hnPw". Der Nutzer hat
weder eine Reparaturmöglichkeit noch einen sauberen Übergabeweg.

## Erwartet

Hat der Agent die native Session verloren (Store geleert/gewandert), dann:

1. klemmt die Hub-Session nicht: der nächste Lauf startet mit frischem
   Agentenkontext, sichtbar markiert (`acp.context_lost`), und die neue
   native ID wird gebunden;
2. bietet die PWA zwei Wege: **Reparieren** (dieselbe Session, Kontext aus
   dem Hub-Verlauf neu aufgebaut) und **Übergabe an eine andere Session**
   (bestehende Handover-Maschinerie, bisher nur für Provider-Fehler
   erreichbar).

## Repro

Voraussetzung: Hub läuft, maki-Session mit native ID, deren Store-Eintrag
beim Agenten nicht mehr existiert (z. B. maki-Daten gelöscht).

1. PWA → Session → Prompt senden.
2. `session.start_failed` mit „Resource not found: not found: <id>".
3. Erneut senden — gleiches Ergebnis, Endlosschleife.

**Erwartung nach Fix:** Schritt 1 läuft: `acp.context_lost` + frischer
Kontext + Antwort; Reparieren/Übergeben angeboten.

**Häufigkeit:** immer (für verlorene native IDs)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (systemd ancientvoid-hub, 127.0.0.1:7373) |
| Commit | `e5b6b90` |
| Node-Version | 26.7.0 |
| Adapter | `@ancientvoid/adapter-acp`, preset `maki`, model zai/glm-5.3-flash |
| Repro-Weg | PWA (Nutzer) + EventStore `sessions/44521072…/events.jsonl` seq 662–669 |

## Logs

```text
seq 653 system session.interrupted (hub_restart)
seq 659..668 user "Bitte setze die unterbrochene Arbeit fort."
seq 659→669 system session.start_failed
     error: "Resource not found: not found: CgwwyS3Xtsp6JntW2hnPw"
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/acp/test/adapter.test.ts` (not-found Load) | nicht vorhanden |
| Unit | `packages/core/test/modules/sessions/session-manager.test.ts` (repair) | nicht vorhanden |
| Unit | `packages/core/test/modules/handover/handover.test.ts` (Grund „session") | nicht vorhanden |
| Route | `apps/hub/test/modules/sessions/repair.test.ts` | nicht vorhanden |
| Unit | `apps/pwa/test/features/session/handover.test.ts` | nicht vorhanden |

## Eingrenzung

- `packages/adapters/acp/src/index.ts:405` `resumeNative()` — ein fehl­
  schlagendes `session/load` wird fatal geworfen; der sichtbare Degrade-Pfad
  (`acp.context_lost`, Zeile 610/700) greift nur, wenn der Agent `loadSession`
  gar nicht deklariert — nicht, wenn die konkrete ID unbekannt ist.
- `packages/core/src/modules/sessions/session-manager.ts:1286` `continueStopped`
  reicht die tote ID als `resumeSessionId` weiter (Endlosschleife); eine
  Reparatur-Route fehlt.
- PWA `currentProviderFailure` kennt nur `provider.error` — die Handover-Bar
  erscheint für diese Fehlerklasse nie.

## Fix

Behoben mit `fa8e3a20` (MR !396, `fix/stale-native-session-reparatur`):
Reparatur-Route in `apps/hub/src/modules/sessions/sessions.routes.ts`,
Handover-Bar in der PWA (`apps/pwa/src/features/session/Handover.tsx`,
`handover.ts`). Tests: `apps/hub/test/modules/sessions/repair.test.ts`,
`apps/pwa/test/features/session/handover.test.ts`. Status nachgezogen am
15.11.2026 (Commit in `HEAD` per `git merge-base --is-ancestor` belegt).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [x] `bugfix`
