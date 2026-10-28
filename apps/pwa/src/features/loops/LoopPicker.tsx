import { useEffect, useState } from "preact/hooks";
import type { LoopInfo, LoopSpec } from "@uacc/contracts";
import type { hubApi } from "../../shared/api.ts";
import { defaultLoopSpec, isOnboarding, type OnboardDraft } from "./loop-form.ts";

/**
 * EPIC-P19: Auswahl „Loop / Dark Factory“ im Start-Formular. Die Liste und alle Felder kommen vom Hub
 * (Fähigkeiten des Connectors, nie festverdrahtet). Ein Loop ohne Connector bleibt sichtbar und gesperrt,
 * mit dem Grund daneben — kein stilles Verschwinden. Betriebsarten mit Außenwirkung brauchen ein Häkchen.
 */
export function LoopPicker({
  api,
  value,
  confirmed,
  onChange,
  onConfirmed,
  onboard,
  onOnboard,
  reload = 0,
}: {
  api: Pick<typeof hubApi, "loops">;
  value: LoopSpec | null;
  confirmed: boolean;
  onChange: (next: LoopSpec | null, info: LoopInfo | null) => void;
  onConfirmed: (yes: boolean) => void;
  onboard: OnboardDraft;
  onOnboard: (next: OnboardDraft) => void;
  /** Wird hochgezählt, wenn sich die Linien geändert haben (nach dem Anbinden). */
  reload?: number;
}) {
  const [loops, setLoops] = useState<LoopInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    api
      .loops()
      // Ältere Hubs kennen die Route nicht: dann gibt es die Zeile schlicht nicht.
      .then((l) => live && setLoops(l))
      .catch(() => live && setLoops([]));
    return () => {
      live = false;
    };
  }, [api, reload]);
  if (!loops || loops.length === 0) return null;

  const chosen = value ? loops.find((l) => l.id === value.id) : undefined;
  const caps = chosen?.capabilities ?? null;
  const set = (patch: Partial<LoopSpec>) => value && chosen && onChange({ ...value, ...patch }, chosen);
  const setOption = (key: string, v: string) => set({ options: { ...value?.options, [key]: v } });
  const risky = !!(value?.mode && caps?.riskyModes.includes(value.mode));
  const blocked = loops.filter((l) => !l.available);

  return (
    <div class="loop-picker">
      <label>
        Loop
        <select
          aria-label="Loop"
          value={value?.id ?? ""}
          onChange={(e) => {
            const next = loops.find((l) => l.id === (e.target as HTMLSelectElement).value);
            onConfirmed(false);
            onChange(next ? defaultLoopSpec(next) : null, next ?? null);
          }}
        >
          <option value="">kein Loop</option>
          {loops.map((l) => (
            <option key={l.id} value={l.id} disabled={!l.available}>
              {l.label}
              {l.available ? "" : " (nicht verbunden)"}
            </option>
          ))}
        </select>
      </label>
      {caps && value && (
        <>
          <div class="dim loop-note">Adapter, Modell und Modus bestimmt der Loop selbst.</div>
          {caps.modes.length > 0 && (
            <label>
              Betriebsart
              <select
                aria-label="Betriebsart"
                value={value.mode ?? ""}
                onChange={(e) => {
                  onConfirmed(false);
                  set({ mode: (e.target as HTMLSelectElement).value });
                }}
              >
                {caps.modes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                    {caps.riskyModes.includes(m) ? " (ändert Fremdsysteme)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {caps.orchestrators.length > 0 && (
            <label>
              Orchestrator
              <select aria-label="Orchestrator" value={value.orchestrator ?? ""} onChange={(e) => set({ orchestrator: (e.target as HTMLSelectElement).value })}>
                {caps.orchestrators.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          )}
          {caps.options.map((o) => (
            <label key={o.key}>
              {o.label}
              {o.required ? " *" : ""}
              {o.kind === "select" ? (
                <select aria-label={o.label} value={value.options?.[o.key] ?? ""} onChange={(e) => setOption(o.key, (e.target as HTMLSelectElement).value)}>
                  {o.choices?.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : o.kind === "toggle" ? (
                <input type="checkbox" aria-label={o.label} checked={value.options?.[o.key] === "true"} onChange={(e) => setOption(o.key, (e.target as HTMLInputElement).checked ? "true" : "false")} />
              ) : (
                <input type="text" aria-label={o.label} placeholder={o.placeholder ?? ""} value={value.options?.[o.key] ?? ""} onInput={(e) => setOption(o.key, (e.target as HTMLInputElement).value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
              )}
            </label>
          ))}
          {caps.onboarding && isOnboarding(chosen ?? null, value) && (
            <fieldset class="loop-onboard">
              <legend>{caps.onboarding.label}</legend>
              {caps.onboarding.fields.map((f) => (
                <label key={f.key}>
                  {f.label}
                  {f.required ? " *" : ""}
                  {f.kind === "select" ? (
                    <select aria-label={f.label} value={onboard.values[f.key] ?? f.choices?.[0]?.value ?? ""} onChange={(e) => onOnboard({ ...onboard, values: { ...onboard.values, [f.key]: (e.target as HTMLSelectElement).value } })}>
                      {f.choices?.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input type="text" aria-label={f.label} placeholder={f.placeholder ?? ""} value={onboard.values[f.key] ?? ""} onInput={(e) => onOnboard({ ...onboard, values: { ...onboard.values, [f.key]: (e.target as HTMLInputElement).value } })} autocapitalize="off" autocorrect="off" spellcheck={false} />
                  )}
                </label>
              ))}
              <label>
                {caps.onboarding.secret.label} *
                <input type="password" aria-label={caps.onboarding.secret.label} autocomplete="off" value={onboard.secret} onInput={(e) => onOnboard({ ...onboard, secret: (e.target as HTMLInputElement).value })} />
              </label>
              {caps.onboarding.secret.hint && <div class="dim">{caps.onboarding.secret.hint}</div>}
              <div class="dim">Beim Starten legt der Hub die Linie an (factoryctl) und startet dann die Session. Das Token wird nicht gespeichert.</div>
            </fieldset>
          )}
          {risky && (
            <label class="loop-confirm">
              <input type="checkbox" aria-label="Außenwirkung bestätigen" checked={confirmed} onChange={(e) => onConfirmed((e.target as HTMLInputElement).checked)} />
              In „{value.mode}“ ändert der Loop Fremdsysteme (z. B. Merges). Ich weiß das und will starten.
            </label>
          )}
        </>
      )}
      {blocked.length > 0 && (
        <ul class="loop-reasons dim">
          {blocked.map((l) => (
            <li key={l.id}>
              {l.label}: {l.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
