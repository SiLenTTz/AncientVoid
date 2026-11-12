/**
 * EPIC-P43 (Kleinkram-Regel 6, „Nichts liegt über dem Inhalt“): Dateibaum, Browser-Arbeitsplatz und
 * Android-Geräte haben keine Randlaschen mehr. Geöffnet werden sie aus den Ansichten heraus — Reiter
 * „Befehle“, Menü „Mehr“ der Session, globales „Mehr“ —, die Ebenen selbst bleiben in main.tsx.
 */
export type LayerKind = "files" | "browser" | "devices";

const EVENT = "ancientvoid:layer-open";

export function openLayer(kind: LayerKind): void {
  window.dispatchEvent(new CustomEvent<LayerKind>(EVENT, { detail: kind }));
}

export function onLayerOpen(kind: LayerKind, cb: () => void): () => void {
  const on = (e: Event) => {
    if ((e as CustomEvent<LayerKind>).detail === kind) cb();
  };
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}
