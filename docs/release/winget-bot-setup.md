# WinGet bot setup — one-time runbook

This runbook configures the dedicated GitHub bot account that publishes hookwarden's WinGet manifests to `microsoft/winget-pkgs`. The setup runs ONCE before the first WinGet release.

**Why a separate bot account?** `wingetcreate` (and the `vedantmgoyal9/winget-releaser` Action that wraps it) only supports CLASSIC GitHub PATs — not fine-grained PATs and not GitHub App tokens. Per DC-09 ("least-privilege; no long-lived org-wide tokens"), the WinGet credential is isolated to its own account so a leak's blast radius is limited to that bot's fork of `microsoft/winget-pkgs` (and nothing in the Hookwarden org).

## Prerequisites

- Admin access to the `Hookwarden/hookwarden` GitHub repo (to set the repo secret)
- A separate email address for the bot account (e.g., a `+winget` Gmail alias on the project email)
- ~15 minutes

## Step 1 — Create the bot GitHub account

1. Sign out of your personal GitHub account (or use a private browser window)
2. Sign up at https://github.com/signup with username `hookwarden-bot`
3. Verify the bot's email
4. Sign in as the bot
5. Enable 2FA immediately (Settings → Password and authentication) and **save the recovery codes to your password manager** — losing access to the bot's MFA device with no recovery codes means rebuilding the bot from scratch.

> **Naming note:** `hookwarden-bot` is the default per planner discretion under DC-12. If the username is taken, alternates: `hookwarden-releases`, `hookwarden-publisher`. Whichever you pick, update `fork-user:` in `.github/workflows/winget-release.yml` to match exactly.

## Step 2 — Fork `microsoft/winget-pkgs` into the bot's account

1. Signed in as the bot, navigate to https://github.com/microsoft/winget-pkgs
2. Click "Fork" (top right)
3. Confirm the fork target is `hookwarden-bot/winget-pkgs`
4. Wait for the fork to complete (~30 seconds for a repo this size)

> **Why fork?** `wingetcreate update` stages PRs through the bot's fork — it cannot push directly to `microsoft/winget-pkgs` (no human gets push access there). The fork is the staging area; the upstream PR is what microsoft moderators review.

## Step 3 — Generate a classic PAT with `public_repo` scope

1. Signed in as the bot, go to **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**
2. **Note:** `hookwarden release pipeline — wingetcreate fork pushes`
3. **Expiration:** 90 days (rotation on quarterly cadence; consult bot owner for longer if needed)
4. **Scopes:** check `public_repo` ONLY. **Do NOT check `repo`, `workflow`, `admin:org`, or any other scope.**

   > **Why classic, not fine-grained?** RESEARCH §Watch Out For #12 + §Pitfall 6: `wingetcreate` and the `vedantmgoyal9/winget-releaser` Action do not currently support fine-grained PATs or GitHub App tokens.

5. Click **Generate token**
6. **Copy the token immediately** — GitHub shows it once
7. Store the token in your password manager under "hookwarden / winget bot PAT" with the expiration date noted

## Step 4 — Store the token as a secret on `Hookwarden/hookwarden`

1. Sign back into your admin account on the Hookwarden org
2. Navigate to https://github.com/Hookwarden/hookwarden/settings/secrets/actions
3. Click **New repository secret**
4. **Name:** `HOOKWARDEN_BOT_WINGET_PAT` (exact case — must match `winget-release.yml`)
5. **Value:** paste the token from Step 3
6. Click **Add secret**

## Step 5 — Initial manifest submission (FIRST RELEASE ONLY)

The `winget-release.yml` workflow uses `wingetcreate update`, which reads the previous version's manifest and bumps it. There IS no previous version on the first release, so the FIRST submission must be done manually with `wingetcreate new`.

> **You can skip this step until you ship the first GitHub Release with a Windows x64 binary.** All subsequent releases are handled by the workflow.

On a Windows machine (the bot owner's machine, or a Windows VM):

1. `winget install Microsoft.WingetCreate` — installs `wingetcreate`
2. `wingetcreate new https://github.com/Hookwarden/hookwarden/releases/download/v<VERSION>/hookwarden-windows-x64.exe` — interactive prompt; supply:
   - **PackageIdentifier:** `Hookwarden.Hookwarden`
   - **InstallerType:** `portable` (single self-contained .exe per A-04.1-05-001)
   - **Commands:** `hookwarden` (the exec name on `winget install` — required for portable installers per RESEARCH §Pitfall 7)
   - **PackageName:** `hookwarden`
   - **Publisher:** `Hookwarden`
   - **License:** `Apache-2.0`
   - **ShortDescription:** `Webhook signature-verification audit tool`
   - **Homepage:** `https://github.com/Hookwarden/hookwarden` (use the GitHub repo URL until `hookwarden.dev` is deployed — winget validates URL reachability and rejects 5xx)
3. Authenticate with the bot's PAT when prompted
4. `wingetcreate` opens a PR to `microsoft/winget-pkgs` from `hookwarden-bot/winget-pkgs` — review the PR URL it prints
5. Wait 1-3 days for microsoft moderators to review and merge

Once the first version is merged upstream, `wingetcreate update` (and therefore this workflow) can take over from version 2 onward.

## Step 6 — Verify the workflow runs end-to-end

After Step 5's first submission has merged AND a NEW release is published:

1. Push a release tag: `gh release create v<NEW> --notes-from-tag` (or via your normal release flow)
2. The `Publish to WinGet` workflow fires automatically (`release: published` trigger)
3. Watch progress: `gh run list --workflow=winget-release.yml --limit 5`
4. The workflow opens a new PR to `microsoft/winget-pkgs`. Find it: `gh pr list --repo microsoft/winget-pkgs --author hookwarden-bot`
5. Wait for moderation. If the PR is rejected, see Pitfall 6 recovery below.

## Failure modes and recovery

### PAT expired or revoked

Symptom: workflow fails at the `Submit to WinGet` step with `401 Unauthorized` or similar.
Recovery: regenerate the PAT (Step 3) and update the `HOOKWARDEN_BOT_WINGET_PAT` secret (Step 4). Re-run the workflow via `gh workflow run winget-release.yml -f tag=v<VERSION>`.

### microsoft/winget-pkgs PR rejected

Symptom: PR closed with reviewer comments; daily SHA-drift probe (Plan 08) fires after 72h.
Recovery (v1, manual): read the rejection comments, fix the issue (often a schema field), and re-run `wingetcreate update` locally OR re-trigger `winget-release.yml` via `workflow_dispatch` after fixing the underlying issue. Auto-recovery is deferred to v1.1 per CONTEXT §Out of scope.

### Bot account locked or disabled

Symptom: PAT auth still works but PRs from the bot are refused by microsoft moderators.
Recovery: contact GitHub support; in extreme cases, repeat Steps 1-5 with a new bot account name and update `fork-user:` in `winget-release.yml`.

## Maintenance

- Rotate the PAT every 90 days; update the secret
- Annual review: confirm `vedantmgoyal9/winget-releaser` is still maintained and the version pin in `winget-release.yml` is current (re-run `gh release list --repo vedantmgoyal9/winget-releaser --limit 5` and compare against the pin captured in the `winget-releaser version verified:` line of the most recent commit touching `winget-release.yml`)
- Watch the daily drift probe (Plan 08) — chronic drift indicates a workflow regression

## References

- DC-12 (CONTEXT.md) — implementation lock
- DC-09 (CONTEXT.md) — auth model rationale
- RESEARCH §Pattern 4 — pattern reference
- RESEARCH §Pitfalls 6, 7 — known failure modes
- https://github.com/microsoft/winget-create — wingetcreate reference docs
- https://github.com/marketplace/actions/winget-releaser — Action reference docs
