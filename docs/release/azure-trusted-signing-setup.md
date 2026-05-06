# Azure Trusted Signing setup — one-time runbook

This runbook configures Azure Trusted Signing for `Hookwarden/hookwarden`'s Windows binary releases. The setup runs ONCE; every subsequent tag push to `Hookwarden/hookwarden` that runs `release-binaries.yml` automatically signs `hookwarden-windows-x64.exe` under the `Hookwarden-Public-Trust` certificate profile.

**Why Trusted Signing?** SmartScreen reputation accrues at the cert-profile level across releases — Microsoft's cloud-managed key replaces a per-binary OV cert and matches our release cadence (Phase 4.2 DC-14). No long-lived Azure app-registration credential is stored in GitHub: federated OIDC identity replaces it (extends Phase 4.1 DC-09).

**Approximate setup time:** ~2 hours of clicking + 1–2 days of Microsoft Identity Verification review (the latter is async — submit it first thing).

**Cost:** ~$10/month subscription fee + a per-sign fee that is negligible at our cadence.

## Prerequisites

- Owner-level access to an Azure subscription for the Hookwarden organisation
- Admin access to the `Hookwarden/hookwarden` GitHub repo (to set repo secrets)
- Verification documents for the Hookwarden organisation (incorporation certificate, D-U-N-S number, etc.) — required by Microsoft Identity Verification

## Step 1 — Azure subscription + resource group

If the Hookwarden organisation does not already have an Azure subscription:

1. Sign in or create an account at https://portal.azure.com/
2. Create or reuse a subscription (Pay-as-you-go is sufficient for v0.3.0)
3. Create a resource group named `rg-trusted-signing` in a Trusted-Signing-supported region. Verify the live region list at https://learn.microsoft.com/azure/trusted-signing/ before choosing — the EU-friendly options are West Europe (`weu`) and North Europe (`neu`)

Record the **Subscription ID** (Subscriptions blade → click the subscription → Overview).

## Step 2 — Create the Trusted Signing Account

1. Azure Portal → search "Trusted Signing Accounts" → Create
2. Resource group: `rg-trusted-signing`
3. Account name: `hookwarden-signing` (record whichever name you use)
4. Region: same as the resource group
5. Pricing tier: Basic is sufficient for v0.3.0 cadence

Record the **Trusted Signing Account name**.

The account's signing endpoint follows the pattern `https://<region>.codesigning.azure.net/` — for example, `https://weu.codesigning.azure.net/` for West Europe, `https://eus.codesigning.azure.net/` for East US. Record the full endpoint URL.

## Step 3 — Submit Microsoft Identity Verification

This step is async (1–2 day Microsoft manual review). Submit it FIRST so the rest of the setup can proceed in parallel.

1. Trusted Signing Account → Identity Verification → Add new verification
2. Choose "Public" identity verification type (the only type compatible with a Public Trust cert profile)
3. Complete the form with the Hookwarden organisation's legal name + verification documents
4. Submit and wait for Microsoft review

The verification status appears under Identity Verification once Microsoft completes the review. Do NOT proceed to Step 4 until status is `Completed`.

## Step 4 — Create the Certificate Profile

After Identity Verification is `Completed`:

1. Trusted Signing Account → Certificate Profiles → Create
2. Profile name: **`Hookwarden-Public-Trust`** (per Phase 4.2 CONTEXT — Claude's Discretion §"Trusted Signing certificate-profile naming"; the workflow expects this exact name via the `TRUSTED_SIGNING_CERT_PROFILE_NAME` secret)
3. Profile type: Public Trust
4. Bind to the verified identity from Step 3

Record the **Certificate Profile name**.

## Step 5 — Azure AD app registration with federated credential

Federated identity replaces the long-lived app-registration credential pattern. GitHub Actions issues a short-lived OIDC JWT; Azure AD verifies it against the federated-credential subject pattern. No client secret is stored anywhere.

1. Azure Portal → Microsoft Entra ID → App registrations → New registration
2. Name: `hookwarden-trusted-signing-github`
3. Supported account types: "Accounts in this organizational directory only" (single-tenant)
4. Redirect URI: leave blank
5. After creation, record the **Application (client) ID** and the **Directory (tenant) ID** from the Overview blade

Add the federated credential for tag-push releases:

6. App registration → Certificates & secrets → Federated credentials → Add credential
7. Federated credential scenario: "GitHub Actions deploying Azure resources"
8. Organization: `Hookwarden`
9. Repository: `hookwarden`
10. Entity type: Tag
11. Tag pattern: `v*` (matches all `v0.3.0+` release tags). Equivalent subject: `repo:Hookwarden/hookwarden:ref:refs/tags/v*`
12. Name: `github-tags-v-star`

Optional (recommended) — add a second federated credential for `workflow_dispatch` dry-runs from `main`:

13. Add credential → Entity type: Branch → Branch name: `main` → Name: `github-main-dispatch`. Equivalent subject: `repo:Hookwarden/hookwarden:ref:refs/heads/main`

A more permissive subject (e.g., `repo:*`) would let any GitHub repo authenticate as this app registration — keep the subject pinned to `Hookwarden/hookwarden`.

## Step 6 — Grant the signer role

1. Trusted Signing Account → Access control (IAM) → Role assignments → Add role assignment
2. Role: **`Trusted Signing Certificate Profile Signer`**
3. Assign access to: User, group, or service principal
4. Members: search for `hookwarden-trusted-signing-github` (the app registration from Step 5) and select it
5. Save

Without this role, the federated identity authenticates but cannot invoke signing.

## Step 7 — Set GitHub repo secrets

Go to https://github.com/Hookwarden/hookwarden/settings/secrets/actions and add the following six secrets:

| Secret name | Source |
|---|---|
| `AZURE_TENANT_ID` | Step 5 — Directory (tenant) ID |
| `AZURE_SUBSCRIPTION_ID` | Step 1 — Subscription ID |
| `AZURE_CLIENT_ID` | Step 5 — Application (client) ID |
| `TRUSTED_SIGNING_ENDPOINT` | Step 2 — full endpoint URL (e.g., `https://weu.codesigning.azure.net/`) |
| `TRUSTED_SIGNING_ACCOUNT_NAME` | Step 2 — account name |
| `TRUSTED_SIGNING_CERT_PROFILE_NAME` | Step 4 — `Hookwarden-Public-Trust` |

`AZURE_SUBSCRIPTION_ID`, `TRUSTED_SIGNING_ENDPOINT`, `TRUSTED_SIGNING_ACCOUNT_NAME`, and `TRUSTED_SIGNING_CERT_PROFILE_NAME` are not strictly secret (they appear in the Azure Portal); storing them as repo secrets keeps the workflow surface clean and review-friendly.

**No client-secret value is needed for the app registration.** The OIDC federated credential is the only auth path the workflow uses.

## Step 8 — Smoke test via workflow_dispatch

1. Actions → `release-binaries` → Run workflow → Branch: `main`
2. Watch the `windows-latest` matrix leg in the run UI
3. Expected sequence:
   - **Azure login**: succeeds; no `AADSTS70021` errors
   - **Authenticode-sign binary via Azure Trusted Signing**: reports "Signed N file(s)"
   - **Verify Authenticode signature**:
     - `Get-AuthenticodeSignature` reports `Status = Valid`
     - `signtool verify /pa /v` reports "Successfully verified"
     - The signed binary executes `--version` cleanly

If Azure login fails with `AADSTS70021: No matching federated identity record found`, the federated credential subject pattern from Step 5 doesn't match the actual GitHub OIDC subject. Diagnose by adding a debug step that prints `${{ github.ref }}` and `${{ github.workflow_ref }}`, then adjust the federated-credential subject pattern in Azure to match.

## Failure modes and recovery

- **Identity Verification rejected:** Microsoft emails a reason. Most common cause is insufficient documents — resubmit with the requested materials.
- **Cannot create the `Hookwarden-Public-Trust` Certificate Profile:** Identity Verification (Step 3) is not yet `Completed`. Wait for the review; do not proceed.
- **Trusted Signing rate-limit on first run:** Azure throttles brand-new accounts. Subsequent signs are unaffected; retry the workflow.
- **Azure login fails with `AADSTS700016`:** the `AZURE_CLIENT_ID` secret value is wrong. Re-copy from the App registration → Overview blade.
- **`signtool verify` reports "A certificate chain processed, but terminated in a root certificate which is not trusted":** the runner does not trust Microsoft's Trusted Signing root. As of mid-2026 this should be in the default Windows trust store — if it's not, install the Microsoft Identity Verification Root CA + Trusted Signing intermediate per https://learn.microsoft.com/azure/trusted-signing/concept-trusted-signing-trust-models.
- **Azure Trusted Signing service outage:** out of our control (Microsoft SLA). Per Phase 4.2 CONTEXT Out-of-scope §"Auto-recovery on Trusted Signing flakes" — the workflow fails loudly; rerun manually after the outage clears.

## Maintenance

- The federated credential itself does not expire. The app registration's name is cosmetic.
- The Certificate Profile is bound to the **Identity Verification, which renews annually**. Microsoft emails a renewal reminder ~60 days before expiry — respond within the window or signing will fail at the next release.
- The cost shows up as a Trusted Signing line item on the monthly Azure bill.
- The `azure/trusted-signing-action` action is pinned in `release-binaries.yml`. When upgrading, verify against https://github.com/Azure/trusted-signing-action/releases and bump the pin tightly per CLAUDE.md "verify version pin" discipline.
