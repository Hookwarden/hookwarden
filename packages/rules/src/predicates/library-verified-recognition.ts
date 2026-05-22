// RULES-04 D-56: emits 'verified' when the handler reaches an SDK verify call within the engine's
// bounded-depth reachability budget (D-34, default 3 hops). Parameterized factory: one body services
// every provider; per-provider exports close over the catalog's sdk_verify_calls list.
//
// Pure: no fs / http / network / process / node:*. Receives WebhookHandler + ProjectModel; returns
// Verdict | null. Returns null when:
//   - handler.provider does not match the bound provider (rule does not apply)
//   - no SDK verify call is reachable (other rules will emit not-verified for the missing-verification case)
//
// D-34 reachability_max_depth is enforced engine-side; we trust handler.reachable_symbols as
// already-bounded. D-33 catalog ships sdk_verify_calls per provider; we close over the list at
// predicate-creation time so adding a new verify call is a catalog edit + minor bump (no engine
// release required).
//
// Phase 8.1 Plan 08 — PHP support. The engine reach pass is bounded to babel + tree-sitter-python
// in v1; PHP handlers never accumulate reachable_symbols. PHP verify-call signal comes from the
// `build.ts` PHP overlay (Phase 8.1 Plan 07) which emits a `sdk_verify_call` evidence entry.
// The predicate now ALSO consults `handler.evidence` for matching `sdk_verify_call` entries
// — preserves the existing JS/Python reachable_symbols path while adding the PHP signal source.

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../catalog.js";

export function createLibraryVerifiedPredicate(
  provider: string,
  sdkVerifyCalls: ReadonlyArray<string>,
): RulePredicate {
  return async (handler: WebhookHandler, _model: ProjectModel) => {
    if (handler.provider !== provider) return null;
    if (sdkVerifyCalls.length === 0) return null;
    // Path A — reachable_symbols (JS/Python; populated by engine reachability D-34).
    const reachable = handler.reachable_symbols;
    for (const sym of reachable) {
      for (const call of sdkVerifyCalls) {
        if (sym.qualified_name === call || sym.qualified_name.endsWith(`.${call}`)) {
          return "verified";
        }
      }
    }
    // Path B — evidence-emitted sdk_verify_call entries (PHP; populated by the build.ts PHP
    // overlay in Phase 8.1 Plan 07). Provider attribution is already set on the evidence entry.
    for (const ev of handler.evidence) {
      if (ev.kind === "sdk_verify_call" && ev.provider === provider) return "verified";
    }
    return null;
  };
}

// Per-provider bound predicates. Catalog edits (e.g. adding a new SDK verify call name) do NOT
// require an engine release — they are data-only.
export const stripeLibraryVerifiedPredicate: RulePredicate = createLibraryVerifiedPredicate(
  "stripe",
  PROVIDER_CATALOG["stripe"]?.sdk_verify_calls ?? [],
);

export const githubLibraryVerifiedPredicate: RulePredicate = createLibraryVerifiedPredicate(
  "github",
  PROVIDER_CATALOG["github"]?.sdk_verify_calls ?? [],
);

export const shopifyLibraryVerifiedPredicate: RulePredicate = createLibraryVerifiedPredicate(
  "shopify",
  PROVIDER_CATALOG["shopify"]?.sdk_verify_calls ?? [],
);

export const twilioLibraryVerifiedPredicate: RulePredicate = createLibraryVerifiedPredicate(
  "twilio",
  PROVIDER_CATALOG["twilio"]?.sdk_verify_calls ?? [],
);

export const slackLibraryVerifiedPredicate: RulePredicate = createLibraryVerifiedPredicate(
  "slack",
  PROVIDER_CATALOG["slack"]?.sdk_verify_calls ?? [],
);

export const squareLibraryVerifiedPredicate: RulePredicate = createLibraryVerifiedPredicate(
  "square",
  PROVIDER_CATALOG["square"]?.sdk_verify_calls ?? [],
);
