/**
 * T1.5-6 — the shared prompt-entry surface, used both when creating a
 * session (App.tsx) and as a follow-up reply in a running one
 * (SessionTail.tsx). Only the text field + its action row (mic, enhance)
 * live here; each caller supplies its own submit trigger, since "Starten"
 * (bundled with adapter+project) and "Senden" (text alone) are different
 * actions that happen to share the same input surface.
 *
 * The mic and "Verbessern" buttons are deliberate, visible placeholders —
 * T1.5-7 and T1.5-8 wire them up. Disabled + labeled, never a silent
 * dead button that looks broken.
 */
export function Composer({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div class="composer">
      <textarea
        class="composer-input"
        value={value}
        onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
      />
      <div class="composer-actions">
        <button class="btn" type="button" disabled title="Spracheingabe (T1.5-7, noch nicht verfügbar)">
          🎤
        </button>
        <button class="btn" type="button" disabled title="Prompt-Enhancer (T1.5-8, noch nicht verfügbar)">
          ✨ Verbessern
        </button>
      </div>
    </div>
  );
}
