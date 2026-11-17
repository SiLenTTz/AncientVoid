/**
 * ADR-0020: the module boundaries, checked in `npm run gate` (check:arch).
 * A rule here is a promise the structure keeps — change it with the ADR.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "No import cycles (type-only imports are erased and not counted).",
      from: {},
      to: { circular: true },
    },
    {
      name: "core-module-public-api",
      severity: "error",
      comment: "A core module reaches another core module only through its index.ts.",
      from: { path: "^packages/core/src/modules/([^/]+)/" },
      to: {
        path: "^packages/core/src/modules/[^/]+/",
        pathNot: ["^packages/core/src/modules/$1/", "^packages/core/src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "core-platform-below-modules",
      severity: "error",
      comment: "platform/ serves the modules and never depends on them.",
      from: { path: "^packages/core/src/platform/" },
      to: { path: "^packages/core/src/modules/" },
    },
    {
      name: "contracts-stand-alone",
      severity: "error",
      comment: "Contracts import nothing else from this repo.",
      from: { path: "^packages/contracts/src/" },
      to: { path: "^(apps|packages)/", pathNot: "^packages/contracts/" },
    },
    {
      name: "adapters-only-contracts",
      severity: "error",
      comment: "Adapters see the hub only through contracts (AdapterContext isolation).",
      from: { path: "^packages/adapters/[^/]+/src/" },
      to: { path: "^(apps/|packages/(core|workers)/)" },
    },
    {
      name: "loops-only-contracts",
      severity: "error",
      comment: "EPIC-P19 / AC-P19-6: Loop-Connectoren sehen den Hub nur über @ancientvoid/contracts, nie core, workers oder server.",
      from: { path: "^packages/loops/[^/]+/src/" },
      to: { path: "^(apps/|packages/(core|workers|adapters)/)" },
    },
    {
      name: "pwa-no-hub-internals",
      severity: "error",
      comment: "The PWA talks to the hub over HTTP/WS only; it mirrors the types it needs.",
      from: { path: "^apps/pwa/" },
      to: { path: "^(packages/(core|workers|adapters)|apps/(hub|hubctl|gateway-mcp))/" },
    },
    {
      name: "pwa-shared-below-features",
      severity: "error",
      comment: "apps/pwa/src/shared is used by features and app, never the other way round.",
      from: { path: "^apps/pwa/src/shared/" },
      to: { path: "^apps/pwa/src/(features|app)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(node_modules|/dist/|/dist-e2e/|\\.test\\.ts$|\\.test\\.tsx$|/test/)" },
    tsPreCompilationDeps: false,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"] },
  },
};
