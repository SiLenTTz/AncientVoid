import { BROWSER_PICK_TEXT_MAX_CHARS, BROWSER_STYLE_WHITELIST } from "@ancientvoid/contracts";
import type { BrowserPick } from "@ancientvoid/contracts";

/**
 * EPIC-P39 T39.5 (ADR-0059 §6): Element-Auswahl im Seitenkontext. Die Funktion wird von Playwright serialisiert und
 * läuft in der Seite — sie ist self-contained und liest bewusst nie Formularwerte. Konzeptionelle Referenz: Orcas
 * Design Mode (Selector-/Style-Auszug); der Code ist eigene Arbeit, kein Orca-Quelltext.
 */
export interface PickArgs {
  x: number;
  y: number;
  styles: readonly string[];
  maxText: number;
}

export const PICK_ARGS = (x: number, y: number): PickArgs => ({ x, y, styles: BROWSER_STYLE_WHITELIST, maxText: BROWSER_PICK_TEXT_MAX_CHARS });

export type PickRaw = Omit<BrowserPick, "url" | "source"> | null;

export function pickInPage(args: PickArgs): PickRaw {
  const SECRET = /pass(word|wort)?|secret|token|api[-_ ]?key|otp|cvv|cvc|card|iban|pin\b/i;
  let el: Element | null = document.elementFromPoint(args.x, args.y);
  if (!el) return null;
  let inShadowDom = false;
  for (let guard = 0; guard < 10; guard++) {
    const root: ShadowRoot | null = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    const inner: Element | null = root?.elementFromPoint(args.x, args.y) ?? null;
    if (!inner || inner === el) break;
    el = inner;
    inShadowDom = true;
  }
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  const attrs = `${node.getAttribute("type") ?? ""} ${node.getAttribute("name") ?? ""} ${node.id ?? ""} ${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("autocomplete") ?? ""}`;
  const masked = (tag === "input" && (node.getAttribute("type") ?? "").toLowerCase() === "password") || SECRET.test(attrs) || node.isContentEditable === true && SECRET.test(attrs);

  const part = (e: Element): string => {
    if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) return `#${e.id}`;
    const cls = [...e.classList].filter((c) => /^[A-Za-z][\w-]*$/.test(c)).slice(0, 2).map((c) => `.${c}`).join("");
    const parent = e.parentElement;
    const same = parent ? [...parent.children].filter((c) => c.tagName === e.tagName) : [];
    const nth = same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : "";
    return `${e.tagName.toLowerCase()}${cls}${nth}`;
  };
  const parts: string[] = [];
  for (let cur: Element | null = node, depth = 0; cur && depth < 6; depth++) {
    parts.unshift(part(cur));
    if (cur.id) break;
    const parent: Element | null = cur.parentElement;
    cur = parent ?? null;
  }
  const rect = node.getBoundingClientRect();
  const cs = getComputedStyle(node);
  const styles: Record<string, string> = {};
  if (!masked) for (const p of args.styles) styles[p] = cs.getPropertyValue(p).slice(0, 200);
  const isFrame = tag === "iframe" || tag === "frame";
  const text = masked || isFrame ? "" : (node.innerText ?? node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, args.maxText);
  return {
    selector: `${inShadowDom ? "(shadow) " : ""}${parts.join(" > ")}`.slice(0, 500),
    tag,
    text,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    styles,
    frame: isFrame ? "iframe" : "main",
    inShadowDom,
    masked,
  };
}
