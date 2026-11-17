import { useEffect, useState } from "preact/hooks";
import type { AdapterInfo, HubApi, SessionRecord } from "../../shared/api.ts";
import { HANDOVER_CATEGORIES, type ProviderFailure } from "./handover.ts";
import { Button } from "../../shared/ui/index.ts";

/**
 * EPIC-P21 T21.2: a provider failure (login expired, rate limit, quota) is shown in words, and the work can
 * move to another provider/harness/model with one tap. Nothing switches silently: the target is chosen and the
 * text the next agent starts from is shown, editable, before anything starts.
 */
export function HandoverBar({ failure, session, api, onHandedOver, onRepaired }: { failure: ProviderFailure; session: SessionRecord; api: HubApi; onHandedOver: (created: SessionRecord) => void; onRepaired: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!HANDOVER_CATEGORIES.has(failure.category)) return null;
  const repair = async () => {
    setRepairing(true);
    setError(null);
    try {
      const ack = await api.repairSession(session.id);
      if (!ack.ok) throw new Error(ack.detail ?? "Reparieren fehlgeschlagen.");
      await onRepaired();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRepairing(false);
    }
  };
  return (
    <div class="handover-bar" role="alert">
      <div >
        <strong>{failure.title}</strong>
        <span class="dim"> — {failure.detail}</span>
      </div>
      {failure.category === "session" && (
        <Button  disabled={repairing} onClick={() => void repair()} variant="primary" class={repairing ? "busy" : undefined}>
          {repairing ? "repariert…" : "Hier weitermachen (Kontext neu aufbauen)"}
        </Button>
      )}
      {!open && (
        <Button onClick={() => setOpen(true)}>
          An andere Session übergeben…
        </Button>
      )}
      {open && <HandoverForm session={session} api={api} onCancel={() => setOpen(false)} onHandedOver={onHandedOver} />}
      {error && <div class="error">{error}</div>}
    </div>
  );
}

export function HandoverForm({ session, api, onCancel, onHandedOver }: { session: SessionRecord; api: HubApi; onCancel: () => void; onHandedOver: (created: SessionRecord) => void }) {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [target, setTarget] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [tightening, setTightening] = useState(false);
  // Der Text vor dem Straffen — „Rückgängig“ stellt ihn wieder her.
  const [beforeTighten, setBeforeTighten] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.adapters().then((all) => alive && setAdapters(all.filter((a) => a.id !== session.adapter && a.capabilities.features.followUp !== undefined))).catch(() => undefined);
    api.handoverDraft(session.id).then((d) => alive && setPrompt(d.prompt)).catch((e) => alive && setError(String(e instanceof Error ? e.message : e)));
    return () => {
      alive = false;
    };
  }, [api, session.id, session.adapter]);

  const chosen = adapters.find((a) => a.id === target);
  const canPickModel = chosen?.capabilities.features.modelChoice === "start";
  useEffect(() => {
    setModel("");
    setModels([]);
    if (!target || !canPickModel) return;
    let alive = true;
    api.adapterModels(target).then((r) => alive && setModels(r.models ?? [])).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, target, canPickModel]);

  // Optional und nur auf Klick: das Ziel-Modell formuliert den Text neu. Der Text geht dafür an dieses Ziel
  // (ADR-0039: ohnehin das, was es als erste Eingabe bekäme); die Schwärzung von Schlüsseln lief schon im Entwurf.
  const tighten = async () => {
    setTightening(true);
    setError(null);
    try {
      const result = await api.enhancePrompt(target, session.project, prompt);
      setBeforeTighten(prompt);
      setPrompt(result.enhanced.slice(0, 3500));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Straffen fehlgeschlagen");
    } finally {
      setTightening(false);
    }
  };

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      onHandedOver(await api.handover(session.id, { adapter: target, ...(canPickModel && model ? { model } : {}), prompt }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div class="handover-form">
      <label>
        Ziel
        <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)} aria-label="Ziel-Provider">
          <option value="">— wählen —</option>
          {adapters.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id}
            </option>
          ))}
        </select>
      </label>
      {canPickModel && (
        <label>
          Modell
          <select value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)} aria-label="Ziel-Modell">
            <option value="">Standard des Harness</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Übergabetext (wird als erste Eingabe gesendet)
        <textarea rows={8} value={prompt} onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)} aria-label="Übergabetext" maxLength={3500} />
      </label>
      {error && <div class="error">{error}</div>}
      <div class="approval-actions">
        <Button  disabled={busy || tightening || !target || !prompt.trim()} onClick={() => void tighten()} title={target ? `Der Text geht dafür an ${target}` : "Zuerst ein Ziel wählen"} class={tightening ? "busy" : undefined}>
          {tightening ? "formuliert…" : "Mit Modell straffen"}
        </Button>
        {beforeTighten !== null && (
          <Button onClick={() => { setPrompt(beforeTighten); setBeforeTighten(null); }}>
            Rückgängig
          </Button>
        )}
        <Button  disabled={busy || !target || !prompt.trim()} onClick={() => void go()} variant="primary" class={busy ? "busy" : undefined}>
          {busy ? "startet…" : "Übergeben"}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}
