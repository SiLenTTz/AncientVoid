import { defineConfig } from "vite";

// EPIC-P62 T62.6: rein statisch — ein Build, keine Server-Logik, kein
// Framework. Lighthouse-Budgets (Perf ≥ 90 / A11y ≥ 95) prüft der Deploy-Job.
export default defineConfig({
  build: { outDir: "dist", assetsInlineLimit: 0 },
});
