import type { CandidateHandler } from "../model/catalog.js";
import type { ParsedFile } from "../types/project-model.js";
import { chiGinEchoGoAdapter } from "./chi-gin-echo-go.js";
import { djangoAdapter } from "./django.js";
import { edgeRuntimeAdapter } from "./edge-runtime.js";
import { fastapiAdapter } from "./fastapi.js";
import { n8nCustomNodeAdapter } from "./n8n-custom-node.js";
import { netHttpGoAdapter } from "./net-http-go.js";
import { nextjsAdapter } from "./nextjs.js";
import { nextjsPagesAdapter } from "./nextjs-pages.js";
import { remixAdapter } from "./remix.js";
import { symfonyAdapter } from "./symfony.js";
import { vanillaPhpAdapter } from "./vanilla-php.js";

export type FrameworkAdapter = (
  file: ParsedFile,
  allFiles: ReadonlyArray<ParsedFile>,
) => ReadonlyArray<CandidateHandler>;

// Order matters: framework-imports-required adapters precede the heuristic catch-all
// (vanilla-PHP). symfonyAdapter's negative-gating-via-imports leaves vanilla-PHP free to
// fire only on files with zero framework imports.
export const ALL_ADAPTERS: ReadonlyArray<FrameworkAdapter> = [
  nextjsAdapter,
  // Phase 29 (ENG-PAGES-01) — Next.js Pages Router (`pages/api/**`). Path-disjoint from
  // nextjsAdapter (`app/**/route.<ext>`), so order is non-load-bearing; a file is owned by exactly
  // one of the two. Reads the `export default` handler + infers method from `req.method` guards.
  nextjsPagesAdapter,
  // Remix route modules (app/routes/**). Path-gated on app/routes/ + an `action` export; disjoint
  // from nextjsAdapter (which needs a `route.<ext>` filename), so no double-detection.
  remixAdapter,
  // Phase 8.5 (REACH-02) — edge-runtime entry points (Workers/Vercel Edge/Deno). Export-shape-gated
  // (only fires on `export default {fetch}` / `export const config={runtime:'edge'}` / `Deno.serve`),
  // so it sits with the other import/export-gated adapters, before the heuristic catch-alls.
  edgeRuntimeAdapter,
  fastapiAdapter,
  djangoAdapter,
  symfonyAdapter,
  vanillaPhpAdapter,
  // Phase 27 (RULES-GO-01) — Go adapters. chi/gin/echo is import-gated and MUST precede the
  // net/http heuristic catch-all (mirrors symfony-before-vanilla); netHttpGoAdapter
  // import-negative-gates the same chi/gin/echo prefixes so each Go file is owned by exactly one.
  chiGinEchoGoAdapter,
  netHttpGoAdapter,
  // Phase 24 (AGENT-01) — content-gated n8n custom-node webhook() method detector. Only fires on
  // files importing an n8n node interface from n8n-workflow; never on glob/path.
  n8nCustomNodeAdapter,
];

export {
  chiGinEchoGoAdapter,
  djangoAdapter,
  edgeRuntimeAdapter,
  fastapiAdapter,
  n8nCustomNodeAdapter,
  netHttpGoAdapter,
  nextjsAdapter,
  nextjsPagesAdapter,
  remixAdapter,
  symfonyAdapter,
  vanillaPhpAdapter,
};
