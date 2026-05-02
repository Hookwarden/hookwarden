// model/ barrel — Plan 06a + 06b combined surface.
export { buildProjectModel, type BuildProjectModelInput } from "./build.js";
export { detectCatalogHandlers, type CandidateHandler } from "./catalog.js";
export {
  computeEvidence,
  locationFromCandidate,
  type ComputeEvidenceInput,
  type ComputeEvidenceOutput,
} from "./evidence.js";
export {
  extractMiddlewareChain,
  type ExtractMiddlewareInput,
} from "./middleware.js";
export {
  computeReachableSymbols,
  type ComputeReachabilityInput,
} from "./reachability.js";
