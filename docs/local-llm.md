# Lokales Modell (T7.5)

Ein lokales Coding-Modell, das echte Harnesses (opencode, dsh) mit Tools
bedienen — ohne Cloud, ohne Kosten pro Token. Entscheidung 2026-09-23:
**llama.cpp** (nicht Ollama, nicht vLLM): auf evox2 (AMD Strix Halo, RDNA
3.5, 123 GB Unified Memory) läuft das fertige Vulkan-Build ohne ROCm-Stack,
MoE-Modelle mit wenigen aktiven Parametern sind dort am schnellsten, und der
Server spricht die OpenAI-API inkl. Tool-Calls (`--jinja`).

## Betrieb auf evox2

| | |
|---|---|
| Binärdatei | `~/uacc-llm/llama/llama-server` (llama.cpp b11149, Linux Vulkan x64) |
| Modell | `~/uacc-llm/models/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf` (Unsloth, 17,7 GB) |
| Alias | `qwen3-coder` |
| Adresse | `http://100.65.133.28:8081/v1` — nur Tailnet-IP |
| Schlüssel | `~/uacc-llm/key` (0600), per `--api-key-file` (nicht in der Prozessliste) |
| Unit | `systemctl --user {status,restart} uacc-llama` (Linger aktiv) |

```ini
# ~/.config/systemd/user/uacc-llama.service
[Service]
WorkingDirectory=%h/uacc-llm/llama
Environment=LD_LIBRARY_PATH=%h/uacc-llm/llama
ExecStart=%h/uacc-llm/llama/llama-server -m %h/uacc-llm/models/Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf --alias qwen3-coder --host 100.65.133.28 --port 8081 --api-key-file %h/uacc-llm/key --jinja -ngl 99 -c 65536 --parallel 2 -fa on --metrics
Restart=on-failure
```

**Geteilte Maschine:** `halogen-starten.sh` (securesight, Halogen) beendet
beim Start *alle* `llama-server`, um Speicher freizumachen — auch diesen.
Das ist gewollt und wird nicht bekämpft (`Restart=on-failure` startet nach
einem sauberen Beenden nicht neu). Danach: `systemctl --user start
uacc-llama`. Der RAG-Dienst auf Port 8001 bleibt unberührt.

Durchsatz und Messbedingungen: [Messlauf P7](messlauf/2026-09-24-p7-harness-gates.md)
(Median 82 tok/s Erzeugung, 58 tok/s mit ≈ 8k Kontext).

## Harnesses anbinden

**opencode (ACP)** — Provider über `OPENCODE_CONFIG_CONTENT`:

```json
{
  "id": "opencode-lokal",
  "module": "@uacc/adapter-acp",
  "config": {
    "preset": "opencode",
    "label": "opencode+lokal",
    "env": { "OPENCODE_CONFIG_CONTENT": "{\"permission\":{\"edit\":\"ask\",\"bash\":\"ask\",\"webfetch\":\"ask\"},\"provider\":{\"evox2\":{\"npm\":\"@ai-sdk/openai-compatible\",\"options\":{\"baseURL\":\"http://100.65.133.28:8081/v1\",\"apiKey\":\"{env:LLAMA_KEY}\"},\"models\":{\"qwen3-coder\":{\"tool_call\":true}}}},\"model\":\"evox2/qwen3-coder\"}" }
  }
}
```

**dsh (DeepSeek-Harness, ACP)** — Route in `$DSH_HOME/settings.yaml`, der
Schlüssel bleibt in der Umgebung (`apiKeyEnv`):

```yaml
llm-pi-ai:
  providers:
    evox2:
      displayName: evox2 llama.cpp
      apiKeyEnv: LLAMA_KEY
      api: openai-completions
      baseURL: http://100.65.133.28:8081/v1
      models:
        - id: qwen3-coder
          contextWindow: 65536
```

```json
{ "id": "dsh-lokal", "module": "@uacc/adapter-acp", "config": { "preset": "dsh", "model": "evox2/qwen3-coder", "env": { "DSH_HOME": "/pfad/zu/dsh-home" } } }
```

Das Modell wird beim Start über ACP `session/set_config_option` gewählt
(`provider/modell` passt auf dsh-Werte wie `["evox2","qwen3-coder"]`); ein
nicht angebotenes Modell bricht den Start sichtbar ab. dsh bekommt vom
Preset `DSH_PERMISSION_MODE=read-only`: Lesen läuft in der OS-Sandbox,
alles Weitere fragt am Handy.

## Was fehlt

- **aider** mit dem lokalen Modell nicht live abgenommen (aider hat kein
  Tool-Gate, `--yes-always`).
- Nur ein Modell geladen; größere (Qwen3.5-122B-A10B) laufen auf evox2,
  gehören aber zu anderen Diensten.
