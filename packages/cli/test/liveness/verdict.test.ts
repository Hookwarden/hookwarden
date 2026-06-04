// Phase 28 LEAK-06 — verdict→severity remap + FP-moat gating (dead/unverified
// never emit a false critical; only live escalates).

import type { Finding } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { remapForLiveness } from "../../src/liveness/verdict.js";
import { countActiveAtOrAbove } from "../../src/severity-threshold.js";

function leakFinding(): Finding {
  return {
    id: "f1",
    rule_id: "github/hardcoded-secret-prefix",
    provider: "github",
    severity: "high",
    state: "not-verified",
    file_path: "app/webhook.ts",
    location: { line: 1, col: 1, end_line: 1, end_col: 10 },
    snippet: "<SECRET_LITERAL>",
    handler_id: "h1",
    primary_location_line_hash: "abc",
    message: "hardcoded secret",
    metadata: {},
  };
}

describe("remapForLiveness", () => {
  it("live → severity critical + metadata.liveness", () => {
    const out = remapForLiveness(leakFinding(), "live");
    expect(out.severity).toBe("critical");
    expect(out.metadata.liveness).toBe("live");
  });
  it("dead → severity info", () => {
    const out = remapForLiveness(leakFinding(), "dead");
    expect(out.severity).toBe("info");
    expect(out.metadata.liveness).toBe("dead");
  });
  it("unverified → unchanged severity, facet set", () => {
    const out = remapForLiveness(leakFinding(), "unverified");
    expect(out.severity).toBe("high");
    expect(out.metadata.liveness).toBe("unverified");
  });
});

describe("FP moat — verdict drives the --fail-on gate", () => {
  it("a live finding gates at --fail-on high; a dead one does NOT", () => {
    const live = remapForLiveness(leakFinding(), "live"); // → critical
    const dead = remapForLiveness(leakFinding(), "dead"); // → info
    expect(countActiveAtOrAbove([live], "high")).toBe(1);
    expect(countActiveAtOrAbove([dead], "high")).toBe(0);
  });

  it("an unverified finding keeps its original gating (high still gates at high)", () => {
    const unv = remapForLiveness(leakFinding(), "unverified"); // stays high
    expect(countActiveAtOrAbove([unv], "high")).toBe(1);
  });
});
