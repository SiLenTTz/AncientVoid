/**
 * Letztes editierbares Feld merken (FAB stiehlt Fokus) und Text einfügen + Zwischenablage.
 */

let lastEditable: HTMLElement | null = null;

function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    const t = el.type;
    return t === "text" || t === "search" || t === "url" || t === "tel" || t === "email" || t === "password" || t === "" || t === "number";
  }
  return false;
}

/** Einmal am App-Root starten — ignoriert den Nyx-FAB selbst. */
export function installFocusTracker(): () => void {
  const on = (e: FocusEvent) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.closest("[data-nyx-fab]")) return;
    if (isEditable(t)) lastEditable = t;
  };
  document.addEventListener("focusin", on, true);
  return () => document.removeEventListener("focusin", on, true);
}

export function currentPasteTarget(): HTMLElement | null {
  if (lastEditable && document.contains(lastEditable) && isEditable(lastEditable)) return lastEditable;
  const a = document.activeElement;
  return isEditable(a) ? a : null;
}

function appendAtCursor(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const gap = before.length > 0 && !/\s$/.test(before) && !/^\s/.test(text) ? " " : "";
  const next = `${before}${gap}${text}${after}`;
  el.value = next;
  const pos = before.length + gap.length + text.length;
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function appendContentEditable(el: HTMLElement, text: string): void {
  el.focus();
  const ok = document.execCommand?.("insertText", false, text);
  if (!ok) {
    el.append(document.createTextNode(text));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/** Transkript ins fokussierte Feld und in die Zwischenablage. */
export async function pasteTranscript(text: string): Promise<"pasted" | "clipboard-only" | "nowhere"> {
  const trimmed = text.trim();
  if (!trimmed) return "nowhere";
  let pasted = false;
  const target = currentPasteTarget();
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    appendAtCursor(target, trimmed);
    pasted = true;
  } else if (target?.isContentEditable) {
    appendContentEditable(target, trimmed);
    pasted = true;
  }
  let clipped = false;
  try {
    await navigator.clipboard.writeText(trimmed);
    clipped = true;
  } catch {
    // Clipboard kann fehlen (unsicherer Kontext) — Einfügen zählt trotzdem.
  }
  if (pasted) return "pasted";
  if (clipped) return "clipboard-only";
  return "nowhere";
}
