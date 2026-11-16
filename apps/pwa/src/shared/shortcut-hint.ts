import { shortcut } from "./shortcuts/registry.ts";

/**
 * EPIC-P51 T51.8: Lernende Kürzel-Hinweise — klickt der Mensch auf ein
 * Element mit registriertem Shortcut (`data-shortcut="<id>"`), zeigt eine
 * Pill unten mittig die Kombination (~2 s, .copy-flash-Muster, max. eine,
 * nie blockierend). Klicks ohne Kürzel bleiben still; das Setting schaltet
 * das Ganze device-lokal ab (Standard: an, Lernphase).
 */

const HINTS_KEY = "ancientvoid.shortcutHints";
const HINT_MS = 2000;

export function shortcutHintsOn(): boolean {
  return localStorage.getItem(HINTS_KEY) !== "0";
}

export function applyShortcutHints(on: boolean): void {
  if (on) localStorage.removeItem(HINTS_KEY);
  else localStorage.setItem(HINTS_KEY, "0");
}

export function installShortcutHints(): () => void {
  let pill: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hide = () => {
    pill?.remove();
    pill = null;
  };
  const onClick = (e: Event) => {
    if (!shortcutHintsOn()) return;
    const trigger = (e.target as Element | null)?.closest?.("[data-shortcut]");
    if (!(trigger instanceof Element)) return;
    const info = shortcut(trigger.getAttribute("data-shortcut") ?? "");
    if (!info) return; // Aktion ohne Kürzel: still (Nutzerentscheid 11.11.2026)
    hide();
    if (timer) clearTimeout(timer);
    pill = document.createElement("div");
    pill.className = "copy-flash shortcut-pill";
    pill.dataset.testid = "shortcut-hint";
    pill.setAttribute("role", "status");
    pill.textContent = info.label;
    document.body.appendChild(pill);
    timer = setTimeout(() => {
      hide();
      timer = null;
    }, HINT_MS);
  };
  document.addEventListener("click", onClick, { capture: true });
  return () => {
    document.removeEventListener("click", onClick, { capture: true });
    if (timer) clearTimeout(timer);
    hide();
  };
}
