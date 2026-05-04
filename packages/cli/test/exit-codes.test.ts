import { describe, expect, it } from "vitest";
import { computeExitCode, type ExitCode, type ExitInputs } from "../src/exit-codes.js";

function inputs(
  configError: boolean,
  engineError: boolean,
  belowParseCoverage: boolean,
  findingsAtThreshold: boolean,
): ExitInputs {
  return { configError, engineError, belowParseCoverage, findingsAtThreshold };
}

describe("computeExitCode — documented branches (D-65 specifics)", () => {
  it("clean run → 0", () => {
    expect(computeExitCode(inputs(false, false, false, false))).toBe(0);
  });

  it("high finding without --fail-on=critical → 1", () => {
    expect(computeExitCode(inputs(false, false, false, true))).toBe(1);
  });

  it("engine throws → 2", () => {
    expect(computeExitCode(inputs(false, true, false, false))).toBe(2);
  });

  it("broken config → 3", () => {
    expect(computeExitCode(inputs(true, false, false, false))).toBe(3);
  });

  it("50% parse coverage with min 0.95 → 4", () => {
    expect(computeExitCode(inputs(false, false, true, false))).toBe(4);
  });

  it("all four flags true → 3 (config wins over everything)", () => {
    expect(computeExitCode(inputs(true, true, true, true))).toBe(3);
  });

  it("engineError + belowParseCoverage + findingsAtThreshold → 2 (engine wins over coverage and findings)", () => {
    expect(computeExitCode(inputs(false, true, true, true))).toBe(2);
  });

  it("belowParseCoverage + findingsAtThreshold → 4 (coverage wins over findings)", () => {
    expect(computeExitCode(inputs(false, false, true, true))).toBe(4);
  });
});

describe("computeExitCode — full 16-case precedence matrix", () => {
  const CASES: Array<[boolean, boolean, boolean, boolean, ExitCode]> = [];
  for (const cfg of [false, true]) {
    for (const eng of [false, true]) {
      for (const cov of [false, true]) {
        for (const fnd of [false, true]) {
          const expected: ExitCode = cfg ? 3 : eng ? 2 : cov ? 4 : fnd ? 1 : 0;
          CASES.push([cfg, eng, cov, fnd, expected]);
        }
      }
    }
  }

  for (const [cfg, eng, cov, fnd, expected] of CASES) {
    it(`cfg=${cfg} eng=${eng} cov=${cov} fnd=${fnd} → ${expected}`, () => {
      expect(computeExitCode(inputs(cfg, eng, cov, fnd))).toBe(expected);
    });
  }
});
