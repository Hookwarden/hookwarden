// v0.7.4+ — `update-notifier` wrapper so users on stale `npm i -g hookwarden`
// installs see when a newer version is available. Background fetch (≤24h
// cached), TTY-gated, opt-out via --no-update-notifier (handled natively by
// update-notifier from process.argv).
//
// IMPORTANT brand boundary: the update-availability check IS a network call.
// That is INTENTIONALLY separate from the "zero network during scan" promise
// — we do not phone home with scan data, but we do need to tell users their
// rule pack is months old. The check runs against npm's public CDN, never
// touches your code, and is fully opt-out.

import notifier from "update-notifier";
import { accent, dim } from "./render/colors.js";

// update-notifier's default export is the class AND callable factory; @types
// expose UpdateNotifier as a class type. ReturnType<typeof notifier> resolves
// to an UpdateNotifier instance for free, avoiding the namespace-vs-value
// gymnastics that the v6 types make awkward.
type UpdateNotifierInstance = ReturnType<typeof notifier>;

export interface RunUpdateCheckOptions {
  /** The CLI's own package.json (used by update-notifier to query npm). */
  readonly pkg: { readonly name: string; readonly version: string };
  /** Override for tests — defaults to update-notifier from node_modules. */
  readonly notifierFactory?: typeof notifier;
  /** Bypass the check entirely. */
  readonly disabled?: boolean;
  /** Check interval in ms. Default: 24h. */
  readonly updateCheckInterval?: number;
}

/**
 * Kick off the background update check. Non-blocking — returns the
 * UpdateNotifier instance immediately; the fetch happens out-of-band.
 *
 * Caller invokes {@link maybeRenderUpdateBanner} at exit time to display
 * the banner if (a) a newer version landed and (b) the TTY/format gates
 * pass. If disabled, returns null and the banner is skipped.
 */
export function runUpdateCheck(opts: RunUpdateCheckOptions): UpdateNotifierInstance | null {
  if (opts.disabled === true) return null;
  const factory = opts.notifierFactory ?? notifier;
  return factory({
    pkg: { name: opts.pkg.name, version: opts.pkg.version },
    updateCheckInterval: opts.updateCheckInterval ?? 1000 * 60 * 60 * 24,
    // Hard-disable update-notifier's own banner; we render our own so
    // tone + colors match the rest of the hookwarden output.
    shouldNotifyInNpmScript: false,
  });
}

export interface MaybeRenderBannerOptions {
  readonly useAnsi: boolean;
  /** Output format from the scan; we skip the banner for machine formats. */
  readonly format?: string;
  /** Stream override (defaults to process.stderr). */
  readonly stream?: { write: (s: string) => boolean | void; isTTY?: boolean };
}

/**
 * Render the update banner if {@link runUpdateCheck}'s notifier surfaced
 * a newer version. Honors:
 *   - notifier is null (check disabled) → no banner
 *   - notifier.update is undefined (check still pending, no result) → no banner
 *   - current === latest (no upgrade available) → no banner
 *   - --format json|sarif (machine-consumed) → no banner
 *   - non-TTY stderr (piped / captured) → no banner
 *
 * Returns true if a banner was printed (caller can use for testing).
 */
export function maybeRenderUpdateBanner(
  instance: UpdateNotifierInstance | null,
  opts: MaybeRenderBannerOptions,
): boolean {
  if (instance === null) return false;
  // update-notifier resolves `update` asynchronously; if the fetch hasn't
  // returned yet (fast scan, slow network), we just skip and try next run.
  // The result is cached for `updateCheckInterval`, so next invocation
  // generally picks up the result.
  const update = instance.update;
  if (update === undefined || update === null) return false;
  if (update.current === update.latest) return false;
  if (opts.format === "json" || opts.format === "sarif") return false;
  const stream = opts.stream ?? process.stderr;
  if (stream.isTTY !== true) return false;

  // Match the rest of the verbose output's audit-grade tone:
  //   - dim hairline rule above
  //   - one factual line, no emoji, no "🎉 NEW VERSION"
  //   - bump-type tag (patch/minor/major) so users gauge urgency
  //   - exact install command (npm, not "your package manager")
  const tag = update.type !== undefined ? ` (${update.type})` : "";
  const headline = `Update available: ${update.current} → ${accent(update.latest, opts, true)}${dim(tag, opts)}`;
  const install = dim("Run: npm i -g hookwarden@latest", opts);
  const rule = dim("─────────────────────────────────", opts);
  stream.write(`\n${rule}\n${headline}\n${install}\n`);
  return true;
}
