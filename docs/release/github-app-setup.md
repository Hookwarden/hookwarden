# GitHub App + PyPI Trusted Publisher — one-time setup runbook

This runbook configures the auth model that hookwarden's release pipeline relies on. The setup runs ONCE before the first Phase 4.1 release.

## A. GitHub App for cross-repo writes (Homebrew + Scoop + Action)

### Pre-flight checklist for adding `hookwarden-action` (Phase 5)

If the App was already installed for Homebrew + Scoop (Phase 4.1) and you only need to add the Action distribution repo, this is the minimal sequence:

- [ ] Create empty `Hookwarden/hookwarden-action` repo on GitHub
- [ ] Initialize it with a `main` branch (`git init && git commit --allow-empty && git push origin main`) — `bump-hookwarden-action.sh` force-pushes, which requires the branch to exist
- [ ] Visit the existing `Hookwarden Release Bot` App's installation settings → **Configure** → add `hookwarden-action` to the repository list (no permission changes — `Contents: Read & Write` already covers it)
- [ ] Verify: the next `pnpm changeset publish` will mint a token scoped to all three repos and `Build + bump hookwarden-action` step will succeed

The next sections below describe the full first-time App setup (only needed if the App doesn't exist yet — Phase 4.1 should have done this already).

### Prerequisites

- Admin access to the `Hookwarden` GitHub org
- `Hookwarden/homebrew-tap`, `Hookwarden/scoop-bucket`, and `Hookwarden/hookwarden-action` repos already exist (Plans 04.1-03 + 04.1-04 + Phase 5 — RESEARCH §Watch Out For #5: ALL distribution repos must exist BEFORE App installation; `hookwarden-action` must be initialized with a `main` branch since the bump script force-pushes to it)

### Step 1 — Create the GitHub App

1. https://github.com/organizations/Hookwarden/settings/apps/new
2. **App name:** `Hookwarden Release Bot`
3. **Homepage URL:** `https://hookwarden.dev`
4. **Webhook:** uncheck "Active" (we don't need webhooks)
5. **Repository permissions:**
   - **Contents:** Read & Write
   - All others: No access
6. **Where can this GitHub App be installed?:** Only on this account
7. Click **Create GitHub App**

### Step 2 — Generate a private key

1. On the App's settings page, scroll to **Private keys**
2. Click **Generate a private key** — downloads a `.pem` file
3. Securely store the `.pem` (you cannot download it again). Move it out of `~/Downloads` immediately and into a password manager (paste the entire PEM, including `-----BEGIN ...` and `-----END ...` lines).

### Step 3 — Install the App on the org

1. In the App's left nav, click **Install App**
2. Click **Install** next to `Hookwarden`
3. **Repository access:** select **Only select repositories**
4. Choose `homebrew-tap` AND `scoop-bucket` AND `hookwarden-action` (exact list — RESEARCH §Pitfall 10; `hookwarden-action` added in Phase 5). Do NOT select `hookwarden` or "All repositories" — least privilege. The App permissions remain `Contents: Read & Write ONLY` (no additional scopes for the Action repo — same scope set covers all three).
5. Click **Install**

### Step 4 — Configure repo variables and secrets on `Hookwarden/hookwarden`

1. https://github.com/Hookwarden/hookwarden/settings/variables/actions → **New repository variable**:
   - **Name:** `HOOKWARDEN_BOT_APP_ID`
   - **Value:** the App ID (visible at the top of the App settings page; numeric)
2. https://github.com/Hookwarden/hookwarden/settings/secrets/actions → **New repository secret**:
   - **Name:** `HOOKWARDEN_BOT_APP_PRIVATE_KEY`
   - **Value:** the entire contents of the `.pem` file from Step 2 (including `-----BEGIN ...` and `-----END ...` lines)

### Maintenance

- App installation tokens are short-lived (≤1 hour); no rotation needed at the token level
- The App's PRIVATE KEY should be rotated annually: regenerate via Step 2, update the secret, delete the old key from the App settings
- When the App's installation list changes (e.g., adding a new distribution repo such as `hookwarden-action` in Phase 5), update Step 3's repository list AND the `repositories: |` block in `.github/workflows/release.yml` in the same commit — drift between the App scope and the workflow's mint-token step causes silent token-mint failures

## B. PyPI Trusted Publisher

### Prerequisites

- Admin access on the `hookwarden` PyPI project (Phase 1 placeholder — verified by Phase 1 plan 01-07). If the project doesn't exist on PyPI yet, add a **Pending Publisher** instead at https://pypi.org/manage/account/publishing/ — the binding will activate on the first upload, which will create the project.

### Step 1 — Add a Trusted Publisher

1. https://pypi.org/manage/project/hookwarden/settings/publishing/ (sign in as a project owner) — OR https://pypi.org/manage/account/publishing/ for a Pending Publisher if the project doesn't yet exist
2. Under **Add a new publisher**, choose **GitHub** tab
3. PyPI requires 2FA on your account before adding a Trusted Publisher; enable 2FA first if prompted.
4. Fill exactly:
   - **PyPI Project Name:** `hookwarden`
   - **Owner:** `Hookwarden`
   - **Repository name:** `hookwarden`
   - **Workflow name:** `release-py.yml` (RESEARCH §Pitfall 3 — must match the actual filename, not a path)
   - **Environment name:** `pypi`
5. Click **Add**

### Step 2 — Verify the GitHub environment matches

1. https://github.com/Hookwarden/hookwarden/settings/environments
2. Confirm an environment named `pypi` exists (referenced by `release-py.yml`'s `environment: pypi`)
3. If missing, create it. **No protection rules needed** for v1; add deployment branch restrictions in v1.1 if required.

### Failure modes

- **"Token not found" on first publish:** the PyPI project doesn't have the Trusted Publisher binding configured. Verify Step 1.
- **"job_workflow_ref claim mismatch":** the workflow filename in PyPI's binding doesn't match the actual `release-py.yml` filename, OR `release-py.yml` was refactored into a reusable workflow (forbidden — RESEARCH §Pitfall 3).
- **"Environment not found":** the GitHub environment `pypi` doesn't exist. See Step 2.

## References

- DC-09 (CONTEXT.md) — auth model lock
- RESEARCH §Pitfalls 2 (PyPI first-publish), 3 (Trusted Publishing in reusable workflows), 10 (App token repository scoping)
- https://docs.pypi.org/trusted-publishers/adding-a-publisher/
- https://github.com/actions/create-github-app-token
