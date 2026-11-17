import type { ComponentChildren } from "preact";

/**
 * EPIC-P63 T63.7: Leerzustand nach Kleinkram-Regel 2 — sagt in einem Satz,
 * was fehlt, und bietet eine Aktion. Stile: styles/ui/empty.css.
 */
export interface EmptyStateProps {
  /** Sinnbild des Fehlenden (Symbol oder kurzes Zeichen). */
  icon?: ComponentChildren;
  /** Der eine Satz, der sagt, was fehlt. */
  text: string;
  /** Die Aktion, die weiterhilft (z. B. ein Button). */
  action?: ComponentChildren;
  class?: string;
}

export function EmptyState({ icon, text, action, class: cls }: EmptyStateProps) {
  return (
    <div class={["ui-empty", cls].filter(Boolean).join(" ")} role="status">
      {icon && <div class="ui-empty-icon" aria-hidden="true">{icon}</div>}
      <p class="ui-empty-text">{text}</p>
      {action && <div class="ui-empty-action">{action}</div>}
    </div>
  );
}
