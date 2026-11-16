const ZOOM_KEY = "ancientvoid.pinch-zoom";

/**
 * Nutzerwunsch 2026-09-28: nie Fokus-Zoom beim Antippen, nie horizontales
 * Scrollen — aber Pinch-Zoom soll bleiben, wenn man ihn will. Der Schalter
 * lebt in den Einstellungen und schreibt die viewport-Meta um.
 */
export function pinchZoomAllowed(): boolean {
  return localStorage.getItem(ZOOM_KEY) !== "0";
}

export function applyPinchZoom(allowed: boolean): void {
  localStorage.setItem(ZOOM_KEY, allowed ? "1" : "0");
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  meta.setAttribute(
    "content",
    `width=device-width, initial-scale=1.0, viewport-fit=cover${allowed ? "" : ", maximum-scale=1, user-scalable=no"}`,
  );
}
