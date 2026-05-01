/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'engine-no-node-core',
      severity: 'error',
      comment:
        'packages/engine must remain browser-safe. Node built-ins are forbidden. ' +
        'See decision D-01.',
      from: { path: '^packages/engine/(src|dist)' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'engine-no-network-libs',
      severity: 'error',
      comment:
        'packages/engine must not import network libraries. The engine performs zero I/O. ' +
        'See decision D-01.',
      from: { path: '^packages/engine/(src|dist)' },
      to: {
        // Match the package name in the resolved path. Handles both npm
        // (`node_modules/axios/...`) and pnpm content-addressed paths
        // (`node_modules/.pnpm/axios@VERSION/node_modules/axios/...`) — the
        // trailing `/node_modules/<lib>/` segment is present in both.
        path: 'node_modules/(node-fetch|axios|got|undici|cross-fetch|isomorphic-fetch|ky|wretch|phin|needle|request)/',
      },
    },
    {
      name: 'engine-no-fs-libs',
      severity: 'error',
      comment:
        'packages/engine must not import filesystem libraries. ' +
        'The CLI parses YAML and passes pre-parsed RuleSet objects (D-03).',
      from: { path: '^packages/engine/(src|dist)' },
      to: {
        path: 'node_modules/(graceful-fs|fs-extra|memfs|chokidar|glob|fast-glob|tinyglobby)/',
      },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require'],
    },
    doNotFollow: { path: 'node_modules' },
  },
};
