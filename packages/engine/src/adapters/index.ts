import type { CandidateHandler } from "../model/catalog.js";
import type { ParsedFile } from "../types/project-model.js";
import { djangoAdapter } from "./django.js";
import { fastapiAdapter } from "./fastapi.js";
import { nextjsAdapter } from "./nextjs.js";
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
  fastapiAdapter,
  djangoAdapter,
  symfonyAdapter,
  vanillaPhpAdapter,
];

export { djangoAdapter, fastapiAdapter, nextjsAdapter, symfonyAdapter, vanillaPhpAdapter };
