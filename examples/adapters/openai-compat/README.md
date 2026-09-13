# Example adapter: OpenAI-compatible endpoint

Zeigt, wie man **einen eigenen Endpunkt** (Provider, Coding-Tool oder lokales
Coding-System) an den Hub anbindet — ohne den Hub selbst anzufassen.

Kompatibel mit allem, was `/v1/chat/completions` (Streaming) spricht:
llama.cpp server · LM Studio · Ollama · vLLM · Gateway-Proxys.

## Anbinden

1. Config erweitern (Datei: `hub.config.json`, liegt neben dem Adapter-Pfad):

```json
{
  "adapters": [
    {
      "id": "my-endpoint",
      "module": "./examples/adapters/openai-compat/adapter.ts",
      "config": {
        "baseUrl": "http://127.0.0.1:8080/v1",
        "model": "qwen2.5-coder:14b",
        "apiKeyEnv": "LOCAL_LLM_API_KEY"
      }
    }
  ]
}
```

2. Hub neu starten — der Adapter erscheint in `GET /api/adapters` und in der
   Session-Erstellung der PWA.

3. Contract-Tests laufen lassen (Pflicht vor Contribution):

```ts
import { runContractTests, assertContractGreen } from "@uacc/adapter-testkit";
import { createAdapter } from "./adapter.ts";

const results = await runContractTests(createAdapter);
assertContractGreen(results);
```

## Regeln

- Nur `@uacc/contracts` importieren — alles andere kommt über `AdapterContext`.
- Große Outputs (Reasoning, Tool-Output) via `ctx.blob()` auslagern (K5).
- `ctx.signal` respektieren — Stop/Park muss sofort durchgreifen.
- `capabilities()` ehrlich ausfüllen — sie ist ein Versprechen, kein Marketing.
