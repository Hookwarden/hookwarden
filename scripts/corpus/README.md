# Corpus harness — false-positive measurement against 200+ OSS repos

The "<5% high+critical false-positive rate on 200 real OSS webhook integrations" claim is hookwarden's marketing artifact (per Phase 6 success criterion #2 and the strategic Phase 6b kickoff doc in `webhook-security/.planning/research/phase-6b-providers.md`). This directory ships the harness that backs that claim with data.

## Scripts

| Script | What it does |
|---|---|
| `collect.mjs` | Searches GitHub for repos matching each catalog provider's signing patterns, stratifies by stars + language, pins each repo to its current default-branch SHA. Writes `.planning/research/corpus-200/repos.json`. |
| `measure-fp.mjs` | Clones every repo at its pinned SHA, runs `hookwarden scan --format json`, exports findings to JSONL. Idempotent across re-runs because finding IDs are stable hashes. |
| `measure-fp.mjs --report` | Joins findings against the manual triage decisions in `triage.json` and emits `REPORT.md` with the headline FP rate. |

## Triage workflow

The harness produces a JSONL file of every finding from every repo. **The bottleneck is human triage** — deciding whether each finding is a true positive (real bug), false positive (noise), or not-applicable (e.g., test fixture deliberately wrong). Realistic triage time is ~30 sec per finding; budget a half-day of focused work for a fresh 200-repo sweep.

Triage decisions live in `.planning/research/corpus-200/triage.json`:

```json
{
  "owner/repo@1234567abcde#fingerprint-or-fallback-id": "TP",
  "owner/repo@1234567abcde#fingerprint-or-fallback-id": "FP",
  "owner/repo@1234567abcde#fingerprint-or-fallback-id": "NA"
}
```

Re-running `measure-fp.mjs` after a hookwarden version bump only requires triage of NEW findings (existing ones inherit prior decisions via the finding_id key).

## Reproducibility

- `repos.json` pins every repository to a specific commit SHA. The corpus is reproducible across hookwarden versions.
- `findings.jsonl` is regenerated on every `measure-fp.mjs` run; safe to commit but updates frequently.
- `triage.json` is the durable artifact — committed; any new findings added by a hookwarden version bump should be triaged and committed separately.
- `REPORT.md` is generated from findings × triage; safe to commit (regenerable but useful as a marketing artifact snapshot).

## Marketing artifact

After a clean run with full triage:

```bash
$ cat REPORT.md | head -10
# Hookwarden corpus FP report

**Generated:** 2026-05-XX

## Headline
**2.1% high+critical false-positive rate (4 FP across 192 triaged)**
```

That single line is the buyer-call winner. Without the corpus, the <5% claim is just adjective. With it, the claim is data.

## Operating notes

- Run `gh auth login` before `collect.mjs` — the script uses `gh search code` and `gh api`.
- Network usage during collection is moderate (~few-hundred GH API calls).
- Network usage during measurement is significant — every repo gets cloned. Budget ~1-2 GB of disk and ~30 min for a full 200-repo sweep on a fast connection.
- Set `HOOKWARDEN_BIN=/path/to/built/cli` to scan against a specific build (defaults to the local CLI).
