import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      "/api": {
        target: process.env.UACC_PROXY ?? "http://127.0.0.1:7373",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
