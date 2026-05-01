# hookwarden Defensive Registration Runbook

This runbook implements CONTEXT.md decisions D-13, D-14, and D-15. It is the canonical
order for claiming the **13 identities** required before any public mention of `hookwarden`.

## Inventory (13 identities — all verified free on 2026-05-01)

| Surface | Identity | Notes |
|---|---|---|
| npm | `hookwarden` | Canonical CLI (unscoped, so `npx hookwarden@latest scan` works) |
| npm | `hook-warden` | Hyphen typo |
| npm | `hookwardn` | Missing-letter typo |
| npm | `hookwardne` | Letter-transposition typo |
| npm | `hookwardens` | Plural typo |
| npm | `hookwarden-cli` | Suffix-variant typo |
| npm | `@hookwarden` (scope) | Claimed automatically by the first `@hookwarden/*` publish (Pitfall #4) |
| PyPI | `hookwarden` | Canonical |
| PyPI | `hook-warden` | PEP 503 normalisation collapses `hook-warden` / `hook_warden` / `hook.warden` |
| PyPI | `hookwardn` | Missing-letter typo |
| PyPI | `hookwardne` | Letter-transposition typo |
| PyPI | `hookwardens` | Plural typo |
| PyPI | `hookwarden-cli` | Suffix-variant typo |
| GitHub | org `hookwarden` (`Hookwarden`) | Created PRIVATE in Plan 01 Task 3 |
| Domain | `hookwarden.dev` | Project-owned; landing page deployed in Plan 08 |

## Hard ordering constraint (D-15)

> Every defensive registration in the table above MUST complete **before** any public mention
> of `hookwarden` — the canonical name, any typo, the GitHub org URL, or `hookwarden.dev`.
> Adversaries scan new package names within minutes (Bitwarden CLI April 2026 attack).
> Phase 1 verification fails if any identity is unclaimed.

## Defensive Registration Sequencing

### Phase 0 — Pre-publish identity claims

> All four sub-steps run BEFORE the first publish. They cannot be parallelised by automation —
> each is a web-UI registration that the project owner performs by hand.

#### Step 1: PyPI pending Trusted Publishers (6 names)

For **each** dist name (`hookwarden`, `hook-warden`, `hookwardn`, `hookwardne`,
`hookwardens`, `hookwarden-cli`):

1. Sign in to https://pypi.org as the project owner.
2. Account → Publishing → Add a new pending publisher.
3. Configure:
   - **PyPI Project Name:** `<dist>` (use the exact dist name with hyphens)
   - **GitHub repository owner:** `Hookwarden`
   - **Repository name:** `hookwarden`
   - **Workflow filename:** `release-py.yml`
   - **Environment name:** `pypi`

**Verification gate:** the PyPI publishing dashboard shows 6 "Pending publishers" entries.
The PyPI JSON API returns `404` for all 6 dist names (because no actual package has been
uploaded yet — pending publishers are dormant until first publish):

```bash
for n in hookwarden hook-warden hookwardn hookwardne hookwardens hookwarden-cli; do
  curl -fsS -o /dev/null -w "%{http_code} $n\n" "https://pypi.org/pypi/$n/json"
done
# Expected: six 404 lines
```

**Race-window mitigation (Pitfall #5):** configure all 6 in a single session. The first
publish in Phase 1 closes the window in seconds.

#### Step 2: GitHub repo + `pypi` Environment

The `Hookwarden/hookwarden` repo was created PRIVATE in Plan 01 Task 3. Verify still PRIVATE:

```bash
gh repo view Hookwarden/hookwarden --json visibility -q .visibility
```

Must return `"PRIVATE"`. **Do NOT flip to public yet** — Plan 08 owns the flip.

Also create the `pypi` GitHub Environment (referenced by `release-py.yml`):

1. Visit https://github.com/Hookwarden/hookwarden/settings/environments
2. Click "New environment", name **`pypi`** (lowercase). Save.
3. Optional: add a deployment protection rule (required reviewer) and/or branch
   protection (`refs/tags/v*` only).

**Verification gate:**

```bash
gh api repos/Hookwarden/hookwarden/environments --jq '.environments[].name' | grep -x pypi
```

#### Step 3: Domain registration — `hookwarden.dev`

1. Buy `hookwarden.dev` from any registrar (Cloudflare, Namecheap, Google Domains all
   support `.dev`). `.dev` is a Google-operated TLD requiring HSTS preload — ensure
   the registrar supports DNSSEC and you have a TLS-capable host before serving content.
2. Configure DNS to a "coming soon" placeholder (any A record pointing at a parked
   page or a single-page Cloudflare Worker / Fly.io static app). No real content yet —
   Plan 08 deploys the actual landing page.

**Verification gate:** `dig hookwarden.dev +short` returns at least one A record.

#### Step 4: npm Trusted Publisher + 2FA

1. **Enable 2FA** on the npm account at https://www.npmjs.com/settings/<account>/security
   — mandatory before first publish per CONTEXT.md "Specifics".
2. Add Trusted Publisher at https://www.npmjs.com/settings/<account>/trusted-publishers:
   - **Repository owner:** `Hookwarden`
   - **Repository name:** `hookwarden`
   - **Workflow filename:** `release.yml`
   - **Optional environment:** leave blank (or `npm` for additional protection)

**Verification gate:** the npm dashboard shows the trusted publisher entry. There is no
public API to inspect this from the outside — verification is visual.

### Phase 1 — Atomic first publish

All 4 Phase 0 steps must be complete before this phase runs.

#### Step 5: Trigger the first release (v0.0.1)

1. From `/tmp/hookwarden`, create the initial changeset that triggers v0.0.1:

   ```
   .changeset/v0-0-1-initial.md:
   ---
   "hookwarden": patch
   ---

   Initial v0.0.1 release — defensive registration of all 9 OSS npm packages and 6 PyPI packages.
   ```

   Because Plan 05's `fixed:` group lists all 9 OSS packages, this single `patch` bump on
   `hookwarden` causes Changesets to bump all 9 in lockstep.

2. Commit and push to main (still PRIVATE repo):

   ```bash
   git add .changeset/v0-0-1-initial.md
   git commit -m "release: v0.0.1 initial defensive publish"
   git push origin main
   ```

3. `release.yml` fires on push. `changesets/action@v1` opens a "Version Packages" PR.
   - Merge that PR. On merge, `changesets/action` runs `pnpm changeset publish` which:
     - Bumps all 9 fixed-group packages to `0.0.1`
     - Tags `v0.0.1` and pushes the tag
     - Publishes 9 packages to npm via OIDC Trusted Publishing (provenance auto-emitted)

4. Tag push (`v0.0.1`) triggers `release-py.yml` — the 6-package matrix:
   - Each job rewrites `version = "0.0.0"` → `version = "0.0.1"` in `pyproject.toml`
   - Builds sdist + wheel
   - Publishes to PyPI via `pypa/gh-action-pypi-publish@release/v1` (Trusted Publisher OIDC)

5. Run the verifier:

   ```bash
   bash scripts/verify-defensive-registration.sh
   ```

   MUST exit `0`. Any non-zero exit identifies an unclaimed identity that must be
   resolved before Plan 08 can flip the repo public.

### Phase 2 — Verification + public flip (executed in Plan 08)

- Re-run verifier (`scripts/verify-defensive-registration.sh`) immediately before the flip
- Update README + LICENSE + NOTICE references to point at `hookwarden.dev`
- Flip GitHub repo PRIVATE → PUBLIC (`gh repo edit Hookwarden/hookwarden --visibility public`)

## Recovery procedures

| Symptom | Most likely cause | Recovery |
|---|---|---|
| `release.yml` fails at npm publish step with "401 unauthorized" | npm Trusted Publisher misconfigured (wrong repo, wrong workflow filename, or environment mismatch) | Re-check npm dashboard, ensure repo = `Hookwarden/hookwarden`, workflow = `release.yml`. Re-run workflow. |
| `release-py.yml` matrix job fails for one PyPI name with "user does not have permission" | PyPI pending publisher not configured for that dist name, OR adversary published the name during the configuration window (Pitfall #5) | If config gap: add the pending publisher; re-run job. If adversary squat: that name is permanently lost — escalate to PyPI support, in parallel substitute a different typo and update D-12. |
| Verifier reports `[FAIL] @hookwarden/engine not yet published` | First publish did not include any `@hookwarden/*` package | Confirm Plan 05 fixed group includes `@hookwarden/engine`; re-run the publish if needed. |
| Verifier reports `[FAIL] domain hookwarden.dev does not resolve` | DNS not yet configured or propagation delay | `dig +trace hookwarden.dev`; wait up to 1 hour for propagation; re-check registrar DNS panel. |
| Verifier reports `[FAIL] GH org Hookwarden does not exist or is inaccessible` | `gh` CLI not authenticated, OR org name capitalisation mismatch | `gh auth status`; the script accepts `HOOKWARDEN_GH_ORG=Hookwarden` to override the lower-case default. |

## See also

- `.planning/phases/01-foundation-defensive-registration/01-CONTEXT.md` (D-13, D-14, D-15)
- `.planning/phases/01-foundation-defensive-registration/01-RESEARCH.md` §"Defensive Registration Sequencing"
- `.planning/research/PITFALLS.md` §13 (typosquat day-zero)
- `.github/workflows/release.yml` (npm OIDC publish)
- `.github/workflows/release-py.yml` (PyPI matrix publish)
