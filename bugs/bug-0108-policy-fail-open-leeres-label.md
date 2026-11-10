---
id: BUG-0108
slug: policy-fail-open-leeres-label
status: done
severity: S3
area: server
instance: dev
commit: "7d0ab0b"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/42"
epic: "EPIC-P7 T7.4 (Policy-Tabelle, Fail-Closed)"
created: 2026-11-10
reporter: "Sicherheitsaudit (pi)"
---

# BUG-0108 — Token mit leerem Label umgeht die komplette Policy-Tabelle

## Gesehen

Ein gültiges Gerät mit **leerem Label** wird von Policy-Hook und Auth-Hook
wie ein öffentlicher Request behandelt und darf deshalb alles, was ein
`agent:`-Token nicht dürfte — u. a. selbst Tokens ausgeben
(`tokens.manage` ist für Agents deny). `policyHook` bricht mit
`if (!label) return; // public routes` ab, `checkAuth` prüft Prefixe nur für
die bekannten Präfix-Typen; ein leeres Label trifft keinen davon und wird
nicht abgewiesen. Über die API kann kein leeres Label angelegt werden
(`identity.routes.ts` erzwingt `z.string().min(1)`) — über `hubctl token
issue ""` sehr wohl (`args[1] ?? usage()` lässt den leeren String durch).

## Erwartet

Fail closed (AGENTS Regel 6 / T7.4): ein Token, dessen Label keiner Actor-
Klasse zuordenbar ist, darf keine Write-Klasse-Operation ausführen —
genau das war der Zweck der Zeile „Unmapped writes count as deny for
agents — fail closed". Der API-Pfad schützt sich mit `min(1)` bereits; der
Umweg über `hubctl` öffnet dieselbe Lücke.

## Repro

Voraussetzung: Hub-Testinstanz mit frischer DB (hier: `dataDir` unter `/tmp`,
Port 7979, Config nur `dataDir` + `server.port`), `hubctl` auf `--db`
gegen deren DB-Datei.

1. `node apps/hubctl/src/cli.ts token issue audit-agent --agent --db <db>` → Token A
2. `node apps/hubctl/src/cli.ts token issue "" --db <db>` → Token B (Label leer)
3. `curl -X POST -H "Authorization: Bearer <A>" -d '{"label":"x"}' http://127.0.0.1:7979/api/tokens` → **403** (erwartet: `tokens.manage` ist für Agents deny)
4. `curl -X POST -H "Authorization: Bearer <B>" -d '{"label":"x"}' http://127.0.0.1:7979/api/tokens` → **201** mit Token im Body

**Ergebnis nach Schritt 4:** identische Operation, agent-Deny-Regel greift
beim Agent-Token, beim Leeren-Label-Token nicht. Häufigkeit: immer.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (Testinstanz `127.0.0.1:7979`, frische DB) |
| Commit | `7d0ab0b` |
| Node-Version | v26.7.0 |
| Adapter | keiner (Policy-Hook vor Registry) |
| Repro-Weg | hubctl (Schritt 1–2) + API (3–4, Äquivalent zum PWA-Pfad) |

## Logs

Quelle: Hub-Log der Testinstanz (Auszug, Tokens redacted).

```text
{"ts":"2026-11-10T00:10:34.223Z","level":30,"reqId":"req-2","req":{"method":"POST","url":"/api/tokens",...},"res":{"statusCode":403},"msg":"request completed"}   ← Agent-Token
{"ts":"2026-11-10T00:10:34.230Z","level":30,"reqId":"req-3","req":{"method":"POST","url":"/api/tokens",...},"res":{"statusCode":201},"msg":"request completed"}   ← Leeres Label
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/contracts/test/approvals/policy.test.ts` | grün (behandelt nur Label-Klassen, nicht „kein Label“; unverändert) |
| Integration | `apps/hub/test/platform/policy-empty-label.test.ts` (leeres Label: Write 403, Read 403; Agent 403; Mensch 201) | rot ohne Fix (201/200 beobachtet), grün mit Fix |
| CLI | `apps/hubctl/test/cli.test.ts` (`token issue ""` → Usage/Exit 1; echtes Label weiterhin grün) | rot ohne Fix, grün mit Fix |

## Eingrenzung

`apps/hub/src/platform/policy.ts` (`policyHook`, `if (!label) return;`) und
`apps/hub/src/platform/auth.ts` (`checkAuth`, Label ohne Prefix ⇒ keine
Regel); Einstieg über `apps/hubctl/src/cli.ts` (`token issue`, `args[1] ??
usage()` akzeptiert `""`).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` oder offen lassen

## Fix (verifiziert 2026-11-10, pi/halogen-qwen3.8)

- Fix: `policyHook` (`apps/hub/src/platform/policy.ts`) weist ein verifiziertes
  Token ohne Label jetzt fail-closed ab (403) statt über `actorKind("")`
  still die Human-Zeile zu erben; `hubctl token issue` verlangt wie die API
  ein nicht-leeres Label (`token revoke` kann bestehende Tokens ohne
  Label weiterhin aufräumen). Commit `39c183c` (`^ B hub: …`, Test: rot
  ohne Fix) und `61c6d50` (`^ B hubctl: …`).
- Verifikation: `npx vitest run apps/hub/test/platform/policy-empty-label.test.ts
  apps/hubctl/test/cli.test.ts` → grün; volles Gate (`npm run gate`) grün
  (1400+ Tests, e2e 425 passed / 2 skipped).
