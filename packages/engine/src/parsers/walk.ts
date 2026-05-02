// Canonical iterative AST walkers. Engine has multiple readers (literal extraction, catalog
// detection, future reachability + middleware extraction in Plan 06b, evaluator dispatch in
// Plan 02-08) — all use the same depth-first walk.
//
// Iterative (not recursive) so deeply-nested ASTs cannot exhaust the JS stack — a real concern
// for adversarial source. Bounded by the parser's source-size cap (Phase 8 worker concern).

import type { Node } from "@babel/types";

// Keys we never recurse into. `loc` is metadata; `start`/`end` are byte offsets;
// `range` is a tuple alias for start/end; `type` is the node discriminator itself.
const SKIP_KEYS: ReadonlySet<string> = new Set(["loc", "type", "start", "end", "range"]);

/**
 * Walk a Babel AST depth-first, invoking `visitor` on every node.
 *
 * The visitor cannot stop traversal — call sites that need early-exit semantics
 * collect into an output array and inspect it after the walk completes.
 */
export function walkBabelAst(root: Node, visitor: (node: Node) => void): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    visitor(node);
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            stack.push(item as Node);
          }
        }
      } else if (value && typeof value === "object" && "type" in (value as object)) {
        stack.push(value as Node);
      }
    }
  }
}

// Untyped variant for the literals walker, which operates on `MaybeSpanned` (Babel `Node` is a
// discriminated union and cannot be `extends`-ed; the literals module needs to read `.start` /
// `.end` defensively across every branch). Behaviorally identical to walkBabelAst — same skip
// list, same iterative traversal — just typed `unknown` at the boundary.
export interface MaybeAstNode {
  readonly type?: string;
  readonly start?: number | null;
  readonly end?: number | null;
}

export function walkUntypedAst(
  root: MaybeAstNode | null | undefined,
  visitor: (node: MaybeAstNode) => void,
): void {
  if (!root || typeof root.type !== "string") return;
  const stack: MaybeAstNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    visitor(node);
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            stack.push(item as MaybeAstNode);
          }
        }
      } else if (value && typeof value === "object" && "type" in (value as object)) {
        stack.push(value as MaybeAstNode);
      }
    }
  }
}
