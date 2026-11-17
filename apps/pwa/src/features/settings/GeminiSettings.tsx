import { useEffect, useState } from "preact/hooks";
import { SettingRow, SettingsSection } from "./parts.tsx";
import { hubApi } from "../../shared/api.ts";

/**
 * T7.10: the Gemini key for reading images and scans the local OCR can't.
 * Write-only — the hub says whether a key is set, never which one. Files
 * go to Google only with a key, and only when local tools found no text.
 */
export function GeminiSettings() {
  const [state, setState] = useState<{ configured: boolean; model: string } | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hubApi
      .settings()
      .then((s) => {
        setState(s.gemini);
        setModel(s.gemini.model);
      })
      .catch(() => setState(null));
  }, []);

  const save = async (body: { apiKey?: string | null; model?: string }) => {
    setBusy(true);
    setMessage(null);
    try {
      const s = await hubApi.setGemini(body);
      setState(s.gemini);
      setKey("");
      setMessage({ ok: true, text: body.apiKey === null ? "Schlüssel entfernt." : "Gespeichert." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Speichern fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Dienste" testid="gemini-settings">
      <SettingRow label="Gemini · Bilder und Scans lesen">
        <span class={state?.configured ? "gemini-state ok" : "gemini-state dim"}>{state === null ? "…" : state.configured ? "Schlüssel hinterlegt ✓" : "kein Schlüssel"}</span>
      </SettingRow>
      <div class="dim settings-intro">
        Nur wenn die lokale Auslese (OCR, PDF, Office) nichts findet, geht die Datei an Google. Kostenloser Schlüssel: aistudio.google.com → „Get API key“.
      </div>
      <label>
        API-Schlüssel
        <input type="password" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} placeholder={state?.configured ? "neuen Schlüssel eingeben, um ihn zu ersetzen" : "AIza…"} autocomplete="off" />
      </label>
      <label>
        Modell
        <input value={model} onInput={(e) => setModel((e.target as HTMLInputElement).value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
      </label>
      <div class="row" style="gap: 8px">
        <button class={busy ? "btn primary busy" : "btn primary"} type="button" disabled={busy || (!key.trim() && model === state?.model)} onClick={() => void save({ ...(key.trim() ? { apiKey: key.trim() } : {}), ...(model.trim() && model !== state?.model ? { model: model.trim() } : {}) })}>
          Speichern
        </button>
        {state?.configured && (
          <button class="btn danger" type="button" disabled={busy} onClick={() => void save({ apiKey: null })}>
            Schlüssel entfernen
          </button>
        )}
      </div>
      {message && <div class={message.ok ? "fleet-message ok" : "fleet-message reply-error"}>{message.text}</div>}
    </SettingsSection>
  );
}
