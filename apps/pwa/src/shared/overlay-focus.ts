import { useEffect, useRef } from "preact/hooks";

/**
 * EPIC-P51 T51.6: Fokus-Disziplin für Overlays/Panelen — beim Öffnen Fokus
 * rein (bevorzugt `preferred`, sonst erstes fokussierbares Element), Tab
 * bleibt im Blatt (Falle), beim Schließen geht der Fokus an den Auslöser
 * zurück. Vorbild: Nyx-Blatt (T43.9), jetzt als gemeinsamer Hook.
 */

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function useOverlayFocus<T extends HTMLElement>(open: boolean, opts?: { preferred?: () => HTMLElement | null }) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const preferred = opts?.preferred?.() ?? null;
    const target = preferred ?? focusables(ref.current)[0] ?? ref.current;
    target?.focus?.();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables(ref.current);
      if (items.length === 0 && ref.current) {
        e.preventDefault();
        ref.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !ref.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    ref.current?.addEventListener("keydown", onKey);
    return () => {
      ref.current?.removeEventListener("keydown", onKey);
      // Fokus zurück — nur wenn der Auslöser noch lebt (Nyx-Muster).
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);
  return { ref };
}
