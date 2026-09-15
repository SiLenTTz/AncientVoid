---
id: BUG-0009
slug: pwadir-silently-unresolved
status: done
severity: S1
area: server
instance: dev
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/9"
epic: EPIC-P1
created: 2026-09-15
reporter: "Claude Sonnet 5 (Session 012Ga2NDi683xR9E63StoN7T)"
---

# BUG-0009 — a misconfigured `pwaDir` fails completely silently, PWA unreachable

## Gesehen

Beim ersten echten Durchlauf des README-Quick-Starts (AI-P1-1: nie zuvor
wörtlich befolgt — bisherige Tests riefen `createHubApp()` immer direkt mit
einem korrekten absoluten `pwaDir` auf, nie über eine echte
`hub.config.json`):

1. `cp packages/server/hub.config.example.json hub.config.json` (Repo-Root,
   wie im README beschrieben).
2. `node packages/server/src/main.ts` (ebenfalls Repo-Root, wie im README).
3. Die mitgelieferte Beispieldatei enthielt `"pwaDir": "../pwa/dist"` —
   relativ zum Ausführungsverzeichnis (Repo-Root) aufgelöst ergibt das
   `/mnt/.../arbeitsbaeume/pwa/dist` — **außerhalb des Repos**, existiert
   nicht.
4. Hub startet ohne jeden Hinweis ("[hub] listening on ..."). Jede Anfrage
   an `/` liefert ein bloßes Fastify-404 ("Route GET:/ not found") — keine
   Log-Zeile, kein Warnhinweis, nichts, das auf eine Fehlkonfiguration
   hindeutet.

## Erwartet

Entweder lädt die PWA (bei korrektem Pfad), oder der Hub sagt **laut**,
warum nicht (AGENTS.md Regel 6, „Fail loud"), statt ein stilles 404 zu
produzieren, das wie ein simples Routing-Problem aussieht.

## Repro

```bash
cp packages/server/hub.config.example.json hub.config.json   # wie im README
node packages/server/src/main.ts
curl -s http://127.0.0.1:7373/ -w '%{http_code}\n'
```

**Ergebnis (vor dem Fix):** `404`, keine Log-Zeile, die erklärt warum.

## Eingrenzung

`packages/server/src/index.ts:30` (vor dem Fix):

```ts
if (deps.pwaDir && existsSync(resolve(deps.pwaDir))) {
  await app.register(fastifyStatic, { ... });
  app.setNotFoundHandler(...);
}
```

Kein `else`-Zweig — ein konfigurierter, aber nicht auflösbarer `pwaDir`
wird komplett übergangen, ohne jede Meldung. Ursache der Fehlkonfiguration:
`packages/server/hub.config.example.json`s eigener `pwaDir: "../pwa/dist"`
ging von einem Ausführungsverzeichnis `packages/server/` aus — das README
Quick Start kopiert die Datei aber nach Repo-Root und führt `main.ts` auch
von dort aus.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| — | keiner | Kein Test rief `createHubApp()` je über eine echte, aus einer Datei geladene Config auf — nur mit direkt im Test konstruierten, garantiert korrekten Pfaden. |

## Fix

1. `packages/server/src/index.ts`: `else`-Zweig ergänzt — ein konfigurierter,
   aber nicht existierender `pwaDir` erzeugt jetzt `app.log.warn(...)` mit
   dem aufgelösten Pfad und einem Hinweis auf die wahrscheinliche Ursache
   (CWD-Annahme). Die App startet trotzdem (kein Absturz), aber jetzt mit
   einer sichtbaren Erklärung statt eines stillen 404.
2. `packages/server/hub.config.example.json`: `pwaDir` auf
   `"./packages/pwa/dist"` korrigiert (passend zum tatsächlich im README
   dokumentierten Ausführungsverzeichnis Repo-Root), `$comment` präzisiert.
3. Regressionstests in `packages/server/test/server.test.ts` (neue
   `describe`-Gruppe "pwaDir resolution"): ein nicht auflösbarer `pwaDir`
   crasht nicht und lässt `/api/*` weiter funktionieren; ein gültiger
   `pwaDir` liefert die SPA-Shell für `/` und beliebige Client-Routen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` — behoben, siehe oben. Gates grün (93/93 Tests nach
      Ergänzung).
