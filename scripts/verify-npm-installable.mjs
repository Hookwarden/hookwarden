#!/usr/bin/env node
// Post-publish gate: fail loudly if the just-published `hookwarden@<version>` is not
// actually installable from npm. This is the check that was missing when 0.5.2/0.5.3
// shipped green while depending on an unpublished `@hookwarden/fix` (no OIDC Trusted
// Publisher binding) — `npm i hookwarden` failed for every user. Run in release.yml after
// publish; also runnable by hand:  node scripts/verify-npm-installable.mjs 0.5.4
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const version = String(process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error("usage: verify-npm-installable.mjs <version>   (e.g. 0.5.4)");
  process.exit(2);
}
const PKG = "hookwarden";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function registryHasVersion(ver) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PKG}`, {
      headers: { "cache-control": "no-cache" },
    });
    if (!res.ok) return false;
    const json = await res.json();
    return Boolean(json.versions?.[ver]);
  } catch {
    return false;
  }
}

// 1. Wait for the version to propagate to the registry (publish can lag a few seconds).
let visible = false;
for (let i = 0; i < 30; i++) {
  if (await registryHasVersion(version)) {
    visible = true;
    break;
  }
  await sleep(10_000);
}
if (!visible) {
  console.error(
    `❌ ${PKG}@${version} never appeared on npm after ~5 min — publish failed or was skipped.`,
  );
  process.exit(1);
}

// 2. Resolve the full dependency tree in a throwaway project. This is what catches a missing
//    or broken transitive @hookwarden/* dependency (the 0.5.2/0.5.3 failure mode).
const dir = mkdtempSync(join(tmpdir(), "hw-verify-"));
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "verify", private: true }));
const args = [
  "install",
  `${PKG}@${version}`,
  "--dry-run",
  "--prefer-online",
  "--no-audit",
  "--no-fund",
];
for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    const out = execFileSync("npm", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tail = out.trim().split("\n").slice(-1)[0];
    process.stdout.write(`✅ ${PKG}@${version} resolves cleanly — ${tail}\n`);
    process.exit(0);
  } catch (e) {
    const msg = String(e.stderr ?? e.message ?? "");
    // ETARGET on a just-published version can be npm client-cache lag — retry a few times.
    if (/ETARGET/.test(msg) && attempt < 6) {
      await sleep(15_000);
      continue;
    }
    console.error(`❌ ${PKG}@${version} is published but NOT installable:\n${msg.trim()}`);
    console.error(
      "→ A runtime dependency (likely a @hookwarden/* package) is missing or has unresolved deps.",
    );
    console.error(
      "→ Check each fixed-group package published AND has its npm Trusted Publisher binding (workflow: release.yml).",
    );
    process.exit(1);
  }
}
