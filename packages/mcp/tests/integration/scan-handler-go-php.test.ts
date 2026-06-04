// Full CLI language parity — Go + PHP wired into scan_handler.
//
// Before this, scan_handler only parsed js/ts/python; Go fell through to the
// Babel parser (→ parse_error) and PHP returned language_not_in_preview. These
// tests prove both grammars are now bundled + wired: a real handler parses
// (parse_error=0) and the engine evaluates it. Go additionally produces a
// finding for the canonical bytes.Equal (timing-unsafe) Stripe bug.

import { describe, expect, it } from "vitest";

import { loadBuildManifest } from "../../src/drift-check.js";
import { scanHandler } from "../../src/tools/scan-handler.js";

// net/http Stripe handler using non-constant-time bytes.Equal on the HMAC —
// the canonical FIX-GO-01 / stripe-timing-unsafe target (Phase 27).
const GO_TIMING_UNSAFE = `package webhooks

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"io"
	"net/http"
)

func StripeBroken(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	sig := []byte(r.Header.Get("Stripe-Signature"))
	mac := hmac.New(sha256.New, []byte("whsec_test_secret"))
	mac.Write(body)
	if bytes.Equal(mac.Sum(nil), sig) {
		w.WriteHeader(http.StatusOK)
	}
}
`;

// A vanilla-PHP Stripe webhook that never verifies the signature.
const PHP_NO_VERIFY = `<?php
$payload = file_get_contents('php://input');
$event = json_decode($payload, true);
handle_event($event);
http_response_code(200);
`;

describe("scan_handler — Go + PHP language parity", () => {
  it("Go: parses (parse_error=0) and flags the timing-unsafe Stripe handler", async () => {
    const manifest = await loadBuildManifest();
    const result = await scanHandler({ code: GO_TIMING_UNSAFE, language: "go" }, manifest);

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      verdict_summary: { parse_error: number };
      findings: Array<{ provider: string; verdict: string }>;
    };
    // Wiring proof: the Go grammar parsed the source — no parse-error finding.
    expect(sc.verdict_summary.parse_error).toBe(0);
    // The 0.9.0 rule pack flags the bytes.Equal timing-unsafe Stripe path.
    expect(sc.findings.length).toBeGreaterThan(0);
    expect(sc.findings.some((f) => f.provider === "stripe")).toBe(true);
    for (const f of sc.findings) {
      expect(["verified", "not-verified", "manual-review"]).toContain(f.verdict);
    }
  });

  it("PHP: parses (parse_error=0) — grammar bundled + wired, no longer language_not_in_preview", async () => {
    const manifest = await loadBuildManifest();
    const result = await scanHandler({ code: PHP_NO_VERIFY, language: "php" }, manifest);

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      error?: string;
      verdict_summary: { parse_error: number };
    };
    expect(sc.error).toBeUndefined();
    expect(sc.verdict_summary.parse_error).toBe(0);
  });
});
