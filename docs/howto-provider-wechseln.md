# Einen Agenten (Provider) hinzufügen oder wechseln

**Art:** how-to

Ein Agent hängt am Hub als **Adapter**: ein Eintrag in `hub.config.json`,
kein Code nötig. Der Wizard trägt beim ersten Lauf einen ein; so fügst du
später weitere hinzu.

## 1. Agent-CLI erst für sich zum Laufen bringen

Der Hub erkennt installierte Programme (`claude`, `codex`, `opencode`,
`copilot`, `pi`, `hermes`, `dsh`) im `PATH`. Das belegt **nicht**, dass die
CLI angemeldet ist oder ein Modell antwortet. Melde dich mit der **eigenen
Anleitung** der CLI an und starte sie einmal selbst, bevor du sie im Hub
anbindest.

## 2. Adapter eintragen

Entweder den Wizard erneut laufen lassen (idempotent, ändert vorhandene
Einträge nicht):

```bash
./setup.sh --adapter=claude
```

oder von Hand in `hub.config.json` (Vorlage `apps/hub/hub.config.example.json`):

```json
{ "adapters": [ { "id": "claude", "module": "@ancientvoid/adapter-claude" } ] }
```

Alle Felder: [`referenz-config.md`](referenz-config.md); Adapter und ihr
geprüfter Status: README-Matrix und [`adapters.md`](adapters.md). API-Schlüssel
gehören in **Dateien** (`envFiles`, nie in die Config), siehe
[`onboarding.md`](onboarding.md) §3.

## 3. Eigener OpenAI-kompatibler Endpunkt (llama.cpp, LM Studio, Ollama, vLLM)

```bash
./setup.sh --adapter=openai --base-url=http://127.0.0.1:8080/v1 --model=<exakte-modell-id>
```

`baseUrl` mit `/v1`, Modell-ID exakt wie der Server sie meldet. Das ist ein
Chat-Client ohne Coding-Werkzeuge; für Coding mit lokalem Modell einen
Harness konfigurieren ([`local-llm.md`](local-llm.md)). Status des Adapters:
README-Matrix (unproven heißt: nicht belegt).

## 4. Prüfen

Hub neu starten (`scripts/hub.sh stop && scripts/hub.sh start`), dann:

```bash
node apps/hubctl/src/cli.ts adapters
```

Der neue Adapter muss in der Liste stehen. Eine kurze Session in der PWA
(**Neue Session**) zeigt, ob der Agent wirklich antwortet — nur das ist der
Beleg für die Anmeldung.
