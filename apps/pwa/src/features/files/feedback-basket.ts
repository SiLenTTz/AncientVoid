import { useEffect, useState } from "preact/hooks";
import type { FileFeedbackItem } from "../../shared/api.ts";

/** EPIC-P46 T46.8: Sammelkorb für Datei-/Diagnose-Befunde — flüchtig im Tab, Versand nur nach Vorschau. */
let items: FileFeedbackItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const basket = {
  get: () => items,
  add(item: FileFeedbackItem) {
    items = [...items.filter((i) => !(i.path === item.path && i.startLine === item.startLine && i.endLine === item.endLine)), item];
    emit();
  },
  remove(index: number) {
    items = items.filter((_, i) => i !== index);
    emit();
  },
  clear() {
    items = [];
    emit();
  },
};

export function useBasket(): FileFeedbackItem[] {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return items;
}
