// Registered predicate keys (Phase 6 D-93 refactor + 06.2 Shopify + 06.3 Twilio
// + 06.4 Slack + 06.5 Square + 8.1 Plan 08 PHP + 8.3 Plan 01 Zendesk + 8.3 Plan 16
// Standard Webhooks + 8.3 Plan 03 Intercom):
//   github-timing-safe-equal, express-middleware-ordering,
//   stripe-library-verified, github-library-verified, shopify-library-verified, twilio-library-verified,
//   stripe-missing-signature-verification, stripe-timing-unsafe-comparison,
//   stripe-raw-body-misuse, stripe-missing-timestamp-check,
//   stripe-wrong-hmac-algorithm, stripe-unreachable-verification,
//   github-missing-signature-verification, github-raw-body-misuse,
//   github-missing-timestamp-check, github-wrong-hmac-algorithm,
//   github-unreachable-verification,
//   shopify-{missing-signature-verification, timing-unsafe-comparison, raw-body-misuse,
//            missing-timestamp-check, wrong-hmac-algorithm, unreachable-verification},
//   twilio-{missing-signature-verification, timing-unsafe-comparison, raw-body-misuse,
//           missing-timestamp-check, wrong-hmac-algorithm, unreachable-verification}
//
// Implementations come from catalog-parameterized factory files (D-90, D-91). Twilio's
// missing-signature-verification dispatches through CUSTOM_SIGNING_PREDICATES['twilio']
// (D-92) at predicates/custom/twilio-signing.ts.

// Custom-predicate side-effect registrations (D-92). Each import populates
// CUSTOM_SIGNING_PREDICATES[<provider>] at module-load time. Living here (not in
// missing-signature-verification.ts) avoids the circular dep where each custom predicate
// imports CUSTOM_SIGNING_PREDICATES from missing-signature-verification.js.
import "./custom/twilio-signing.js";
import "./custom/standardwebhooks-signing.js";
import "./custom/hubspot-signing.js";
import "./custom/mailchimp-url-secret.js";
import "./custom/postmark-signing.js";
import "./custom/notion-signing.js";

import type { ProviderCatalogEntry, RulePredicate } from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../catalog.js";
import { bitbucketSignaturePrefixNotStrippedPredicate } from "./bitbucket-signature-prefix.js";
import { calendlySignatureHeaderParseMishandledPredicate } from "./calendly-header-parse.js";
import { expressMiddlewareOrderingPredicate } from "./express-middleware-ordering.js";
import { githubPhpTimingSafeEqualPredicate } from "./github-php-timing-safe-equal.js";
import { githubTimingSafeEqualPredicate } from "./github-timing-safe-equal.js";
import { intercomOctokitCrossAttributionPredicate } from "./intercom-octokit-cross-attribution.js";
import {
  githubLibraryVerifiedPredicate,
  shopifyLibraryVerifiedPredicate,
  slackLibraryVerifiedPredicate,
  squareLibraryVerifiedPredicate,
  standardwebhooksLibraryVerifiedPredicate,
  stripeLibraryVerifiedPredicate,
  twilioLibraryVerifiedPredicate,
} from "./library-verified-recognition.js";
import { mailchimpUrlSecretInPathPredicate } from "./mailchimp-url-secret-in-path.js";
import {
  auth0MissingSignatureVerificationPredicate,
  bitbucketMissingSignatureVerificationPredicate,
  calendlyMissingSignatureVerificationPredicate,
  createMissingSignatureVerificationPredicate,
  docusignMissingSignatureVerificationPredicate,
  githubMissingSignatureVerificationPredicate,
  hubspotMissingSignatureVerificationPredicate,
  intercomMissingSignatureVerificationPredicate,
  linearMissingSignatureVerificationPredicate,
  mailchimpMissingSignatureVerificationPredicate,
  notionMissingSignatureVerificationPredicate,
  pagerdutyMissingSignatureVerificationPredicate,
  postmarkMissingSignatureVerificationPredicate,
  sentryMissingSignatureVerificationPredicate,
  shopifyMissingSignatureVerificationPredicate,
  slackMissingSignatureVerificationPredicate,
  squareMissingSignatureVerificationPredicate,
  standardwebhooksMissingSignatureVerificationPredicate,
  stripeMissingSignatureVerificationPredicate,
  twilioMissingSignatureVerificationPredicate,
  zendeskMissingSignatureVerificationPredicate,
  zoomMissingSignatureVerificationPredicate,
} from "./missing-signature-verification.js";
import {
  auth0MissingTimestampCheckPredicate,
  bitbucketMissingTimestampCheckPredicate,
  calendlyMissingTimestampCheckPredicate,
  createMissingTimestampCheckPredicate,
  docusignMissingTimestampCheckPredicate,
  githubMissingTimestampCheckPredicate,
  hubspotMissingTimestampCheckPredicate,
  intercomMissingTimestampCheckPredicate,
  linearMissingTimestampCheckPredicate,
  pagerdutyMissingTimestampCheckPredicate,
  sentryMissingTimestampCheckPredicate,
  shopifyMissingTimestampCheckPredicate,
  slackMissingTimestampCheckPredicate,
  standardwebhooksMissingTimestampCheckPredicate,
  stripeMissingTimestampCheckPredicate,
  twilioMissingTimestampCheckPredicate,
  zendeskMissingTimestampCheckPredicate,
  zoomMissingTimestampCheckPredicate,
} from "./missing-timestamp-check.js";
import { n8nTriggerNoAuthPredicate } from "./n8n-trigger-auth.js";
import { notionVerificationTokenOnlyPredicate } from "./notion-verification-token-only.js";
import { pagerdutyMultiSignatureRotationMishandledPredicate } from "./pagerduty-multi-signature.js";
import {
  postmarkMissingBasicAuthPredicate,
  postmarkMissingIpAllowlistPredicate,
} from "./postmark-basic-auth.js";
import {
  auth0RawBodyMisusePredicate,
  bitbucketRawBodyMisusePredicate,
  calendlyRawBodyMisusePredicate,
  createRawBodyMisusePredicate,
  docusignRawBodyMisusePredicate,
  githubRawBodyMisusePredicate,
  hubspotRawBodyMisusePredicate,
  intercomRawBodyMisusePredicate,
  linearRawBodyMisusePredicate,
  mailchimpRawBodyMisusePredicate,
  notionRawBodyMisusePredicate,
  pagerdutyRawBodyMisusePredicate,
  postmarkRawBodyMisusePredicate,
  sentryRawBodyMisusePredicate,
  shopifyRawBodyMisusePredicate,
  slackRawBodyMisusePredicate,
  squareRawBodyMisusePredicate,
  standardwebhooksRawBodyMisusePredicate,
  stripeRawBodyMisusePredicate,
  twilioRawBodyMisusePredicate,
  zendeskRawBodyMisusePredicate,
  zoomRawBodyMisusePredicate,
} from "./raw-body-misuse.js";
import { createReplayWindowTooPermissivePredicate } from "./replay-window-too-permissive.js";
import { createSecretInLogOrErrorPredicate } from "./secret-in-log-or-error.js";
import { sentryHeaderConfusionPredicate } from "./sentry-header-confusion.js";
import { stripeEmptySecretPredicate } from "./stripe-empty-secret.js";
import { stripePhpTimingUnsafeComparisonPredicate } from "./stripe-php-timing-unsafe-comparison.js";
import { createTestModeBypassPredicate } from "./test-mode-bypass.js";
import {
  auth0TimingUnsafeComparisonPredicate,
  bitbucketTimingUnsafeComparisonPredicate,
  calendlyTimingUnsafeComparisonPredicate,
  createTimingUnsafeComparisonPredicate,
  docusignTimingUnsafeComparisonPredicate,
  hubspotTimingUnsafeComparisonPredicate,
  intercomTimingUnsafeComparisonPredicate,
  linearTimingUnsafeComparisonPredicate,
  mailchimpTimingUnsafeComparisonPredicate,
  notionTimingUnsafeComparisonPredicate,
  pagerdutyTimingUnsafeComparisonPredicate,
  postmarkTimingUnsafeComparisonPredicate,
  sentryTimingUnsafeComparisonPredicate,
  shopifyTimingUnsafeComparisonPredicate,
  slackTimingUnsafeComparisonPredicate,
  squareTimingUnsafeComparisonPredicate,
  standardwebhooksTimingUnsafeComparisonPredicate,
  stripeTimingUnsafeComparisonPredicate,
  twilioTimingUnsafeComparisonPredicate,
  zendeskTimingUnsafeComparisonPredicate,
  zoomTimingUnsafeComparisonPredicate,
} from "./timing-unsafe-comparison.js";
import {
  auth0UnreachableVerificationPredicate,
  bitbucketUnreachableVerificationPredicate,
  calendlyUnreachableVerificationPredicate,
  docusignUnreachableVerificationPredicate,
  githubUnreachableVerificationPredicate,
  hubspotUnreachableVerificationPredicate,
  intercomUnreachableVerificationPredicate,
  linearUnreachableVerificationPredicate,
  mailchimpUnreachableVerificationPredicate,
  notionUnreachableVerificationPredicate,
  pagerdutyUnreachableVerificationPredicate,
  postmarkUnreachableVerificationPredicate,
  sentryUnreachableVerificationPredicate,
  shopifyUnreachableVerificationPredicate,
  slackUnreachableVerificationPredicate,
  squareUnreachableVerificationPredicate,
  standardwebhooksUnreachableVerificationPredicate,
  stripeUnreachableVerificationPredicate,
  twilioUnreachableVerificationPredicate,
  zendeskUnreachableVerificationPredicate,
  zoomUnreachableVerificationPredicate,
} from "./unreachable-verification.js";
import { createVerificationErrorSwallowedPredicate } from "./verification-error-swallowed.js";
import { createVerifyAfterSideEffectPredicate } from "./verify-after-side-effect.js";
import {
  auth0WrongHmacAlgorithmPredicate,
  bitbucketWrongHmacAlgorithmPredicate,
  calendlyWrongHmacAlgorithmPredicate,
  docusignWrongHmacAlgorithmPredicate,
  githubWrongHmacAlgorithmPredicate,
  hubspotWrongHmacAlgorithmPredicate,
  intercomWrongHmacAlgorithmPredicate,
  linearWrongHmacAlgorithmPredicate,
  notionWrongHmacAlgorithmPredicate,
  pagerdutyWrongHmacAlgorithmPredicate,
  sentryWrongHmacAlgorithmPredicate,
  shopifyWrongHmacAlgorithmPredicate,
  slackWrongHmacAlgorithmPredicate,
  squareWrongHmacAlgorithmPredicate,
  standardwebhooksWrongHmacAlgorithmPredicate,
  stripeWrongHmacAlgorithmPredicate,
  twilioWrongHmacAlgorithmPredicate,
  zendeskWrongHmacAlgorithmPredicate,
  zoomWrongHmacAlgorithmPredicate,
} from "./wrong-hmac-algorithm.js";
import { zoomUrlValidationOnlyPredicate } from "./zoom-url-validation-only.js";

export const ALL_PREDICATES: Readonly<Record<string, RulePredicate>> = {
  // Phase 2 / Wave 1
  "github-timing-safe-equal": githubTimingSafeEqualPredicate,
  // Wave 2 cross-cutting
  "express-middleware-ordering": expressMiddlewareOrderingPredicate,
  // v0.7 Rule Depth (VAS-01) — per-provider factory that emits manual-review
  // when the engine attaches `side_effect_before_verify` evidence to a handler.
  // Provider-scoped registry keys mirror the missing-signature-verification
  // pattern so per-provider YAML rules can reference them as predicates.
  "stripe-verify-after-side-effect": createVerifyAfterSideEffectPredicate("stripe"),
  "github-verify-after-side-effect": createVerifyAfterSideEffectPredicate("github"),
  "shopify-verify-after-side-effect": createVerifyAfterSideEffectPredicate("shopify"),
  "twilio-verify-after-side-effect": createVerifyAfterSideEffectPredicate("twilio"),
  "slack-verify-after-side-effect": createVerifyAfterSideEffectPredicate("slack"),
  "square-verify-after-side-effect": createVerifyAfterSideEffectPredicate("square"),
  "zendesk-verify-after-side-effect": createVerifyAfterSideEffectPredicate("zendesk"),
  "docusign-verify-after-side-effect": createVerifyAfterSideEffectPredicate("docusign"),
  "intercom-verify-after-side-effect": createVerifyAfterSideEffectPredicate("intercom"),
  "linear-verify-after-side-effect": createVerifyAfterSideEffectPredicate("linear"),
  "hubspot-verify-after-side-effect": createVerifyAfterSideEffectPredicate("hubspot"),
  "auth0-verify-after-side-effect": createVerifyAfterSideEffectPredicate("auth0"),
  "mailchimp-verify-after-side-effect": createVerifyAfterSideEffectPredicate("mailchimp"),
  "postmark-verify-after-side-effect": createVerifyAfterSideEffectPredicate("postmark"),
  "sentry-verify-after-side-effect": createVerifyAfterSideEffectPredicate("sentry"),
  "pagerduty-verify-after-side-effect": createVerifyAfterSideEffectPredicate("pagerduty"),
  "bitbucket-verify-after-side-effect": createVerifyAfterSideEffectPredicate("bitbucket"),
  "notion-verify-after-side-effect": createVerifyAfterSideEffectPredicate("notion"),
  "calendly-verify-after-side-effect": createVerifyAfterSideEffectPredicate("calendly"),
  "zoom-verify-after-side-effect": createVerifyAfterSideEffectPredicate("zoom"),
  "standardwebhooks-verify-after-side-effect":
    createVerifyAfterSideEffectPredicate("standardwebhooks"),
  "stripe-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "stripe",
    PROVIDER_CATALOG["stripe"] as ProviderCatalogEntry,
  ),
  "github-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "github",
    PROVIDER_CATALOG["github"] as ProviderCatalogEntry,
  ),
  "shopify-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "shopify",
    PROVIDER_CATALOG["shopify"] as ProviderCatalogEntry,
  ),
  "twilio-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "twilio",
    PROVIDER_CATALOG["twilio"] as ProviderCatalogEntry,
  ),
  "slack-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "slack",
    PROVIDER_CATALOG["slack"] as ProviderCatalogEntry,
  ),
  "square-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "square",
    PROVIDER_CATALOG["square"] as ProviderCatalogEntry,
  ),
  "zendesk-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "zendesk",
    PROVIDER_CATALOG["zendesk"] as ProviderCatalogEntry,
  ),
  "docusign-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "docusign",
    PROVIDER_CATALOG["docusign"] as ProviderCatalogEntry,
  ),
  "intercom-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "intercom",
    PROVIDER_CATALOG["intercom"] as ProviderCatalogEntry,
  ),
  "linear-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "linear",
    PROVIDER_CATALOG["linear"] as ProviderCatalogEntry,
  ),
  "hubspot-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "hubspot",
    PROVIDER_CATALOG["hubspot"] as ProviderCatalogEntry,
  ),
  "auth0-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "auth0",
    PROVIDER_CATALOG["auth0"] as ProviderCatalogEntry,
  ),
  "mailchimp-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "mailchimp",
    PROVIDER_CATALOG["mailchimp"] as ProviderCatalogEntry,
  ),
  "postmark-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "postmark",
    PROVIDER_CATALOG["postmark"] as ProviderCatalogEntry,
  ),
  "sentry-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "sentry",
    PROVIDER_CATALOG["sentry"] as ProviderCatalogEntry,
  ),
  "pagerduty-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "pagerduty",
    PROVIDER_CATALOG["pagerduty"] as ProviderCatalogEntry,
  ),
  "bitbucket-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "bitbucket",
    PROVIDER_CATALOG["bitbucket"] as ProviderCatalogEntry,
  ),
  "notion-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "notion",
    PROVIDER_CATALOG["notion"] as ProviderCatalogEntry,
  ),
  "calendly-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "calendly",
    PROVIDER_CATALOG["calendly"] as ProviderCatalogEntry,
  ),
  "zoom-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "zoom",
    PROVIDER_CATALOG["zoom"] as ProviderCatalogEntry,
  ),
  "standardwebhooks-verification-error-swallowed": createVerificationErrorSwallowedPredicate(
    "standardwebhooks",
    PROVIDER_CATALOG["standardwebhooks"] as ProviderCatalogEntry,
  ),
  "stripe-test-mode-bypass": createTestModeBypassPredicate(
    "stripe",
    PROVIDER_CATALOG["stripe"] as ProviderCatalogEntry,
  ),
  "github-test-mode-bypass": createTestModeBypassPredicate(
    "github",
    PROVIDER_CATALOG["github"] as ProviderCatalogEntry,
  ),
  "shopify-test-mode-bypass": createTestModeBypassPredicate(
    "shopify",
    PROVIDER_CATALOG["shopify"] as ProviderCatalogEntry,
  ),
  "twilio-test-mode-bypass": createTestModeBypassPredicate(
    "twilio",
    PROVIDER_CATALOG["twilio"] as ProviderCatalogEntry,
  ),
  "slack-test-mode-bypass": createTestModeBypassPredicate(
    "slack",
    PROVIDER_CATALOG["slack"] as ProviderCatalogEntry,
  ),
  "square-test-mode-bypass": createTestModeBypassPredicate(
    "square",
    PROVIDER_CATALOG["square"] as ProviderCatalogEntry,
  ),
  "zendesk-test-mode-bypass": createTestModeBypassPredicate(
    "zendesk",
    PROVIDER_CATALOG["zendesk"] as ProviderCatalogEntry,
  ),
  "docusign-test-mode-bypass": createTestModeBypassPredicate(
    "docusign",
    PROVIDER_CATALOG["docusign"] as ProviderCatalogEntry,
  ),
  "intercom-test-mode-bypass": createTestModeBypassPredicate(
    "intercom",
    PROVIDER_CATALOG["intercom"] as ProviderCatalogEntry,
  ),
  "linear-test-mode-bypass": createTestModeBypassPredicate(
    "linear",
    PROVIDER_CATALOG["linear"] as ProviderCatalogEntry,
  ),
  "hubspot-test-mode-bypass": createTestModeBypassPredicate(
    "hubspot",
    PROVIDER_CATALOG["hubspot"] as ProviderCatalogEntry,
  ),
  "auth0-test-mode-bypass": createTestModeBypassPredicate(
    "auth0",
    PROVIDER_CATALOG["auth0"] as ProviderCatalogEntry,
  ),
  "mailchimp-test-mode-bypass": createTestModeBypassPredicate(
    "mailchimp",
    PROVIDER_CATALOG["mailchimp"] as ProviderCatalogEntry,
  ),
  "postmark-test-mode-bypass": createTestModeBypassPredicate(
    "postmark",
    PROVIDER_CATALOG["postmark"] as ProviderCatalogEntry,
  ),
  "sentry-test-mode-bypass": createTestModeBypassPredicate(
    "sentry",
    PROVIDER_CATALOG["sentry"] as ProviderCatalogEntry,
  ),
  "pagerduty-test-mode-bypass": createTestModeBypassPredicate(
    "pagerduty",
    PROVIDER_CATALOG["pagerduty"] as ProviderCatalogEntry,
  ),
  "bitbucket-test-mode-bypass": createTestModeBypassPredicate(
    "bitbucket",
    PROVIDER_CATALOG["bitbucket"] as ProviderCatalogEntry,
  ),
  "notion-test-mode-bypass": createTestModeBypassPredicate(
    "notion",
    PROVIDER_CATALOG["notion"] as ProviderCatalogEntry,
  ),
  "calendly-test-mode-bypass": createTestModeBypassPredicate(
    "calendly",
    PROVIDER_CATALOG["calendly"] as ProviderCatalogEntry,
  ),
  "zoom-test-mode-bypass": createTestModeBypassPredicate(
    "zoom",
    PROVIDER_CATALOG["zoom"] as ProviderCatalogEntry,
  ),
  "standardwebhooks-test-mode-bypass": createTestModeBypassPredicate(
    "standardwebhooks",
    PROVIDER_CATALOG["standardwebhooks"] as ProviderCatalogEntry,
  ),
  "stripe-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "stripe",
    PROVIDER_CATALOG["stripe"] as ProviderCatalogEntry,
  ),
  "github-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "github",
    PROVIDER_CATALOG["github"] as ProviderCatalogEntry,
  ),
  "shopify-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "shopify",
    PROVIDER_CATALOG["shopify"] as ProviderCatalogEntry,
  ),
  "twilio-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "twilio",
    PROVIDER_CATALOG["twilio"] as ProviderCatalogEntry,
  ),
  "slack-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "slack",
    PROVIDER_CATALOG["slack"] as ProviderCatalogEntry,
  ),
  "square-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "square",
    PROVIDER_CATALOG["square"] as ProviderCatalogEntry,
  ),
  "zendesk-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "zendesk",
    PROVIDER_CATALOG["zendesk"] as ProviderCatalogEntry,
  ),
  "docusign-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "docusign",
    PROVIDER_CATALOG["docusign"] as ProviderCatalogEntry,
  ),
  "intercom-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "intercom",
    PROVIDER_CATALOG["intercom"] as ProviderCatalogEntry,
  ),
  "linear-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "linear",
    PROVIDER_CATALOG["linear"] as ProviderCatalogEntry,
  ),
  "hubspot-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "hubspot",
    PROVIDER_CATALOG["hubspot"] as ProviderCatalogEntry,
  ),
  "auth0-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "auth0",
    PROVIDER_CATALOG["auth0"] as ProviderCatalogEntry,
  ),
  "mailchimp-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "mailchimp",
    PROVIDER_CATALOG["mailchimp"] as ProviderCatalogEntry,
  ),
  "postmark-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "postmark",
    PROVIDER_CATALOG["postmark"] as ProviderCatalogEntry,
  ),
  "sentry-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "sentry",
    PROVIDER_CATALOG["sentry"] as ProviderCatalogEntry,
  ),
  "pagerduty-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "pagerduty",
    PROVIDER_CATALOG["pagerduty"] as ProviderCatalogEntry,
  ),
  "bitbucket-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "bitbucket",
    PROVIDER_CATALOG["bitbucket"] as ProviderCatalogEntry,
  ),
  "notion-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "notion",
    PROVIDER_CATALOG["notion"] as ProviderCatalogEntry,
  ),
  "calendly-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "calendly",
    PROVIDER_CATALOG["calendly"] as ProviderCatalogEntry,
  ),
  "zoom-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "zoom",
    PROVIDER_CATALOG["zoom"] as ProviderCatalogEntry,
  ),
  "standardwebhooks-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "standardwebhooks",
    PROVIDER_CATALOG["standardwebhooks"] as ProviderCatalogEntry,
  ),
  "stripe-replay-window-too-permissive": createReplayWindowTooPermissivePredicate(
    "stripe",
    PROVIDER_CATALOG["stripe"] as ProviderCatalogEntry,
  ),
  "slack-replay-window-too-permissive": createReplayWindowTooPermissivePredicate(
    "slack",
    PROVIDER_CATALOG["slack"] as ProviderCatalogEntry,
  ),
  "shopify-replay-window-too-permissive": createReplayWindowTooPermissivePredicate(
    "shopify",
    PROVIDER_CATALOG["shopify"] as ProviderCatalogEntry,
  ),
  "standardwebhooks-replay-window-too-permissive": createReplayWindowTooPermissivePredicate(
    "standardwebhooks",
    PROVIDER_CATALOG["standardwebhooks"] as ProviderCatalogEntry,
  ),
  "stripe-library-verified": stripeLibraryVerifiedPredicate,
  "github-library-verified": githubLibraryVerifiedPredicate,
  // Wave 3 Stripe pack (D-93 refactor — sourced from catalog-parameterized factories)
  "stripe-missing-signature-verification": stripeMissingSignatureVerificationPredicate,
  "stripe-timing-unsafe-comparison": stripeTimingUnsafeComparisonPredicate,
  "stripe-raw-body-misuse": stripeRawBodyMisusePredicate,
  "stripe-missing-timestamp-check": stripeMissingTimestampCheckPredicate,
  "stripe-wrong-hmac-algorithm": stripeWrongHmacAlgorithmPredicate,
  "stripe-unreachable-verification": stripeUnreachableVerificationPredicate,
  // Wave 4 GitHub pack (D-93 refactor — sourced from catalog-parameterized factories)
  "github-missing-signature-verification": githubMissingSignatureVerificationPredicate,
  "github-raw-body-misuse": githubRawBodyMisusePredicate,
  "github-missing-timestamp-check": githubMissingTimestampCheckPredicate,
  "github-wrong-hmac-algorithm": githubWrongHmacAlgorithmPredicate,
  "github-unreachable-verification": githubUnreachableVerificationPredicate,
  // Phase 6.2 Shopify pack (parameterized raw_body recipe; no custom predicate)
  "shopify-library-verified": shopifyLibraryVerifiedPredicate,
  "shopify-missing-signature-verification": shopifyMissingSignatureVerificationPredicate,
  "shopify-timing-unsafe-comparison": shopifyTimingUnsafeComparisonPredicate,
  "shopify-raw-body-misuse": shopifyRawBodyMisusePredicate,
  "shopify-missing-timestamp-check": shopifyMissingTimestampCheckPredicate,
  "shopify-wrong-hmac-algorithm": shopifyWrongHmacAlgorithmPredicate,
  "shopify-unreachable-verification": shopifyUnreachableVerificationPredicate,
  // Phase 6.3 Twilio pack (signing_input_format: 'custom' — dispatches via D-92 custom slot)
  "twilio-library-verified": twilioLibraryVerifiedPredicate,
  "twilio-missing-signature-verification": twilioMissingSignatureVerificationPredicate,
  "twilio-timing-unsafe-comparison": twilioTimingUnsafeComparisonPredicate,
  "twilio-raw-body-misuse": twilioRawBodyMisusePredicate,
  "twilio-missing-timestamp-check": twilioMissingTimestampCheckPredicate,
  "twilio-wrong-hmac-algorithm": twilioWrongHmacAlgorithmPredicate,
  "twilio-unreachable-verification": twilioUnreachableVerificationPredicate,
  // Phase 6.4 Slack pack (signing_input_format: 'timestamp_dot_body'; first non-null timestamp_header)
  "slack-library-verified": slackLibraryVerifiedPredicate,
  "slack-missing-signature-verification": slackMissingSignatureVerificationPredicate,
  "slack-timing-unsafe-comparison": slackTimingUnsafeComparisonPredicate,
  "slack-raw-body-misuse": slackRawBodyMisusePredicate,
  "slack-missing-timestamp-check": slackMissingTimestampCheckPredicate,
  "slack-wrong-hmac-algorithm": slackWrongHmacAlgorithmPredicate,
  "slack-unreachable-verification": slackUnreachableVerificationPredicate,
  // Phase 6.5 Square pack (signing_input_format: 'custom_field_tuple'; URL+body canonical-string;
  // no missing-timestamp-check, no hardcoded-secret-prefix per D-95 verification)
  "square-library-verified": squareLibraryVerifiedPredicate,
  "square-missing-signature-verification": squareMissingSignatureVerificationPredicate,
  "square-timing-unsafe-comparison": squareTimingUnsafeComparisonPredicate,
  "square-raw-body-misuse": squareRawBodyMisusePredicate,
  "square-wrong-hmac-algorithm": squareWrongHmacAlgorithmPredicate,
  "square-unreachable-verification": squareUnreachableVerificationPredicate,
  // Phase 8.1 Plan 08 PHP-specific predicates (D-04 layer 2 — per-provider PHP anchors that
  // can't be expressed via the language-agnostic reachable_symbols path because engine
  // reachability is bounded to babel + tree-sitter-python in v1).
  "stripe-php-timing-unsafe-comparison": stripePhpTimingUnsafeComparisonPredicate,
  "github-php-timing-safe-equal": githubPhpTimingSafeEqualPredicate,
  // Phase 8.3 Plan 01 Zendesk pack (signing_input_format: 'timestamp_dot_body' — Slack analog).
  // No library-verified rule: Zendesk has no canonical first-party webhook SDK.
  "zendesk-missing-signature-verification": zendeskMissingSignatureVerificationPredicate,
  "zendesk-timing-unsafe-comparison": zendeskTimingUnsafeComparisonPredicate,
  "zendesk-raw-body-misuse": zendeskRawBodyMisusePredicate,
  "zendesk-missing-timestamp-check": zendeskMissingTimestampCheckPredicate,
  "zendesk-wrong-hmac-algorithm": zendeskWrongHmacAlgorithmPredicate,
  "zendesk-unreachable-verification": zendeskUnreachableVerificationPredicate,
  // Phase 8.3 Plan 03 Intercom pack (signing_input_format: 'raw_body' — GitHub analog;
  // X-Hub-Signature is literally GitHub's own header name). No library-verified rule:
  // Intercom has no canonical first-party webhook SDK (intercom-client is the general
  // API SDK, not a webhook verifier).
  "intercom-missing-signature-verification": intercomMissingSignatureVerificationPredicate,
  "intercom-timing-unsafe-comparison": intercomTimingUnsafeComparisonPredicate,
  "intercom-raw-body-misuse": intercomRawBodyMisusePredicate,
  "intercom-missing-timestamp-check": intercomMissingTimestampCheckPredicate,
  "intercom-wrong-hmac-algorithm": intercomWrongHmacAlgorithmPredicate,
  "intercom-unreachable-verification": intercomUnreachableVerificationPredicate,
  // Phase 8.3 Plan 03 retrofit — Intercom + @octokit/webhooks cross-attribution.
  // X-Hub-Signature header re-use makes it tempting to verify Intercom signatures with
  // GitHub's @octokit/webhooks (which validates against the GitHub secret, not Intercom's).
  // Predicate at predicates/intercom-octokit-cross-attribution.ts emits not-verified when
  // import_source = "@octokit/webhooks" or "@octokit/webhooks-methods" is reachable from
  // an Intercom handler.
  "intercom-octokit-cross-attribution": intercomOctokitCrossAttributionPredicate,
  // Phase 8.3 Plan 04 Linear pack (signing_input_format: 'raw_body' — GitHub analog;
  // dedicated `Linear-Signature` header, no cross-provider attribution risk). No
  // library-verified rule: Linear has no canonical first-party webhook SDK
  // (@linear/sdk is the general GraphQL SDK, not a webhook verifier).
  "linear-missing-signature-verification": linearMissingSignatureVerificationPredicate,
  "linear-timing-unsafe-comparison": linearTimingUnsafeComparisonPredicate,
  "linear-raw-body-misuse": linearRawBodyMisusePredicate,
  "linear-missing-timestamp-check": linearMissingTimestampCheckPredicate,
  "linear-wrong-hmac-algorithm": linearWrongHmacAlgorithmPredicate,
  "linear-unreachable-verification": linearUnreachableVerificationPredicate,
  // Phase 8.3 Plan 02 DocuSign Connect pack (signing_input_format: 'raw_body' —
  // Shopify analog; dedicated `X-DocuSign-Signature-1` header, sha256/base64).
  // No library-verified rule: DocuSign Connect does not ship a first-party
  // webhook-verification SDK (docusign-esign is the general eSign SDK).
  "docusign-missing-signature-verification": docusignMissingSignatureVerificationPredicate,
  "docusign-timing-unsafe-comparison": docusignTimingUnsafeComparisonPredicate,
  "docusign-raw-body-misuse": docusignRawBodyMisusePredicate,
  "docusign-missing-timestamp-check": docusignMissingTimestampCheckPredicate,
  "docusign-wrong-hmac-algorithm": docusignWrongHmacAlgorithmPredicate,
  "docusign-unreachable-verification": docusignUnreachableVerificationPredicate,
  // Phase 8.3 Plan 06 Auth0 Log Streams pack (signing_input_format: 'raw_body' —
  // Shopify analog; dedicated `Auth0-Signature` header, sha256/base64 per pinned
  // default; doc-verification status recorded in 08.3-06-SUMMARY.md). No
  // library-verified rule: Auth0 SDKs do not ship a webhook-verification helper.
  "auth0-missing-signature-verification": auth0MissingSignatureVerificationPredicate,
  "auth0-timing-unsafe-comparison": auth0TimingUnsafeComparisonPredicate,
  "auth0-raw-body-misuse": auth0RawBodyMisusePredicate,
  "auth0-missing-timestamp-check": auth0MissingTimestampCheckPredicate,
  "auth0-wrong-hmac-algorithm": auth0WrongHmacAlgorithmPredicate,
  "auth0-unreachable-verification": auth0UnreachableVerificationPredicate,
  // Phase 8.3 Plan 05 HubSpot v3 pack (signing_input_format: 'custom' — dispatches
  // via D-92 custom slot at predicates/custom/hubspot-signing.ts). Canonical-string
  // is `${httpMethod}${requestURI}${rawBody}${timestamp}` under `X-HubSpot-Signature-v3`,
  // base64-encoded HMAC-SHA256.
  "hubspot-missing-signature-verification": hubspotMissingSignatureVerificationPredicate,
  "hubspot-timing-unsafe-comparison": hubspotTimingUnsafeComparisonPredicate,
  "hubspot-raw-body-misuse": hubspotRawBodyMisusePredicate,
  "hubspot-missing-timestamp-check": hubspotMissingTimestampCheckPredicate,
  "hubspot-wrong-hmac-algorithm": hubspotWrongHmacAlgorithmPredicate,
  "hubspot-unreachable-verification": hubspotUnreachableVerificationPredicate,
  // Phase 8.3 Plan 07 Mailchimp pack (signing_input_format: 'custom' — dispatches
  // via D-92 custom slot at predicates/custom/mailchimp-url-secret.ts). NEW rule
  // kind: url-secret-in-path — Mailchimp's default model is URL-secret-in-path,
  // not HMAC. The mailchimpUrlSecretInPathPredicate detects handlers whose
  // route_pattern includes a secret-shaped param name (:secret/:token/
  // <secret>/<token>/{secret}/{token}/etc.) and surfaces manual-review.
  "mailchimp-missing-signature-verification": mailchimpMissingSignatureVerificationPredicate,
  "mailchimp-url-secret-in-path": mailchimpUrlSecretInPathPredicate,
  "mailchimp-timing-unsafe-comparison": mailchimpTimingUnsafeComparisonPredicate,
  "mailchimp-raw-body-misuse": mailchimpRawBodyMisusePredicate,
  "mailchimp-unreachable-verification": mailchimpUnreachableVerificationPredicate,
  // Phase 8.3 Plan 08 Postmark pack (signing_input_format: 'custom' — dispatches
  // via D-92 custom slot at predicates/custom/postmark-signing.ts). NEW auth
  // model: HTTP Basic Auth + IP allowlist (no HMAC). The custom slot emits
  // not-verified when NEITHER layer is reachable; dedicated missing-basic-auth
  // and missing-ip-allowlist predicates surface manual-review on partial
  // coverage (one layer reached but not the other).
  "postmark-missing-signature-verification": postmarkMissingSignatureVerificationPredicate,
  "postmark-missing-basic-auth": postmarkMissingBasicAuthPredicate,
  "postmark-missing-ip-allowlist": postmarkMissingIpAllowlistPredicate,
  "postmark-timing-unsafe-comparison": postmarkTimingUnsafeComparisonPredicate,
  "postmark-raw-body-misuse": postmarkRawBodyMisusePredicate,
  "postmark-unreachable-verification": postmarkUnreachableVerificationPredicate,
  // Phase 8.3 Plan 09 DEFERRED — Datadog removed pre-v0.6.0 because Datadog
  // Webhooks integration does NOT natively HMAC-sign payloads (Svix review +
  // Datadog docs both confirm Basic Auth + OAuth 2.0 only). See
  // 08.3-09-SUMMARY.md §"Deferred to Plan 09b" and 08.3-19-SUMMARY.md.
  // Phase 8.3 Plan 10 Sentry Integration Platform pack (signing_input_format: 'raw_body' —
  // Linear/Auth0/Datadog analog; dedicated `Sentry-Hook-Signature` header, sha256/hex).
  // Companion `Sentry-Hook-Resource` header is for event-type routing only, not verification.
  // No library-verified rule: Sentry SDKs (@sentry/node, @sentry/browser, sentry-sdk) are
  // observability clients, not webhook verifiers. [unverified-against-docs] tag recorded.
  "sentry-missing-signature-verification": sentryMissingSignatureVerificationPredicate,
  "sentry-timing-unsafe-comparison": sentryTimingUnsafeComparisonPredicate,
  "sentry-raw-body-misuse": sentryRawBodyMisusePredicate,
  "sentry-missing-timestamp-check": sentryMissingTimestampCheckPredicate,
  "sentry-wrong-hmac-algorithm": sentryWrongHmacAlgorithmPredicate,
  "sentry-unreachable-verification": sentryUnreachableVerificationPredicate,
  // Phase 8.3 Plan 10 retrofit — Sentry-Hook-Signature vs Sentry-Hook-Resource confusion.
  // Documented bug pattern: handler HMAC-verifies the wrong Sentry-Hook-* header. Predicate
  // at predicates/sentry-header-confusion.ts emits manual-review when manual HMAC is
  // reachable but no signature_header_read evidence is present.
  "sentry-header-confusion": sentryHeaderConfusionPredicate,
  // Phase 8.3 Plan 11 PagerDuty v3 pack (signing_input_format: 'raw_body' — Linear/Datadog/Sentry
  // analog for the six baseline rules). Adds a NEW rule kind
  // `multi-signature-rotation-mishandled` — PagerDuty's `X-PagerDuty-Signature` header is
  // comma-separated `v1=<hex>,v1=<hex>` during key rotation; handlers that only check the
  // first token silently reject valid deliveries when rotation starts. The dedicated
  // predicate at predicates/pagerduty-multi-signature.ts emits manual-review when manual
  // HMAC is reachable but no .split / .forEach / .map / iteration symbol is reachable.
  // No library-verified rule: @pagerduty/pdjs + pdpyras are API clients, not webhook
  // verifiers. [unverified-against-docs] tag recorded.
  "pagerduty-missing-signature-verification": pagerdutyMissingSignatureVerificationPredicate,
  "pagerduty-timing-unsafe-comparison": pagerdutyTimingUnsafeComparisonPredicate,
  "pagerduty-raw-body-misuse": pagerdutyRawBodyMisusePredicate,
  "pagerduty-missing-timestamp-check": pagerdutyMissingTimestampCheckPredicate,
  "pagerduty-wrong-hmac-algorithm": pagerdutyWrongHmacAlgorithmPredicate,
  "pagerduty-unreachable-verification": pagerdutyUnreachableVerificationPredicate,
  "pagerduty-multi-signature-rotation-mishandled":
    pagerdutyMultiSignatureRotationMishandledPredicate,
  // Phase 8.3 Plan 12 Bitbucket Cloud pack (signing_input_format: 'raw_body' — GitHub/Intercom
  // analog for the six baseline rules; X-Hub-Signature is THREE-way shared across
  // github/intercom/bitbucket, so the catalog-parameterized provider scope guards
  // disambiguation). NEW rule kind `signature-prefix-not-stripped` — Bitbucket Cloud's
  // X-Hub-Signature value is `sha256=<hex>` (GitHub-legacy prefix); handlers that compare
  // the full value against bare HMAC hex always fail. Dedicated predicate at
  // predicates/bitbucket-signature-prefix.ts emits manual-review when manual HMAC reachable
  // + signature_header_read evidence present + no string-manipulation symbol reachable.
  // [unverified-against-docs] tag recorded.
  "bitbucket-missing-signature-verification": bitbucketMissingSignatureVerificationPredicate,
  "bitbucket-timing-unsafe-comparison": bitbucketTimingUnsafeComparisonPredicate,
  "bitbucket-raw-body-misuse": bitbucketRawBodyMisusePredicate,
  "bitbucket-missing-timestamp-check": bitbucketMissingTimestampCheckPredicate,
  "bitbucket-wrong-hmac-algorithm": bitbucketWrongHmacAlgorithmPredicate,
  "bitbucket-unreachable-verification": bitbucketUnreachableVerificationPredicate,
  "bitbucket-signature-prefix-not-stripped": bitbucketSignaturePrefixNotStrippedPredicate,
  // Phase 8.3 Plan 13 Notion pack (signing_input_format: 'custom' — dispatches via D-92
  // custom slot at predicates/custom/notion-signing.ts; sixth occupant). NEW rule kind
  // `verification-token-only` — Notion's two-phase auth (verification-token echo on setup +
  // HMAC signed payloads thereafter); handlers that read X-Notion-Signature but never compute
  // HMAC likely compare the signature against a stored verification token or trust it
  // unconditionally. Predicate at predicates/notion-verification-token-only.ts emits
  // manual-review on this pattern. [unverified-against-docs] tag recorded.
  "notion-missing-signature-verification": notionMissingSignatureVerificationPredicate,
  "notion-verification-token-only": notionVerificationTokenOnlyPredicate,
  "notion-timing-unsafe-comparison": notionTimingUnsafeComparisonPredicate,
  "notion-raw-body-misuse": notionRawBodyMisusePredicate,
  "notion-wrong-hmac-algorithm": notionWrongHmacAlgorithmPredicate,
  "notion-unreachable-verification": notionUnreachableVerificationPredicate,
  // Phase 8.3 Plan 14 Calendly pack (signing_input_format: 'timestamp_dot_body' — Slack
  // signing recipe + Stripe-shaped comma-separated header `t=<unix>,v1=<hex>`). NEW rule
  // `signature-header-parse-mishandled` (predicate at predicates/calendly-header-parse.ts)
  // catches handlers that read the signature header + do manual HMAC but never parse the
  // comma-separated `t=`/`v1=` components — likely compare the full header value or hash
  // the body alone without the `${timestamp}.` prefix. [unverified-against-docs] tag recorded.
  "calendly-missing-signature-verification": calendlyMissingSignatureVerificationPredicate,
  "calendly-timing-unsafe-comparison": calendlyTimingUnsafeComparisonPredicate,
  "calendly-raw-body-misuse": calendlyRawBodyMisusePredicate,
  "calendly-missing-timestamp-check": calendlyMissingTimestampCheckPredicate,
  "calendly-wrong-hmac-algorithm": calendlyWrongHmacAlgorithmPredicate,
  "calendly-unreachable-verification": calendlyUnreachableVerificationPredicate,
  "calendly-signature-header-parse-mishandled": calendlySignatureHeaderParseMishandledPredicate,
  // Phase 8.3 Plan 17 Stripe empty-secret bypass detector (CVE-2026-41432). PARTIAL
  // coverage shipping JS/TS variants 1 (||), 2 (??), 3 (ternary), 6 (explicit empty
  // literal). Variants 4 (missing-guard) + 5 (optional-chain) + Python + PHP deferred
  // to Plan 17b — see 08.3-17-SUMMARY.md §"Known-incomplete arms".
  "stripe-empty-secret-bypass": stripeEmptySecretPredicate,
  // Phase 8.3 Plan 15 Zoom pack (signing_input_format: 'timestamp_dot_body' — Slack signing
  // recipe `v0:${X-Zm-Request-Timestamp}:${rawBody}`). Catalog-parameterized factories
  // reuse the Slack family per plan's "REUSE Slack v0:" directive — no new generic
  // predicate authored. NEW rule `url-validation-only` (predicate at
  // predicates/zoom-url-validation-only.ts) catches handlers that pass Zoom's URL-validation
  // handshake but never verify X-Zm-Signature on subsequent runtime events.
  // [unverified-against-docs] tag recorded.
  "zoom-missing-signature-verification": zoomMissingSignatureVerificationPredicate,
  "zoom-url-validation-only": zoomUrlValidationOnlyPredicate,
  "zoom-timing-unsafe-comparison": zoomTimingUnsafeComparisonPredicate,
  "zoom-raw-body-misuse": zoomRawBodyMisusePredicate,
  "zoom-missing-timestamp-check": zoomMissingTimestampCheckPredicate,
  "zoom-wrong-hmac-algorithm": zoomWrongHmacAlgorithmPredicate,
  "zoom-unreachable-verification": zoomUnreachableVerificationPredicate,
  // Phase 8.3 Plan 16 Standard Webhooks spec (signing_input_format: 'custom' — dispatches
  // via D-92 custom slot at predicates/custom/standardwebhooks-signing.ts). Library-prong
  // detection only; hand-rolled structural AST detection deferred to Plan 16b.
  "standardwebhooks-library-verified": standardwebhooksLibraryVerifiedPredicate,
  "standardwebhooks-missing-signature-verification":
    standardwebhooksMissingSignatureVerificationPredicate,
  "standardwebhooks-timing-unsafe-comparison": standardwebhooksTimingUnsafeComparisonPredicate,
  "standardwebhooks-raw-body-misuse": standardwebhooksRawBodyMisusePredicate,
  "standardwebhooks-missing-timestamp-check": standardwebhooksMissingTimestampCheckPredicate,
  "standardwebhooks-wrong-hmac-algorithm": standardwebhooksWrongHmacAlgorithmPredicate,
  "standardwebhooks-unreachable-verification": standardwebhooksUnreachableVerificationPredicate,
  // Phase 24 Plan 02 (AGENT-01) — n8n detector #1: webhook-trigger-no-authentication.
  // Self-contained predicate (NOT a matcher-union variant). Reads the synthetic n8n
  // handler's `n8n_node_param` evidence ("authentication=<value>"); fires not-verified
  // on "none" or absent, silent on headerAuth/basicAuth/jwtAuth. Provider + n8n-workflow
  // framework guarded so a TS custom-node handler (detector #2) is never caught here.
  "n8n-trigger-no-auth": n8nTriggerNoAuthPredicate,
  // Phase 24 Plan 04 (AGENT-01) — n8n detector #2 + the 6 baseline rules. These run
  // against TS custom-node handlers tagged `provider:n8n` (Plan 24-03), reusing the
  // v0.7 VAS-01 / side-effect-classifier + the per-provider baseline factories,
  // parameterized for "n8n" with the n8n catalog entry.
  //
  // Detector #2: agent-tool-acts-on-unverified-payload — reuses the VAS-01
  // `side_effect_before_verify` evidence machinery. The n8n catalog entry adds the
  // agent/tool/LLM call names to the sink lists, so "agent invoked on the unverified
  // webhook body before any header check" is a T1 side-effect-before-verify. A
  // `getHeaderData()`-based verification earlier in the handler clears it (SC#2).
  "n8n-agent-tool-acts-on-unverified-payload": createVerifyAfterSideEffectPredicate("n8n"),
  "n8n-missing-signature-verification": createMissingSignatureVerificationPredicate(
    "n8n",
    PROVIDER_CATALOG["n8n"] as ProviderCatalogEntry,
  ),
  "n8n-missing-timestamp-check": createMissingTimestampCheckPredicate(
    "n8n",
    PROVIDER_CATALOG["n8n"] as ProviderCatalogEntry,
  ),
  // n8n/missing-timing-safe-equal reuses the constant-time-comparison detector
  // (timing-unsafe equality on attacker-influenced credential/HMAC input).
  "n8n-timing-safe-equal": createTimingUnsafeComparisonPredicate(
    "n8n",
    PROVIDER_CATALOG["n8n"] as ProviderCatalogEntry,
  ),
  "n8n-raw-body-misuse": createRawBodyMisusePredicate(
    "n8n",
    PROVIDER_CATALOG["n8n"] as ProviderCatalogEntry,
  ),
  "n8n-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "n8n",
    PROVIDER_CATALOG["n8n"] as ProviderCatalogEntry,
  ),
  // Phase 25 Plan 03 (AGENT-02) — Anthropic Agent SDK detector + the baseline rules.
  // Same machinery as n8n detector #2, re-parameterized for "anthropic-agent-sdk".
  //
  // Named detector: tool-callback-no-verification — reuses the VAS-01
  // `side_effect_before_verify` evidence machinery. The anthropic-agent-sdk catalog
  // entry adds the agent/tool/LLM call names to the sink lists, so "a tool() handler
  // acts on its unverified `args` payload at a side-effect sink before any HMAC check"
  // is a T1 side-effect-before-verify. A createHmac + timingSafeEqual verification
  // reachable before the sink clears it (SC#2). Unlike n8n (cross-file uncertainty ->
  // manual-review), the tool() handler is a single self-contained closure, so the
  // in-file order is observable -> the YAML ships at `not-verified` (critical) verdict.
  "anthropic-agent-sdk-tool-callback-no-verification":
    createVerifyAfterSideEffectPredicate("anthropic-agent-sdk"),
  "anthropic-agent-sdk-missing-signature-verification": createMissingSignatureVerificationPredicate(
    "anthropic-agent-sdk",
    PROVIDER_CATALOG["anthropic-agent-sdk"] as ProviderCatalogEntry,
  ),
  "anthropic-agent-sdk-missing-timestamp-check": createMissingTimestampCheckPredicate(
    "anthropic-agent-sdk",
    PROVIDER_CATALOG["anthropic-agent-sdk"] as ProviderCatalogEntry,
  ),
  "anthropic-agent-sdk-timing-safe-equal": createTimingUnsafeComparisonPredicate(
    "anthropic-agent-sdk",
    PROVIDER_CATALOG["anthropic-agent-sdk"] as ProviderCatalogEntry,
  ),
  "anthropic-agent-sdk-raw-body-misuse": createRawBodyMisusePredicate(
    "anthropic-agent-sdk",
    PROVIDER_CATALOG["anthropic-agent-sdk"] as ProviderCatalogEntry,
  ),
  "anthropic-agent-sdk-secret-in-log-or-error": createSecretInLogOrErrorPredicate(
    "anthropic-agent-sdk",
    PROVIDER_CATALOG["anthropic-agent-sdk"] as ProviderCatalogEntry,
  ),
};
