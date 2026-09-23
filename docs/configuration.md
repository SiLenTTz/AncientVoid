# Konfiguration

Der Hub liest `UACC_CONFIG` (Pfad) oder standardmäßig `./hub.config.json`.
Vorlage: `packages/server/hub.config.example.json`. Die eigene Config ist
git-ignored — keine Secrets committen.

```jsonc
{
  "dataDir": "./data",                    // SQLite, JSONL, Blobs, Worker-Logs
  "workerRunner": "tmux",                 // "tmux" (Fallback auf "process", wenn tmux fehlt) | "process"
  "projectRoots": [],                     // T1.5-4: Host-Pfade, deren direkte
                                           // Unterverzeichnisse mit .git als
                                           // Session-Projekte angeboten werden
                                           // (GET /api/projects). Leer → PWA
                                           // fällt auf ein Freitextfeld zurück.
  "server": {
    "host": "127.0.0.1",                  // loopback! Exposen nur via tailscale serve
    "port": 7373,
    "enforceTailnetIdentity": false,      // true: Requests brauchen Tailscale-Header
    "pwaDir": "../pwa/dist"               // gebaute PWA; fehlt → nur API
  },
  "adapters": [
    {
      "id": "dummy",                      // Name für SessionSpec.adapter
      "module": "@uacc/adapter-dummy",    // npm-Paket oder relativer Dateipfad
      "enabled": true,
      "config": { "eventsPerSecond": 5 }  // adapterspezifisch (zod-validiert im Adapter)
    }
  ]
}
```

## Projekt-Wurzeln (`projectRoots`)

```jsonc
"projectRoots": ["/home/user/repos"]
```

`GET /api/projects` listet genau die direkten Unterverzeichnisse eines
konfigurierten Roots, die ein `.git` enthalten (Tiefe 1, kein rekursiver
Scan). Ein nicht existierender Root erzeugt eine sichtbare Warnung statt
einer stillen Leerliste. Jeder `project`-Pfad, der bei `POST /api/sessions`,
`GET /api/skills` oder `POST /api/prompt-enhance` ankommt, wird gegen dieselbe
Root-Liste geprüft (`isProjectPathAllowed()`, symlink-sicher — ein Symlink
innerhalb eines Roots, der nach außen zeigt, wird abgelehnt) — dasselbe
Nie-dem-Client-Pfad-vertrauen-Muster wie ADR-0001. Leere `projectRoots`
(Default) bedeutet: kein Root konfiguriert, die PWA fällt auf ein
Freitextfeld für den Projektpfad zurück, kein Endpunkt lehnt dann etwas ab.

## Device-Tokens

```bash
node packages/hubctl/src/cli.ts token issue "pixel-9" --db data/hub.db
node packages/hubctl/src/cli.ts token list --db data/hub.db
node packages/hubctl/src/cli.ts token revoke "pixel-9" --db data/hub.db
```

Plaintext-Token nur einmal sichtbar; in der DB liegt der SHA-256-Hash.
Verwendung: `Authorization: Bearer <token>` (REST) bzw. `?token=` (WS).

## Exposition fürs Handy (Tailscale)

```bash
scripts/setup-tailscale-serve.sh        # tailscale serve --bg --https=443 → 127.0.0.1:7373
curl -s https://<host>.<tailnet>.ts.net/api/health
```

Kein öffentlicher Port, keine Port-Weiterleitung. Optional
`enforceTailnetIdentity: true` setzen, damit nur Tailnet-identifizierte
Requests durchgehen.

## Umgebungsvariablen

| Var | Default | Zweck |
|---|---|---|
| `UACC_CONFIG` | `./hub.config.json` | Config-Pfad |
| `UACC_LOG` | `info` | Fastify-Log-Level |
| `UACC_EXPOSE` | – | `1` = auf 0.0.0.0 binden (Container; eigenes Risiko) |
| `UACC_URL` / `UACC_TOKEN` | – | hubctl-Ziel + Auth |
