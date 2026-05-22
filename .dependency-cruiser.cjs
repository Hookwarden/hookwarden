/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "engine-no-node-core",
      severity: "error",
      comment:
        "packages/engine must remain browser-safe. Node built-ins are forbidden. " +
        "See decision D-01.",
      from: { path: "^packages/engine/(src|dist)" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "engine-no-network-libs",
      severity: "error",
      comment:
        "packages/engine must not import network libraries. The engine performs zero I/O. " +
        "See decision D-01.",
      from: { path: "^packages/engine/(src|dist)" },
      to: {
        // Match the package name in the resolved path. Handles both npm
        // (`node_modules/axios/...`) and pnpm content-addressed paths
        // (`node_modules/.pnpm/axios@VERSION/node_modules/axios/...`) — the
        // trailing `/node_modules/<lib>/` segment is present in both.
        path: "node_modules/(node-fetch|axios|got|undici|cross-fetch|isomorphic-fetch|ky|wretch|phin|needle|request)/",
      },
    },
    {
      name: "engine-no-fs-libs",
      severity: "error",
      comment:
        "packages/engine must not import filesystem libraries. " +
        "The CLI parses YAML and passes pre-parsed RuleSet objects (D-03).",
      from: { path: "^packages/engine/(src|dist)" },
      to: {
        path: "node_modules/(graceful-fs|fs-extra|memfs|chokidar|glob|fast-glob|tinyglobby)/",
      },
    },
    {
      name: "rules-predicates-no-node-core",
      severity: "error",
      comment:
        "@hookwarden/rules predicates run inside the engine sandbox (D-28). " +
        "They must remain browser-safe; no Node built-ins, no network libs, no fs.",
      from: { path: "^packages/rules/src/predicates/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "rules-predicates-no-network-libs",
      severity: "error",
      comment:
        "@hookwarden/rules predicates must not perform I/O. " +
        "Engine purity (D-01) extends to predicates per D-28.",
      from: { path: "^packages/rules/src/predicates/" },
      to: {
        path: "node_modules/(node-fetch|axios|got|undici|cross-fetch|isomorphic-fetch|ky|wretch|phin|needle|request|graceful-fs|fs-extra|chokidar|glob|fast-glob|tinyglobby)/",
      },
    },
    {
      name: "engine-no-babel-traverse",
      severity: "error",
      comment:
        "@hookwarden/engine must NOT depend on @babel/traverse or @babel/generator. " +
        "Those land in packages/fix/ only. See Phase 8.2 D-05.",
      from: { path: "^packages/engine/(src|dist)" },
      to: { path: "node_modules/(@babel/traverse|@babel/generator)/" },
    },
    {
      name: "rules-no-babel-traverse",
      severity: "error",
      comment:
        "@hookwarden/rules predicates must remain engine-pure. " +
        "Codegen routines under packages/rules/src/fix/ MAY import @babel/types only.",
      from: { path: "^packages/rules/src/predicates/" },
      to: { path: "node_modules/(@babel/traverse|@babel/generator)/" },
    },
    {
      name: "fix-no-network-libs",
      severity: "error",
      comment: "packages/fix must not perform network I/O (CLI determinism contract).",
      from: { path: "^packages/fix/(src|dist)" },
      to: {
        path: "node_modules/(node-fetch|axios|got|undici|cross-fetch|isomorphic-fetch|ky|wretch|phin|needle|request)/",
      },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require"],
    },
    doNotFollow: { path: "node_modules" },
  },
};
