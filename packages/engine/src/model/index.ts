// model/ barrel — partial. Plan 06b adds buildProjectModel + computeReachableSymbols exports.
export { detectCatalogHandlers, type CandidateHandler } from "./catalog.js";
export {
  computeEvidence,
  locationFromCandidate,
  type ComputeEvidenceInput,
  type ComputeEvidenceOutput,
} from "./evidence.js";
