/**
 * EPIC-P62 T62.6: Client-Rest der Promo-Seite. Features und der
 * „Videos in Aufnahme“-Hinweis entstehen zur Build-Zeit aus content.json
 * (vite.config.ts) — hier bleibt nur die Click-to-load-Logik für
 * Video-Embeds: erst der Klick erzeugt den youtube-nocookie-iframe, beim
 * Besuch läuft kein Drittanbieter-Request.
 */
const buttons = document.querySelectorAll<HTMLButtonElement>("#video-grid button[data-youtube]");
for (const btn of buttons) {
  btn.addEventListener("click", () => {
    const frame = document.createElement("iframe");
    frame.title = btn.textContent ?? "Feature clip";
    frame.width = "560";
    frame.height = "315";
    frame.src = `https://www.youtube-nocookie.com/embed/${btn.dataset.youtube}`;
    frame.allow = "clipboard-write; encrypted-media; picture-in-picture";
    frame.allowFullscreen = true;
    btn.replaceWith(frame);
  });
}
