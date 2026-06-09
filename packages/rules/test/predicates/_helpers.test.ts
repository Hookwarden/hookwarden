import { describe, expect, it } from "vitest";

import { isConstantTimeCompare, isManualHmacEntry } from "../../src/predicates/_helpers.js";

describe("isManualHmacEntry", () => {
  it("matches qualified + namespace Node crypto HMAC entries", () => {
    expect(isManualHmacEntry("crypto.createHmac")).toBe(true);
    expect(isManualHmacEntry("nodeCrypto.createHmac")).toBe(true);
  });

  it("matches Python stdlib HMAC entries", () => {
    expect(isManualHmacEntry("hmac.new")).toBe(true);
    expect(isManualHmacEntry("crypto.hmac.new")).toBe(true);
  });

  // Regression: n8n trigger nodes import `{ createHmac }` and call it bare, so the engine
  // records the unqualified name `createHmac`. Before this case those handlers were mis-labeled
  // missing-signature-verification (critical) instead of deferring to the timing-unsafe sub-rules.
  it("matches a bare named-import `createHmac`", () => {
    expect(isManualHmacEntry("createHmac")).toBe(true);
  });

  it("does not match unrelated symbols", () => {
    expect(isManualHmacEntry("createHash")).toBe(false);
    expect(isManualHmacEntry("createHmacSomethingElse")).toBe(false);
    expect(isManualHmacEntry("myCreateHmac")).toBe(false);
    expect(isManualHmacEntry("timingSafeEqual")).toBe(false);
    expect(isManualHmacEntry("")).toBe(false);
  });
});

describe("isConstantTimeCompare", () => {
  it("matches qualified + namespace constant-time compares", () => {
    expect(isConstantTimeCompare("crypto.timingSafeEqual")).toBe(true);
    expect(isConstantTimeCompare("nodeCrypto.timingSafeEqual")).toBe(true);
    expect(isConstantTimeCompare("hmac.compare_digest")).toBe(true);
  });

  // Lock-step regression: must recognize bare `timingSafeEqual` / `compare_digest` so a handler
  // that verifies via a named import is NOT flagged missing-timing-safe-equal once isManualHmacEntry
  // recognizes its bare `createHmac`.
  it("matches bare named-import `timingSafeEqual` and `compare_digest`", () => {
    expect(isConstantTimeCompare("timingSafeEqual")).toBe(true);
    expect(isConstantTimeCompare("compare_digest")).toBe(true);
  });

  it("does not match unrelated symbols", () => {
    expect(isConstantTimeCompare("equals")).toBe(false);
    expect(isConstantTimeCompare("myTimingSafeEqual")).toBe(false);
    expect(isConstantTimeCompare("createHmac")).toBe(false);
    expect(isConstantTimeCompare("")).toBe(false);
  });
});
