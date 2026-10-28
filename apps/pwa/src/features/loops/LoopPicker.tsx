import { useEffect, useState } from "preact/hooks";
import type { LoopInfo, LoopSpec } from "@uacc/contracts";
import type { hubApi } from "../../shared/api.ts";

/**
 * EPIC-P19: Auswahl „Loop / Dark Factory“ im Start-Formular. Die Liste kommt
 * vom Hub (Fähigkeiten, nie festverdrahtet); ein Loop ohne Connector bleibt
 * sichtbar und gesperrt, mit dem Grund daneben — kein stilles Verschwinden.
 */
export function LoopPicker({
  api,
  value,
  onChange,
}: {
  api: Pick<typeof hubApi, "loops">;
  value: LoopSpec | null;
  onChange: (next: LoopSpec | null) => void;
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
  }, [api]);
  if (!loops || loops.length === 0) return null;

  const chosen = value ? loops.find((l) => l.id === value.id) : undefined;
  const blocked = loops.filter((l) => !l.available);
  return (
    <div class="loop-picker">
      <label>
        Loop
        <select
          aria-label="Loop"
          value={value?.id ?? ""}
          onChange={(e) => {
            const id = (e.target as HTMLSelectElement).value;
            const next = loops.find((l) => l.id === id);
            // Voreinstellungen der Optionen kommen vom Loop; `dark` o. Ä. ist nie die Vorgabe.
            onChange(next ? { id: next.id, options: Object.fromEntries(next.options.map((o) => [o.key, o.default])) } : null);
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
      {chosen?.options.map((o) => (
        <label key={o.key}>
          {o.label}
          <select
            aria-label={o.label}
            value={value?.options?.[o.key] ?? o.default}
            onChange={(e) => onChange({ id: chosen.id, options: { ...value?.options, [o.key]: (e.target as HTMLSelectElement).value } })}
          >
            {o.values.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      ))}
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
