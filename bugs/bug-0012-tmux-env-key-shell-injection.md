---
id: BUG-0012
slug: tmux-env-key-shell-injection
status: fixed
severity: S1
area: workers
instance: dev
commit: ""
forge: ""
epic: "EPIC-P4 T4.10 (independent red-team review)"
created: 2026-09-18
reporter: "Claude Sonnet 5 (autonomous session, via a fresh independent red-team review subagent)"
---

# BUG-0012 — `TmuxRunner.spawn()`: unvalidated env KEY = real shell injection (RCE)

## Gesehen

`TmuxRunner.spawn()` (`packages/workers/src/tmux.ts`) baut die Kommandozeile,
die per `tmux respawn-pane` im Pane-Shell ausgeführt wird, so:

```js
const envPrefix = Object.entries(spec.env ?? {})
  .map(([k, v]) => `${k}='${v.replaceAll("'", "")}'`)
  .join(" ");
const shellCmd = `env ${envPrefix} ${cmdLine}; echo "__UACC_EXIT__$?"`;
```

Nur der **Wert** (`v`) wird (unvollständig — Anführungszeichen wurden
gelöscht statt escaped) behandelt. Der **Schlüssel** (`k`) landet
vollkommen ungeprüft im Shell-String. `spec.env` stammt letztlich aus
`SessionSpec.env` (`packages/contracts/src/session.ts`), einem
client-erreichbaren Feld (`POST /api/sessions`, `CreateSessionBody.env` in
`packages/server/src/routes.ts`), das jeder Adapter, der `ctx.spawnWorker`
mit `opts.env` aufruft, unverändert durchreicht (claude, codex, opencode,
aider, copilot).

**Live reproduziert** (echter Node-Prozess, exakt dieselbe String-Bau-Logik,
dann echt durch `/bin/sh` ausgeführt):

```js
const spec = { env: { 'X=$(touch /tmp/uacc-pwned)': 'y' } };
// envPrefix = "X=$(touch /tmp/uacc-pwned)='y'"
```
```
$ sh -c "env X=\$(touch /tmp/uacc-pwned)='y' echo hi; echo done"
hi
done
$ ls -la /tmp/uacc-pwned
-rw-r--r-- 1 silenttz silenttz 0 ... /tmp/uacc-pwned
```

Die Datei wurde real angelegt — die Command-Substitution im "Schlüssel"
lief. Ein Gerät mit einem gültigen Device-Token (der normale, vorgesehene
Zugriffslevel — "das eigene Handy", aber auch jedes gestohlene Token) kann
damit beliebige Kommandos als der Hub-Nutzer ausführen, indem es einfach
eine Session mit einem präparierten `env`-Key erstellt.

## Erwartet

Ein env-Key, der kein gültiger POSIX-Variablenname ist, wird abgelehnt,
bevor er auch nur in die Nähe eines Shell-Strings kommt — nicht "bereinigt"
(es gibt keine sichere Umschreibung für `X=$(evil)` als Variablenname, der
Aufrufer hat schlicht einen ungültigen Namen geschickt).

## Repro

1. Hub mit `workerRunner: "tmux"` (Standard) laufen lassen.
2. `POST /api/sessions` mit einem `env`-Objekt, dessen einziger Key
   Shell-Metazeichen enthält, z. B. `{"X=$(touch /tmp/pwned)": "y"}`.
3. Vor dem Fix: die Datei `/tmp/pwned` existiert nach dem Start real.

**Ergebnis vor dem Fix:** beliebiger Shell-Code läuft als Hub-Prozess-User.
**Häufigkeit:** immer, deterministisch.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Adapter | jeder, der `spec.env` an `ctx.spawnWorker` weiterreicht |
| Repro-Weg | direkte Node-Reproduktion der String-Bau-Logik + echtes `sh -c` |
| Runner | `TmuxRunner` (Standard) — `ProcessRunner` (Fallback ohne tmux) ist NICHT betroffen, da `child_process.spawn` mit einem echten `env`-Objekt statt eines Shell-Strings arbeitet |

## Eingrenzung

`packages/workers/src/tmux.ts`, `TmuxRunner.spawn()` — `envPrefix`-Aufbau
(vor dem Fix ohne Key-Validierung). Zusätzlich, im selben Fund entdeckt:
die Value-Quotierung löschte eingebettete `'` statt sie korrekt zu
escapen (`v.replaceAll("'", "")`) — keine eigene Sicherheitslücke (Werte
können die umgebenden Anführungszeichen nicht verlassen), aber stille
Datenkorruption, direkt neben dem echten Fund, im selben Fix mitbehoben.

## Fix

- `SAFE_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/` — jeder Key wird **vor** jeder
  I/O geprüft; ein ungültiger Key wirft sofort, bevor tmux überhaupt
  angefasst wird.
- Value-Quotierung korrigiert (`shellQuote()`, dieselbe
  POSIX-`'...'`-Escaping-Technik, die für `cmd`-Argumente bereits existierte).
- Defense in depth an der API-Grenze: `ENV_VAR_NAME`-Regex neu in
  `@uacc/contracts` (`packages/contracts/src/session.ts`), angewendet auf
  `SessionSpec.env`s Schlüssel-Schema UND auf `CreateSessionBody.env` in
  `packages/server/src/routes.ts` — ein bösartiger Key bekommt jetzt einen
  sauberen 400 statt eines tiefen `session.start_failed`.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/workers/test/tmux.test.ts` — "rejects a shell-metacharacter env key…" | rot (kein Guard vorhanden) |
| Unit | dito — "accepts a legal env var name and rejects other illegal shapes…" | n/a (Test neu) |
| Live | `packages/workers/test/tmux.test.ts` — "passes a legal env var through to the real spawned process" (echter tmux-Pane) | grün (Regression-Schutz) |
| Live | dito — "preserves a single quote in an env value…" (Value-Quoting-Fix) | rot vor dem Fix (Wert wäre `it a test` statt `it's a test`) |

Alle vier neu, alle grün nach dem Fix, gegen echten `tmux` verifiziert
(nicht gemockt).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt — GitLab aktuell nicht erreichbar (Gitaly-Ausfall,
      s. Session-Historie); lokal gefixt und getestet, Push steht aus.
- [x] Direkt gefixt (kein separater `bugfix`-Durchlauf nötig — Fund, Fix und
      Test entstanden in derselben Session wie der Red-Team-Review)
