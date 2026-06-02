// Phase 8.5 REACH-01 — enqueue→consume reachability overlay.
//
// The D-34 reachability BFS (model/reachability.ts) models call + import edges only. The queue
// boundary — `raw body → queue.add(payload) → new Worker('q', fn) → fn verifies` — is neither, so a
// handler that hands the raw body to a worker reads as `not-verified` today (COMPETITIVE-LANDSCAPE
// §4.4 FP minefield). This pure overlay adds the missing edge: when a handler ENQUEUES THE RAW BODY
// via a known backend AND a CONSUMER of that backend has signature verification reachable, the handler
// earns a `queue_verification_reachable` evidence flag. The evaluator then downgrades the verdict
// `not-verified → manual-review` (never `verified` — the engine cannot prove the consumer verifies the
// SAME payload across the queue boundary; manual-review is the honest 3-state output).
//
// JS/TS (babel) only at v0.8 — same staged-rollout discipline as VAS-01 (Python/PHP queue patterns
// are rare and deferred). Reuses the capped BFS via computeReachableSymbols (MAX_VISITED_SYMBOLS +
// bounded depth, T-02-06b-04). Pure: no fs/http/net/process/fetch/node:*.

import type { Node } from "@babel/types";
import { walkBabelAst } from "../parsers/walk.js";
import type { ImportEdge, ParsedFile } from "../types/project-model.js";
import type { ProviderCatalog } from "../types/rule-set.js";
import { classify, type QueueBackendId } from "./queue-backends.js";
import { computeReachableSymbols } from "./reachability.js";

export interface QueueReachabilityInput {
  readonly handler_body_node: unknown;
  readonly handler_file: ParsedFile;
  readonly all_files: ReadonlyArray<ParsedFile>;
  readonly imports: ReadonlyArray<ImportEdge>;
  readonly maxDepth: number;
  readonly providerCatalog: ProviderCatalog;
}

// Identifiers / member-expression tails that denote the untrusted request body flowing into an
// enqueue payload. Conservative on purpose: this overlay SOFTENS not-verified → manual-review, so an
// over-broad match would hide a real not-verified bug (a false negative). We require an explicit
// request/raw-body reference, not just any object.
const RAW_BODY_IDENTIFIERS: ReadonlySet<string> = new Set([
  "req",
  "request",
  "rawbody",
  "rawpayload",
  "body",
  "payload",
]);
const RAW_BODY_MEMBER_TAILS: ReadonlySet<string> = new Set([
  "body",
  "rawbody",
  "text",
  "arraybuffer",
  "rawbuffer",
  "buffer",
]);

/** Dotted qualified name of an Identifier / MemberExpression callee, else null. */
function qnameBabel(node: Node): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const obj = qnameBabel(node.object);
    if (obj && node.property.type === "Identifier") return `${obj}.${node.property.name}`;
  }
  return null;
}

/** True when an enqueue call's argument subtree references the request / raw body. */
function argsReferenceRawBody(callArgs: ReadonlyArray<Node>): boolean {
  let found = false;
  for (const arg of callArgs) {
    walkBabelAst(arg, (node) => {
      if (found) return;
      if (node.type === "Identifier" && RAW_BODY_IDENTIFIERS.has(node.name.toLowerCase())) {
        found = true;
        return;
      }
      if (node.type === "MemberExpression" && node.property.type === "Identifier") {
        if (RAW_BODY_MEMBER_TAILS.has(node.property.name.toLowerCase())) found = true;
      }
    });
    if (found) return true;
  }
  return found;
}

/** Detect a raw-body enqueue in the handler body; return its backend or null. */
function detectRawBodyEnqueue(handlerBody: unknown): QueueBackendId | null {
  if (!handlerBody || typeof handlerBody !== "object") return null;
  let backend: QueueBackendId | null = null;
  walkBabelAst(handlerBody as Node, (node) => {
    if (backend !== null) return;
    if (node.type !== "CallExpression") return;
    const qn = qnameBabel(node.callee as Node);
    const c = classify(qn);
    if (c?.role === "enqueue" && argsReferenceRawBody(node.arguments as ReadonlyArray<Node>)) {
      backend = c.backend;
    }
  });
  return backend;
}

/** All function-valued nodes in a consumer-registration call's args (incl. object-property fns). */
function consumerCallbackBodies(callArgs: ReadonlyArray<Node>): Node[] {
  const out: Node[] = [];
  for (const arg of callArgs) {
    if (arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression") {
      out.push(arg.body);
    } else if (arg.type === "ObjectExpression") {
      // e.g. consumer.run({ eachMessage: async ({ message }) => { ... } })
      for (const prop of arg.properties) {
        if (
          prop.type === "ObjectProperty" &&
          (prop.value.type === "ArrowFunctionExpression" ||
            prop.value.type === "FunctionExpression")
        ) {
          out.push(prop.value.body);
        }
        if (
          prop.type === "ObjectMethod" &&
          (prop.kind === "method" || prop.kind === "get" || prop.kind === "set")
        ) {
          out.push(prop.body);
        }
      }
    }
  }
  return out;
}

/** Does any catalog provider's sdk_verify_call appear in this reachable-symbol set? */
function reachesVerifyCall(
  reachableQnames: ReadonlyArray<string>,
  providerCatalog: ProviderCatalog,
): boolean {
  const set = new Set(reachableQnames);
  for (const entry of Object.values(providerCatalog)) {
    for (const verifyCall of entry.sdk_verify_calls) {
      if (set.has(verifyCall)) return true;
      for (const qn of set) {
        if (qn.endsWith(`.${verifyCall}`)) return true;
      }
    }
    // Asymmetric (Ed25519) verify calls also count (Discord, Plan 05).
    for (const verifyCall of entry.asymmetric_verify_calls ?? []) {
      if (set.has(verifyCall)) return true;
      for (const qn of set) {
        if (qn.endsWith(`.${verifyCall}`)) return true;
      }
    }
  }
  return false;
}

/** Across all babel files, is there a verifying consumer registered for `backend`? */
function anyVerifyingConsumer(backend: QueueBackendId, input: QueueReachabilityInput): boolean {
  for (const file of input.all_files) {
    if (file.dialect !== "babel" || file.parse_error !== null || file.raw_ast === null) continue;
    let verified = false;
    walkBabelAst(file.raw_ast as Node, (node) => {
      if (verified) return;
      if (node.type !== "CallExpression" && node.type !== "NewExpression") return;
      const callee = node.callee;
      if (callee.type === "V8IntrinsicIdentifier") return;
      const c = classify(qnameBabel(callee));
      if (c?.role !== "consume" || c.backend !== backend) return;
      // SpreadElement / ArgumentPlaceholder simply won't match the function-node branches in
      // consumerCallbackBodies, so a plain cast is safe.
      for (const body of consumerCallbackBodies(node.arguments as ReadonlyArray<Node>)) {
        const reachable = computeReachableSymbols({
          handler_body_node: body,
          handler_file: file,
          all_files: input.all_files,
          imports: file.imports,
          maxDepth: input.maxDepth,
        });
        if (
          reachesVerifyCall(
            reachable.map((s) => s.qualified_name),
            input.providerCatalog,
          )
        ) {
          verified = true;
          return;
        }
      }
    });
    if (verified) return true;
  }
  return false;
}

/**
 * REACH-01 entry point. True iff the handler enqueues the raw body via a known backend AND a verifying
 * consumer for that backend is reachable. The caller (assembleHandler) emits
 * `queue_verification_reachable` evidence on a true result; the evaluator downgrades not-verified →
 * manual-review. NEVER asserts verified.
 */
export function isQueueVerificationReachable(input: QueueReachabilityInput): boolean {
  if (input.handler_file.dialect !== "babel") return false; // JS/TS only at v0.8
  const backend = detectRawBodyEnqueue(input.handler_body_node);
  if (backend === null) return false;
  return anyVerifyingConsumer(backend, input);
}
