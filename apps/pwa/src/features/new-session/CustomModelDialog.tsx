import { useEffect, useState } from "preact/hooks";
import type { CustomModel, PiProviderBody } from "../../shared/api.ts";

type Api = {
  customModels: () => Promise<{ items: CustomModel[] }>;
  addCustomModel: (body: { id: string; label?: string; adapters: string[] }) => Promise<unknown>;
  removeCustomModel: (id: string) => Promise<unknown>;
  addPiProvider: (adapterId: string, body: PiProviderBody) => Promise<{ created: boolean }>;
};

/**
 * ADR-0060: eigene Modelle und Endpunkte, direkt am Modell-Dropdown. „Modell“ trägt eine Id ins
 * Hub-Register ein (der Harness bekommt sie unverändert als --model); „Endpunkt“ (nur pi) schreibt
 * einen Provider in pi's models.json — der Schlüssel steht als $UMGEBUNGSVARIABLE, nie im Klartext
 * im Hub.
 */
export function CustomModelDialog({ adapter, canEndpoint, api, onClose, onChanged }: { adapter: string; canEndpoint: boolean; api: Api; onClose: () => void; onChanged: (pick?: string) => void }) {
  const [tab, setTab] = useState<"model" | "endpoint">("model");
  const [items, setItems] = useState<CustomModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Modell
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [everywhere, setEverywhere] = useState(false);
  // Endpunkt
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKind, setApiKind] = useState<PiProviderBody["api"]>("openai-completions");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [context, setContext] = useState("");
  const [reasoning, setReasoning] = useState(false);
  const [replace, setReplace] = useState(false);

  const reload = () => api.customModels().then((r) => setItems(r.items)).catch(() => undefined);
  useEffect(() => void reload(), []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const saveModel = () =>
    run(async () => {
      await api.addCustomModel({ id: id.trim(), ...(label.trim() ? { label: label.trim() } : {}), adapters: everywhere ? [] : [adapter] });
      onChanged(id.trim());
      setId("");
      setLabel("");
      await reload();
      setNote("Gespeichert — das Modell steht jetzt im Dropdown.");
    });

  const saveEndpoint = () =>
    run(async () => {
      const ctx = Number(context);
      const res = await api.addPiProvider(adapter, {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        api: apiKind,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        models: [{ id: modelId.trim(), ...(Number.isFinite(ctx) && ctx > 0 ? { contextWindow: ctx } : {}), ...(reasoning ? { reasoning: true } : {}) }],
        ...(replace ? { replace: true } : {}),
      });
      onChanged(`${name.trim()}/${modelId.trim()}`);
      await reload();
      setNote(res.created ? "Endpunkt in pi eingetragen — das Modell steht im Dropdown." : "Endpunkt in pi ersetzt.");
    });

  const field = "display: grid; gap: 4px; font-size: calc(13px * var(--font-scale, 1))";
  const exists = /schon/.test(error ?? "");

  return (
    <div class="modal custom-model-dialog" role="dialog" aria-label="Eigenes Modell oder Endpunkt">
      <div class="modal-card">
        <h3>Eigenes Modell oder Endpunkt</h3>
        {canEndpoint && (
          <div class="row" role="tablist">
            <button class={tab === "model" ? "btn primary" : "btn"} type="button" role="tab" aria-selected={tab === "model"} onClick={() => setTab("model")}>
              Modell
            </button>
            <button class={tab === "endpoint" ? "btn primary" : "btn"} type="button" role="tab" aria-selected={tab === "endpoint"} onClick={() => setTab("endpoint")}>
              Endpunkt (pi)
            </button>
          </div>
        )}
        {tab === "model" || !canEndpoint ? (
          <>
            <label style={field}>
              Modell-Id
              <input value={id} onInput={(e) => setId((e.target as HTMLInputElement).value)} placeholder="anthropic/claude-opus-5-5" autocapitalize="off" autocorrect="off" spellcheck={false} />
            </label>
            <label style={field}>
              Anzeigename (optional)
              <input value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} placeholder="Opus 5.5" />
            </label>
            <label class="row" style="gap: 8px; font-size: calc(13px * var(--font-scale, 1))">
              <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere((e.target as HTMLInputElement).checked)} />
              in allen Harnesses anbieten (sonst nur in {adapter})
            </label>
            <div class="dim" style="font-size: calc(12px * var(--font-scale, 1))">
              Der Hub reicht die Id unverändert weiter. Kennt der Harness sie nicht oder fehlt die Anmeldung beim Anbieter, scheitert der Zug sichtbar — es läuft nie ein anderes Modell.
            </div>
            <div class="modal-actions">
              <button class="btn primary" type="button" disabled={busy || !id.trim()} onClick={() => void saveModel()}>
                {busy ? "lädt…" : "Speichern"}
              </button>
            </div>
          </>
        ) : (
          <>
            <label style={field}>
              Name des Providers
              <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="gpubox" autocapitalize="off" spellcheck={false} />
            </label>
            <label style={field}>
              Basis-URL
              <input value={baseUrl} onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)} placeholder="http://100.64.0.10:8100/v1" inputMode="url" autocapitalize="off" spellcheck={false} />
            </label>
            <label style={field}>
              Schnittstelle
              <select value={apiKind} onChange={(e) => setApiKind((e.target as HTMLSelectElement).value as PiProviderBody["api"])}>
                <option value="openai-completions">OpenAI-kompatibel</option>
                <option value="anthropic-messages">Anthropic-kompatibel</option>
                <option value="google-generative-ai">Google-kompatibel</option>
              </select>
            </label>
            <label style={field}>
              API-Schlüssel (optional, als $UMGEBUNGSVARIABLE)
              <input value={apiKey} onInput={(e) => setApiKey((e.target as HTMLInputElement).value)} placeholder="$GPUBOX_KEY" autocapitalize="off" spellcheck={false} />
            </label>
            <label style={field}>
              Modell-Id am Endpunkt
              <input value={modelId} onInput={(e) => setModelId((e.target as HTMLInputElement).value)} placeholder="halogen-qwen3.8-flash-next-uncensored-iq4xs" autocapitalize="off" spellcheck={false} />
            </label>
            <label style={field}>
              Kontextfenster in Tokens (optional)
              <input value={context} onInput={(e) => setContext((e.target as HTMLInputElement).value)} inputMode="numeric" placeholder="131072" />
            </label>
            <label class="row" style="gap: 8px; font-size: calc(13px * var(--font-scale, 1))">
              <input type="checkbox" checked={reasoning} onChange={(e) => setReasoning((e.target as HTMLInputElement).checked)} />
              Modell denkt (Reasoning)
            </label>
            {exists && (
              <label class="row" style="gap: 8px; font-size: calc(13px * var(--font-scale, 1))">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace((e.target as HTMLInputElement).checked)} />
                den bestehenden Provider in pi ersetzen
              </label>
            )}
            <div class="dim" style="font-size: calc(12px * var(--font-scale, 1))">
              Schreibt in pi's models.json (mit Sicherung davor). Andere Provider dort bleiben unberührt; pi lädt die Datei beim Öffnen der Modellwahl neu.
            </div>
            <div class="modal-actions">
              <button class="btn primary" type="button" disabled={busy || !name.trim() || !baseUrl.trim() || !modelId.trim()} onClick={() => void saveEndpoint()}>
                {busy ? "lädt…" : "Eintragen"}
              </button>
            </div>
          </>
        )}
        {error && <div class="composer-notice err">{error}</div>}
        {note && <div class="composer-notice">{note}</div>}
        {items.length > 0 && (
          <div class="custom-model-list">
            <strong style="font-size: calc(13px * var(--font-scale, 1))">Eigene Modelle</strong>
            {items.map((m) => (
              <div key={m.id} class="row" style="justify-content: space-between; gap: 8px">
                <span class="mono" style="overflow-wrap: anywhere; font-size: calc(12px * var(--font-scale, 1))">
                  {m.label ? `${m.label} · ` : ""}
                  {m.id}
                  <span class="dim"> {m.adapters.length === 0 ? "(alle)" : `(${m.adapters.join(", ")})`}</span>
                </span>
                <button class="btn" type="button" aria-label={`${m.id} entfernen`} disabled={busy} onClick={() => void run(async () => (await api.removeCustomModel(m.id), onChanged(), reload()))}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div class="modal-actions">
          <button class="btn" type="button" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
