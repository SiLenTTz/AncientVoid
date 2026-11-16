/**
 * EPIC-P62 T62.6: statische Promo-Seite — Inhalte ausschließlich aus
 * content.json (eine Inhaltsquelle, keine Server-Logik). Video-Embeds
 * werden erst auf Klick aktiviert (youtube-nocookie, kein Tracking beim
 * Besuch). Clip-IDs landen in content.json, sobald die Clips veröffentlicht
 * sind (T62.5 — Nutzeraufgabe).
 */
import content from "./content.json";

const grid = document.getElementById("feature-grid")!;
for (const f of content.features) {
  const li = document.createElement("li");
  li.className = "feature";
  li.id = `feature-${f.id}`;
  const h = document.createElement("h3");
  h.textContent = f.title;
  const p = document.createElement("p");
  p.textContent = f.text;
  li.append(h, p);
  if (f.clip) {
    const a = document.createElement("a");
    a.href = `#video-${f.clip}`;
    a.textContent = "Watch the clip";
    li.append(a);
  }
  grid.append(li);
}

const videos = document.getElementById("video-grid")!;
if (content.videos.length === 0) {
  const note = document.createElement("p");
  note.className = "videos-soon";
  note.textContent = "Clips are being recorded — scripts and playlist are linked in the repository (docs/videos).";
  videos.append(note);
} else {
  for (const v of content.videos) {
    // Click-to-load: erst der Klick erzeugt den iframe (kein Drittanbieter-Request beim Besuch).
    const wrap = document.createElement("div");
    wrap.className = "video";
    wrap.id = `video-${v.id}`;
    const title = document.createElement("h3");
    title.textContent = v.title;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = `Play: ${v.title}`;
    btn.addEventListener("click", () => {
      const frame = document.createElement("iframe");
      frame.title = v.title;
      frame.width = "560";
      frame.height = "315";
      frame.src = `https://www.youtube-nocookie.com/embed/${v.youtubeId}`;
      frame.allow = "clipboard-write; encrypted-media; picture-in-picture";
      frame.allowFullscreen = true;
      btn.replaceWith(frame);
    });
    wrap.append(title, btn);
    videos.append(wrap);
  }
}
