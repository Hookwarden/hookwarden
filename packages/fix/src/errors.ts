// Phase 8.2 D-12 typed-error contract.
//
// The user-visible D-12 message ("error: --mode all in non-TTY requires --accept-unsafe (D-12)")
// lives in packages/cli/src/commands/fix.ts (Plan 09). This package only signals the condition.

export class FixModeNonTtyRejectedError extends Error {
  readonly code = "FIX_MODE_NON_TTY_REJECTED" as const;
  constructor() {
    super("FIX_MODE_NON_TTY_REJECTED");
    this.name = "FixModeNonTtyRejectedError";
  }
}
