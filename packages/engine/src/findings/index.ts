// findings/ barrel — internal-use only. The engine package's public surface re-exports nothing
// from here; downstream rules query the public `Finding` type from src/types/.
export {
  computePrimaryLocationLineHash,
  computeHandlerId,
  computeFindingId,
} from "./fingerprint.js";
export type {
  PrimaryLocationLineHashInput,
  HandlerIdInput,
  FindingIdInput,
} from "./fingerprint.js";
