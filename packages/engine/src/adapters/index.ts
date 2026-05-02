import type { CandidateHandler } from "../model/catalog.js";
import type { ParsedFile } from "../types/project-model.js";
import { djangoAdapter } from "./django.js";
import { fastapiAdapter } from "./fastapi.js";
import { nextjsAdapter } from "./nextjs.js";

export type FrameworkAdapter = (
  file: ParsedFile,
  allFiles: ReadonlyArray<ParsedFile>,
) => ReadonlyArray<CandidateHandler>;

export const ALL_ADAPTERS: ReadonlyArray<FrameworkAdapter> = [
  nextjsAdapter,
  fastapiAdapter,
  djangoAdapter,
];

export { djangoAdapter, fastapiAdapter, nextjsAdapter };
