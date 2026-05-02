// findings/ barrel — internal-use only. The engine package's public surface re-exports nothing
// from here; downstream rules query the public `Finding` type from src/types/.

export type {
  FindingIdInput,
  HandlerIdInput,
  PrimaryLocationLineHashInput,
} from "./fingerprint.js";
export {
  computeFindingId,
  computeHandlerId,
  computePrimaryLocationLineHash,
} from "./fingerprint.js";
