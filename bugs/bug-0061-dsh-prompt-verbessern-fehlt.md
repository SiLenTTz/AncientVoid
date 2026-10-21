---
id: BUG-0061
slug: dsh-prompt-verbessern-fehlt
status: done
severity: S3
area: server, pwa
instance: dev
commit: "e373e0b"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/16"
epic: ""
created: 2026-10-21
reporter: nutzer (Handy)
---

# BUG-0061 — „Verbessern“ fehlt für DeepSeek-Harness-Sessions

## Gesehen

Für Sessions des DeepSeek Harness (Adapter-Registration `deepseek`, `@uacc/adapter-acp` mit dsh-Preset) ist der Button „Verbessern“ im Composer ausgegraut („Für diesen Adapter nicht verfügbar“); ein direkter Aufruf der Route scheitert mit `no enhancer wired up for adapter "deepseek"`.

## Erwartet

Der „Verbessern“-Button bietet für dsh-Sessions die Prompt-Optimierung an und liefert einen umgeschriebenen Prompt — dsh kann das one-shot über `dsh --profile headless` (ADR-0018 listet das Profil explizit).

## Repro

Voraussetzung: lokaler Hub läuft (`127.0.0.1:7373`), Adapter `deepseek` registriert, Device-Token vorhanden.

1. `POST /api/prompt-enhance` mit `{"adapter":"deepseek","project":"<repo>","text":"mach das mit dem login besser"}` (gleicher Weg, den der PWA-Button geht).
2. **Ergebnis nach Schritt 1:** HTTP 502, `{"error":"enhancePrompt: no enhancer wired up for adapter \"deepseek\""}`.
3. In der PWA (gleiche Ursache, zweite Schicht): `ENHANCE_SUPPORTED_ADAPTERS` in `apps/pwa/src/features/composer/Composer.tsx:15` enthält nur `claude`, `codex`, `opencode` — der Button ist damit für dsh-Sessions dauerhaft deaktiviert.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `e373e0b` (Worktree) |
| Node-Version | 26.7.0 |
| Adapter | `deepseek` (`@uacc/adapter-acp`, preset dsh, dsh 0.2.1-rc.2) |
| Repro-Weg | Hub-Route (PWA-Button-Pfad) + PWA-Zustand |

## Logs

Repro vom 2026-10-21 (Hub-Antwort auf Schritt 1):

```text
$ curl -X POST http://127.0.0.1:7373/api/prompt-enhance -H "Authorization: Bearer <redigiert>" …
{"error":"enhancePrompt: no enhancer wired up for adapter \"deepseek\""}
```

Ground Truth für den Fix (echter Messlauf, 2026-10-21, dsh 0.2.1-rc.2, `--profile headless`, Task via stdin `-`):

```text
$ printf '<INSTRUCTION>\n\n---\nmach das mit dem login besser' | dsh --profile headless -
<umgeschriebener Prompt mit Ziel/Scope/Constraints/Erfolgskriterium auf stdout>
real 0m8.915s
```

stdout ist allein die fertige Antwort, Diagnostik geht nach stderr; es gibt keine Kostenzahl (dsh liefert keine, Adapter-Deklaration `cost:false`) — nie schätzen (R9.7).

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/hub/test/modules/prompts/enhance.test.ts` | grün, kennt dsh nicht |
| Route | `apps/hub/test/server.test.ts` (`POST /api/prompt-enhance`) | grün, prüft nur 400/422 |

Ohne Fix rot sein müsste: ein Test, der `enhanceFlavorFor("deepseek", "@uacc/adapter-acp", {preset:"dsh"})` → `"dsh"` verlangt, und einer, der `/api/adapters` ein `enhance:true` für diese Registration meldet. Beide in `enhance.test.ts` bzw. `server.test.ts` ergänzt (bugfix).

## Eingrenzung

- `apps/hub/src/modules/prompts/enhance.ts:215` — `enhancePrompt` kennt nur claude/codex/opencode.
- `apps/pwa/src/features/composer/Composer.tsx:15` — Client-seitige Allowlist ohne dsh; die Adapter-ID ist konfigurierbar (`deepseek`, beliebig), ein Hardcoden der ID wäre falsch.
- `apps/hub/src/modules/harness/harness.routes.ts:10` — `/api/adapters` meldet keine Enhance-Fähigkeit, deshalb kann die PWA es nicht ehrlich anzeigen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt ([#16](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/16))
- [x] `bugfix` (direkt im selben Lauf beauftragt)
