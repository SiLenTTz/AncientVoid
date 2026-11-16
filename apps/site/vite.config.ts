import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * EPIC-P62 T62.6: rein statisch — ein Build, keine Server-Logik, kein
 * Framework. Lighthouse-Budgets (Perf ≥ 90 / A11y ≥ 95) prüft der Deploy-Job.
 *
 * Features und Video-Hinweis entstehen zur BUILD-Zeit aus content.json
 * (einzige Inhaltsquelle, ADR-0082): das fertige HTML ist komplett, nichts
 * wächst beim Laden nach — CLS 0. Nur die Click-to-load-Embeds bleiben
 * Client-Logik (main.ts), weil sie bewusst erst auf Klick Requests erzeugen.
 */
function contentFromJson(): Plugin {
  const content = JSON.parse(readFileSync(resolve(import.meta.dirname, "src/content.json"), "utf8")) as {
    features: { id: string; title: string; text: string; clip: string | null }[];
    videos: { id: string; title: string; youtubeId: string }[];
  };
  const featuresHtml = content.features
    .map(
      (f) =>
        `<li class="feature" id="feature-${f.id}"><h3>${f.title}</h3><p>${f.text}</p>${f.clip ? `<a href="#video-${f.clip}">Watch the clip</a>` : ""}</li>`,
    )
    .join("\n        ");
  const videosHtml =
    content.videos.length === 0
      ? '<p class="videos-soon">Clips are being recorded — scripts and playlist are linked in the repository (docs/videos).</p>'
      : content.videos
          .map((v) => `<div class="video" id="video-${v.id}"><h3>${v.title}</h3><button type="button" class="btn" data-youtube="${v.youtubeId}">Play: ${v.title}</button></div>`)
          .join("\n        ");
  return {
    name: "ancientvoid-site-content",
    transformIndexHtml(html) {
      return html
        .replace("<!-- FEATURES -->", featuresHtml)
        .replace("<!-- VIDEOS -->", videosHtml);
    },
  };
}

export default defineConfig({
  build: { outDir: "dist", assetsInlineLimit: 0 },
  plugins: [contentFromJson()],
});
