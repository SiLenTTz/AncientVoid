import { useState } from "preact/hooks";

/** T8.4: frequent replies one tap away — they fill the field, never send. */
const KEY = "ancientvoid.templates";
const DEFAULTS = ["Weiter", "Führe die Tests aus und behebe Fehler", "Fasse den Stand kurz zusammen"];

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function ReplyTemplates({ value, onPick }: { value: string; onPick: (text: string) => void }) {
  const [templates, setTemplates] = useState(load);
  const save = (next: string[]) => {
    setTemplates(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };
  const text = value.trim();
  if (text) {
    if (templates.includes(text) || text.length > 200) return null;
    return (
      <div class="reply-templates">
        <button type="button" class="chip subtle" onClick={() => save([text, ...templates].slice(0, 12))}>
          + als Vorlage merken
        </button>
      </div>
    );
  }
  return (
    <div class="reply-templates" role="list" aria-label="Antwortvorlagen">
      {templates.map((t) => (
        <span key={t} class="template-chip" role="listitem">
          <button type="button" class="chip" onClick={() => onPick(t)}>
            {t}
          </button>
          {!DEFAULTS.includes(t) && (
            <button type="button" class="template-remove" aria-label={`Vorlage „${t}“ entfernen`} onClick={() => save(templates.filter((x) => x !== t))}>
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
