// CLI-04 + D-65 exit codes 0/1/2/3/4 with precedence 3 > 2 > 4 > 1 > 0.
// 0=clean, 1=findings>=threshold, 2=engine error, 3=config error, 4=parse coverage below minimum.

export type ExitCode = 0 | 1 | 2 | 3 | 4;

export interface ExitInputs {
  readonly configError: boolean;
  readonly engineError: boolean;
  readonly belowParseCoverage: boolean;
  readonly findingsAtThreshold: boolean;
}

export const EXIT_CODE_MEANINGS: Readonly<Record<ExitCode, string>> = {
  0: "clean",
  1: "findings at or above --fail-on threshold",
  2: "engine error",
  3: "config error",
  4: "parse coverage below minimum",
};

export function computeExitCode(inputs: ExitInputs): ExitCode {
  if (inputs.configError) return 3;
  if (inputs.engineError) return 2;
  if (inputs.belowParseCoverage) return 4;
  if (inputs.findingsAtThreshold) return 1;
  return 0;
}
