import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginN from "eslint-plugin-n";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "packages/pwa/**",
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
    files: ["scripts/k2-frame-lag.mjs"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
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
