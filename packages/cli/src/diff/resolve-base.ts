// D-72 resolve base ref: flag > GITHUB_BASE_REF > BUILDKITE > CI_MERGE_REQUEST > merge-base origin/HEAD > HEAD~1.

import { gitMergeBaseOriginHead } from "./git.js";

export interface ResolveBaseOpts {
  readonly explicitFlag?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
}

export interface ResolvedBase {
  readonly ref: string;
  readonly source: "flag" | "github" | "buildkite" | "gitlab" | "merge-base" | "head~1";
}

export function resolveBaseRef(opts: ResolveBaseOpts): ResolvedBase {
  if (opts.explicitFlag) {
    return { ref: opts.explicitFlag, source: "flag" };
  }
  const ghBase = opts.env["GITHUB_BASE_REF"];
  if (ghBase) {
    return { ref: `origin/${ghBase}`, source: "github" };
  }
  const bkBase = opts.env["BUILDKITE_PULL_REQUEST_BASE_BRANCH"];
  if (bkBase) {
    return { ref: `origin/${bkBase}`, source: "buildkite" };
  }
  const glBase = opts.env["CI_MERGE_REQUEST_TARGET_BRANCH_NAME"];
  if (glBase) {
    return { ref: `origin/${glBase}`, source: "gitlab" };
  }
  try {
    const sha = gitMergeBaseOriginHead(opts.cwd);
    return { ref: sha, source: "merge-base" };
  } catch {
    // Fall through to HEAD~1 final fallback.
  }
  return { ref: "HEAD~1", source: "head~1" };
}
