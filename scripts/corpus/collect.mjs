#!/usr/bin/env node
// Collects a 200-repo OSS corpus for hookwarden's false-positive measurement.
//
// Methodology:
//   - For each provider in the catalog (stripe, github, shopify, slack, square,
//     twilio, ...), search GitHub for repositories that either import the
//     provider SDK or contain a webhook handler at one of conventional_paths.
//   - Stratify by stars (small / mid / large) and language (TS+JS / Python)
//     so the corpus isn't just the 200 most-starred Stripe demos.
//   - Pin every repo to its current default-branch SHA so the corpus is
//     reproducible across hookwarden versions (delta runs only re-triage
//     findings whose status flipped).
//
// Output: .planning/research/corpus-200/repos.json — array of:
//   { provider, owner, repo, sha, stars, language, url, picked_for }
//
// Usage:
//   ./scripts/corpus/collect.mjs --target 200
//   ./scripts/corpus/collect.mjs --provider stripe --per-provider 30
//   ./scripts/corpus/collect.mjs --resume   (skip provider buckets already filled)
//
// Requires: gh CLI authenticated (gh auth login).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const PRIVATE_PLANNING_ROOT = resolve(REPO_ROOT, "..", "webhook-security", ".planning");
const CORPUS_DIR = join(PRIVATE_PLANNING_ROOT, "research", "corpus-200");
const CORPUS_FILE = join(CORPUS_DIR, "repos.json");

// Per-provider GitHub search hints. Each provider gets multiple search queries
// stratified across SDK-import patterns and conventional URL paths. The actual
// query API is `gh search code ... --json repository --limit N` which returns
// distinct repositories matching the code-search.
const PROVIDER_QUERIES = {
  stripe: [
    "stripe.webhooks.constructEvent language:typescript",
    "stripe.webhooks.constructEvent language:javascript",
    "stripe.webhook.construct_event language:python",
    "from stripe import language:python webhook",
  ],
  github: [
    "X-Hub-Signature-256 language:typescript",
    "X-Hub-Signature-256 language:javascript",
    "X-Hub-Signature-256 language:python",
    "@octokit/webhooks language:typescript",
  ],
  shopify: [
    "X-Shopify-Hmac-Sha256 language:typescript",
    "X-Shopify-Hmac-Sha256 language:javascript",
    "X-Shopify-Hmac-Sha256 language:python",
  ],
  slack: [
    "x-slack-signature language:typescript",
    "x-slack-signature language:python",
    "@slack/bolt language:typescript",
  ],
  square: [
    "x-square-hmacsha256-signature language:typescript",
    "x-square-hmacsha256-signature language:python",
  ],
  twilio: [
    "x-twilio-signature language:typescript",
    "x-twilio-signature language:python",
    "RequestValidator language:python twilio",
  ],
  // Phase 6b providers (when their catalog entries land):
  zendesk: [
    "X-Zendesk-Webhook-Signature language:typescript",
    "X-Zendesk-Webhook-Signature language:python",
  ],
  docusign: [
    "X-DocuSign-Signature-1 language:typescript",
    "X-DocuSign-Signature-1 language:python",
  ],
  intercom: [
    "intercom webhook X-Hub-Signature language:typescript",
    "intercom webhook X-Hub-Signature language:python",
  ],
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { target: 200, provider: null, perProvider: null, resume: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--target") out.target = Number(args[++i]);
    else if (a === "--provider") out.provider = args[++i];
    else if (a === "--per-provider") out.perProvider = Number(args[++i]);
    else if (a === "--resume") out.resume = true;
    else throw new Error(`unknown flag: ${a}`);
  }
  return out;
}

function gh(...args) {
  // Returns parsed JSON from `gh` CLI. Fails loudly on non-zero exit.
  try {
    const out = execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(out);
  } catch (err) {
    console.error(`[corpus.collect] gh ${args.join(" ")} failed:`, err.message ?? err);
    throw err;
  }
}

function searchProvider(provider, queries, limitPerQuery) {
  const seen = new Map(); // owner/repo -> repo metadata
  for (const q of queries) {
    process.stderr.write(`[corpus.collect] search ${provider}: ${q}\n`);
    const items = gh(
      "search",
      "code",
      q,
      "--limit",
      String(limitPerQuery),
      "--json",
      "repository,path",
    );
    for (const item of items) {
      const repo = item.repository;
      if (!repo || !repo.fullName) continue;
      if (seen.has(repo.fullName)) continue;
      seen.set(repo.fullName, {
        provider,
        full_name: repo.fullName,
        owner: repo.fullName.split("/")[0],
        repo: repo.fullName.split("/")[1],
        url: `https://github.com/${repo.fullName}`,
        picked_for: q,
        first_match_path: item.path,
      });
    }
  }
  return [...seen.values()];
}

function pinRepoSha(entry) {
  // Resolve the default-branch SHA so the corpus is reproducible.
  try {
    const data = gh(
      "api",
      `/repos/${entry.full_name}`,
      "--jq",
      "{sha:.default_branch,stars:.stargazers_count,language:.language,fork:.fork,archived:.archived}",
    );
    if (data.fork || data.archived) return null;
    const branch = data.sha ?? "main";
    const branchData = gh(
      "api",
      `/repos/${entry.full_name}/branches/${branch}`,
      "--jq",
      "{sha:.commit.sha}",
    );
    return {
      sha: branchData.sha,
      stars: data.stars ?? 0,
      language: data.language ?? null,
      fork: data.fork,
      archived: data.archived,
    };
  } catch {
    return null;
  }
}

function stratify(entries, target) {
  // Bucket by stars: small (<100), mid (100-1000), large (>1000). Pick proportionally.
  const small = entries.filter((e) => e.stars < 100);
  const mid = entries.filter((e) => e.stars >= 100 && e.stars <= 1000);
  const large = entries.filter((e) => e.stars > 1000);
  const buckets = { small, mid, large };
  const want = {
    small: Math.ceil(target * 0.3),
    mid: Math.ceil(target * 0.4),
    large: Math.ceil(target * 0.3),
  };
  const out = [];
  for (const [key, list] of Object.entries(buckets)) {
    list.sort((a, b) => b.stars - a.stars);
    out.push(...list.slice(0, want[key]));
  }
  return out;
}

function main() {
  const args = parseArgs();
  mkdirSync(CORPUS_DIR, { recursive: true });

  const providers = args.provider ? [args.provider] : Object.keys(PROVIDER_QUERIES);
  const perProvider = args.perProvider ?? Math.ceil(args.target / providers.length);

  let existing = [];
  if (args.resume) {
    try {
      existing = JSON.parse(readFileSync(CORPUS_FILE, "utf-8"));
    } catch {
      // first run; ignore.
    }
  }
  const seen = new Set(existing.map((e) => e.full_name));

  const collected = [...existing];
  for (const provider of providers) {
    const filledForProvider = existing.filter((e) => e.provider === provider).length;
    if (filledForProvider >= perProvider) {
      process.stderr.write(
        `[corpus.collect] skip ${provider} (already have ${filledForProvider})\n`,
      );
      continue;
    }
    const queries = PROVIDER_QUERIES[provider];
    if (!queries) {
      process.stderr.write(`[corpus.collect] no queries for ${provider}; skip\n`);
      continue;
    }
    const candidates = searchProvider(provider, queries, perProvider);
    process.stderr.write(`[corpus.collect] ${provider}: ${candidates.length} unique candidates\n`);

    const enriched = [];
    for (const c of candidates) {
      if (seen.has(c.full_name)) continue;
      const meta = pinRepoSha(c);
      if (!meta) continue; // archived/fork/error
      enriched.push({ ...c, ...meta });
      seen.add(c.full_name);
    }
    const stratified = stratify(enriched, perProvider);
    process.stderr.write(
      `[corpus.collect] ${provider}: kept ${stratified.length} after stratification\n`,
    );
    collected.push(...stratified);
  }

  collected.sort((a, b) => (a.provider + a.full_name).localeCompare(b.provider + b.full_name));
  writeFileSync(CORPUS_FILE, `${JSON.stringify(collected, null, 2)}\n`);
  process.stderr.write(`[corpus.collect] wrote ${collected.length} repos to ${CORPUS_FILE}\n`);
}

main();
