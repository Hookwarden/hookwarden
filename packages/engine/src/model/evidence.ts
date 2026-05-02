// D-32: every candidate handler is enriched with WebhookEvidence[] derived from the provider
// catalog. Engine computes evidence; rules query thresholds. Engine never decides "is webhook?" —
// that's rule-side. Engine assigns provider attribution heuristically (worst case "unknown").
//
// Phase 2 split: this function emits 6 of the 7 D-32 signals. The seventh —
// `sdk_verify_call` — is appended in Plan 06b's build.ts after reachable_symbols is computed.

import type { SourceLocation } from "../types/finding.js";
import type { WebhookEvidence } from "../types/handler.js";
import type { ImportEdge, ParsedFile } from "../types/project-model.js";
import type { ProviderCatalog } from "../types/rule-set.js";
import type { CandidateHandler } from "./catalog.js";

export interface ComputeEvidenceInput {
  readonly handler: CandidateHandler;
  readonly parsedFile: ParsedFile;
  readonly providerCatalog: ProviderCatalog;
  readonly imports: ReadonlyArray<ImportEdge>;
}

export interface ComputeEvidenceOutput {
  readonly evidence: ReadonlyArray<WebhookEvidence>;
  readonly provider: string; // resolved provider | "unknown" | "multiple"
}

export function computeEvidence(input: ComputeEvidenceInput): ComputeEvidenceOutput {
  const out: WebhookEvidence[] = [];
  const handlerLoc = input.handler.location;
  const handlerText = input.parsedFile.source_text.slice(
    input.handler.handler_source_start,
    input.handler.handler_source_end,
  );

  // Signal A — path_pattern_match (catalog conventional_paths).
  for (const [providerName, entry] of Object.entries(input.providerCatalog)) {
    for (const conv of entry.conventional_paths) {
      if (input.handler.route_pattern.toLowerCase().includes(conv.toLowerCase())) {
        out.push({
          kind: "path_pattern_match",
          provider: providerName,
          location: handlerLoc,
          detail: conv,
        });
      }
    }
  }

  // Signal B — sdk_import (catalog sdk_packages).
  for (const [providerName, entry] of Object.entries(input.providerCatalog)) {
    for (const pkg of entry.sdk_packages) {
      if (input.imports.some((i) => i.to_module === pkg)) {
        out.push({
          kind: "sdk_import",
          provider: providerName,
          location: handlerLoc,
          detail: pkg,
        });
      }
    }
  }

  // Signal C — secret_env_var_reference (catalog secret_env_prefix). Substring match within the
  // handler's source range so we count only references in/near this handler.
  for (const [providerName, entry] of Object.entries(input.providerCatalog)) {
    for (const env of entry.secret_env_prefix) {
      if (handlerText.includes(env)) {
        out.push({
          kind: "secret_env_var_reference",
          provider: providerName,
          location: handlerLoc,
          detail: env,
        });
      }
    }
  }

  // Signal D — secret_literal_match (catalog secret_literal_prefix). Restricted to handler text.
  for (const [providerName, entry] of Object.entries(input.providerCatalog)) {
    for (const prefix of entry.secret_literal_prefix) {
      if (handlerText.includes(prefix)) {
        out.push({
          kind: "secret_literal_match",
          provider: providerName,
          location: handlerLoc,
          detail: prefix,
        });
      }
    }
  }

  // Signal E — signature_header_read (catalog signature_header). Substring match on handler text.
  for (const [providerName, entry] of Object.entries(input.providerCatalog)) {
    for (const header of entry.signature_header) {
      if (handlerText.toLowerCase().includes(header.toLowerCase())) {
        out.push({
          kind: "signature_header_read",
          provider: providerName,
          location: handlerLoc,
          detail: header,
        });
      }
    }
  }

  // Signal F — body_as_bytes_or_buffer. Heuristic token search inside the handler.
  if (
    /(Buffer|Uint8Array|\braw\b|\bbytes\b|c\.req\.raw|request\.get_data\(\)|request\.body)/i.test(
      handlerText,
    )
  ) {
    out.push({
      kind: "body_as_bytes_or_buffer",
      provider: "unknown",
      location: handlerLoc,
      detail: "heuristic",
    });
  }

  // Signal G — sdk_verify_call: NOT EMITTED HERE. Plan 06b's build.ts appends it after computing
  // reachable_symbols, by cross-checking against catalog.providers[*].sdk_verify_calls.

  // Provider attribution — most-cited provider wins; ties → "multiple"; zero → "unknown".
  const counts = new Map<string, number>();
  for (const e of out) {
    if (e.provider === "unknown") continue;
    counts.set(e.provider, (counts.get(e.provider) ?? 0) + 1);
  }
  let topProvider = "unknown";
  let topCount = 0;
  let tied = false;
  for (const [p, c] of counts) {
    if (c > topCount) {
      topProvider = p;
      topCount = c;
      tied = false;
    } else if (c === topCount && c > 0) {
      tied = true;
    }
  }
  const provider = tied ? "multiple" : topProvider;
  return { evidence: out, provider };
}

export function locationFromCandidate(handler: CandidateHandler): SourceLocation {
  return handler.location;
}
