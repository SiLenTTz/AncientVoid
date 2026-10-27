import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginN from "eslint-plugin-n";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "apps/pwa/**",
      // CommonJS config read by dependency-cruiser (ADR-0020).
      ".dependency-cruiser.cjs",
      // Playwright E2E gate output (HTML report bundles, traces).
      "playwright-report/**",
      "test-results/**",
      // Real bug found live (2026-09-19): `data/` (dataDir, gitignored —
      // SQLite, JSONL, worker logs, and every session's T2.1 git worktree,
      // itself a full checkout of this whole repo) was never excluded, so
      // `npm run lint` re-linted an in-progress worktree's own copy of
      // scripts/*.mjs as if it were real source, real spurious
      // "process is not defined" errors and all.
      "data/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        performance: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    plugins: { n: eslintPluginN },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "n/no-missing-import": "off",
      "n/handle-callback-err": "error",
      eqeqeq: ["error", "smart"],
      "no-console": "off",
    },
  },
  {
    // page.evaluate() callbacks run inside a real Chromium, not Node —
    // ESLint parses the whole file as Node, so these globals need scoping
    // to just this script rather than the shared Node config above.
    files: ["scripts/k2-frame-lag.mjs", "scripts/k2-tiles.mjs"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        MutationObserver: "readonly",
      },
    },
  },
  {
    // Same reasoning as scripts/k2-frame-lag.mjs above.
    files: ["scripts/messlauf-approve-latency.mjs"],
    languageOptions: {
      globals: {
        window: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
      },
    },
  },
);
