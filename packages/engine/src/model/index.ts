// model/ barrel — Plan 06a + 06b combined surface.
export { type BuildProjectModelInput, buildProjectModel } from "./build.js";
export { type CandidateHandler, detectCatalogHandlers } from "./catalog.js";
export {
  type ComputeEvidenceInput,
  type ComputeEvidenceOutput,
  computeEvidence,
  locationFromCandidate,
} from "./evidence.js";
export {
  type ExtractMiddlewareInput,
  extractMiddlewareChain,
} from "./middleware.js";
export {
  type ComputeReachabilityInput,
  computeReachableSymbols,
} from "./reachability.js";
