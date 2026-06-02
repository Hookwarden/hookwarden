// Rule-class taxonomy (Phase 19 v0.7.1 tail — RD-RELEASE-01 carry-forward).
//
// Every rule_id is `<provider>/<class>` (e.g. `stripe/test-mode-bypass`,
// `engine/parse-error`). The trailing segment is the rule's *class* — the
// kind of bug it detects, independent of provider. This module is the single
// source of truth for:
//   - `hookwarden scan --severity-class <group>` (rule filter; mirrors --provider)
//   - `hookwarden --version --verbose` rule-class enumeration
//
// Design decision (documented here because Phase 19 deferred it without a SPEC):
// the `production-bypass` group is the auditor-facing "a forged or replayed
// request would be ACCEPTED in production" set — verification absent, defeated,
// bypassable, or replay-able. It deliberately EXCLUDES:
//   - secret-exposure classes (secret-in-log-or-error, hardcoded-secret-prefix)
//     — a leak, not a request-acceptance bypass
//   - the positive `library-verified` signal (a `verified` state, not a finding)
// The allowlist is explicit (not "everything except"): a security tool should
// fail closed when a new, unclassified rule class appears — it simply won't be
// in the production-bypass group until curated in, rather than silently swept in.

/** Extract the class segment from a rule_id (`provider/class` → `class`). */
export function ruleClassOf(ruleId: string): string {
  const slash = ruleId.lastIndexOf("/");
  return slash === -1 ? ruleId : ruleId.slice(slash + 1);
}

/**
 * Classes where a forged or replayed request would be accepted in production:
 * verification is missing, unreachable, bypassed, defeated, or replay-able.
 * Grounded in the actual bundled rule-class suffixes (v0.8.0-beta).
 */
export const PRODUCTION_BYPASS_CLASSES: ReadonlySet<string> = new Set([
  // verification absent / unreachable
  "missing-signature-verification",
  "unreachable-verification",
  "verification-token-only",
  "url-validation-only",
  "missing-basic-auth",
  "missing-ip-allowlist",
  "webhook-trigger-no-authentication",
  "tool-callback-no-verification",
  // verification present but defeated / order-wrong
  "raw-body-misuse",
  "express-middleware-ordering",
  "verify-after-side-effect",
  "verification-error-swallowed",
  "test-mode-bypass",
  "agent-tool-acts-on-unverified-payload",
  // weak / broken crypto comparison
  "timing-unsafe-comparison",
  "missing-timing-safe-equal",
  "wrong-hmac-algorithm",
  "empty-secret-bypass",
  // signature parsing mistakes that accept forgeries
  "signature-prefix-not-stripped",
  "signature-header-parse-mishandled",
  "header-confusion",
  "octokit-cross-attribution",
  "multi-signature-rotation-mishandled",
  "url-secret-in-path",
  // replay (a captured-and-replayed request is accepted)
  "missing-timestamp-check",
  "missing-replay-defense",
  "replay-window-too-permissive",
]);

/**
 * Named `--severity-class` groups. `production-bypass` is the only group v0.7.1
 * ships; the registry shape leaves room for `secret-exposure` / `replay` /
 * `agentic` cuts without a flag-parsing change.
 */
export const SEVERITY_CLASS_GROUPS: Readonly<Record<string, ReadonlySet<string>>> = {
  "production-bypass": PRODUCTION_BYPASS_CLASSES,
};

/** Valid `--severity-class` group names (for CLI validation + help). */
export const SEVERITY_CLASS_GROUP_NAMES: ReadonlyArray<string> = Object.keys(SEVERITY_CLASS_GROUPS);

/** True when a rule_id belongs to the named severity-class group. */
export function ruleInSeverityClassGroup(ruleId: string, group: string): boolean {
  const members = SEVERITY_CLASS_GROUPS[group];
  return members?.has(ruleClassOf(ruleId)) ?? false;
}

export interface RuleClassCount {
  readonly cls: string;
  readonly count: number;
  readonly production_bypass: boolean;
}

/**
 * Enumerate distinct rule classes with counts, sorted by count desc then name.
 * Powers `hookwarden --version --verbose`.
 */
export function enumerateRuleClasses(
  ruleIds: ReadonlyArray<string>,
): ReadonlyArray<RuleClassCount> {
  const counts = new Map<string, number>();
  for (const id of ruleIds) {
    const cls = ruleClassOf(id);
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([cls, count]) => ({
      cls,
      count,
      production_bypass: PRODUCTION_BYPASS_CLASSES.has(cls),
    }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.cls.localeCompare(b.cls)));
}
