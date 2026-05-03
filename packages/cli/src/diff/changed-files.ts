// D-74 working-tree union: committed-vs-base ∪ staged ∪ unstaged. ACMR filter (excludes deleted). Untracked excluded.

import { gitDiffNames, gitDiffNamesStaged, gitDiffNamesUnstaged } from "./git.js";

export function changedFiles(base: string, cwd: string): ReadonlySet<string> {
  const committed = gitDiffNames(base, cwd); // <base>..HEAD, ACMR
  const staged = gitDiffNamesStaged(cwd); // --cached vs HEAD, ACMR
  const unstaged = gitDiffNamesUnstaged(cwd); // working tree vs HEAD, ACMR
  const all = new Set<string>();
  for (const f of committed) all.add(f);
  for (const f of staged) all.add(f);
  for (const f of unstaged) all.add(f);
  return all;
}
