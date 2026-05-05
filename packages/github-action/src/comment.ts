// Sticky PR summary comment — Plan 05-03 implements the body.
// This stub exists so Plan 05-02's index.ts dynamic-import resolves at compile time.

import type { ScanFinding } from './types.js';

export interface PostCommentInput {
  readonly newFindings: ReadonlyArray<ScanFinding>;
  readonly findingsCount: number;
  readonly isFork: boolean;
  readonly eventName: string;
}

export async function postOrUpdateStickyComment(
  _input: PostCommentInput,
): Promise<void> {
  throw new Error('Plan 05-03 not yet implemented');
}
