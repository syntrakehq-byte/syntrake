# R2-C2 — Real Clerk A/B read-only verification (Preview only)

**Status:** CANDIDATE TEST HARNESS. **Not evidence of a completed real Clerk A/B test.** Only a successful run using two genuinely independent signed Clerk sessions can constitute that evidence, and even then it is *read-only authorization evidence*, not proof of write/RPC safety.

## Scope

- Runs only against `https://zkqgpejlkgootkvkebhd.supabase.co`. All other project origins, including Production, fail closed.
- Uses two genuine **different users** A and B from the same Clerk issuer/audience. Decode of JWT locally is **not** signature verification; real validation is tested by PostgREST's rejection of a corrupted token and success with originals.
- Uses **GET only** on Investing accounts, portfolios, receipts and onboarding intents, including explicit A→B/B→A cross-resource filters. Does not call the write-capable `provision_first_portfolio` RPC.
- Requires at least one owned account and portfolio visible to **each** signed user. Missing fixtures produce `BLOCKED / INCONCLUSIVE_MISSING_OWN_ACCOUNTS_OR_PORTFOLIOS`, never PASS.
- Never prints token, JWT claims, personal identifiers, response rows, account names or financial balances. Output contains aggregate counts only. Do not paste JWTs into chat, CI logs, commits, issues, screenshots or shell command arguments.

## Prerequisites

1. Confirm the Preview branch is the intended R2-C2 environment; verify project-ref, allowed tables, RLS and a valid **publishable** key.
2. Establish two separate Clerk user accounts and authenticated sessions in isolated browser profiles or test harness contexts. Never reuse a cookie, token or user identity between A and B.
3. Both users must already have authorised **nonfinancial test** account + portfolio structures in Preview. Creating these requires a separate, explicitly permitted rehearsal; this script does **not** create them.
4. Read each session token locally from the respective authenticated Clerk SDK session (e.g., `await Clerk.session.getToken()`) and pass tokens privately as process environment variables. Do not send tokens to the assistant.
5. Node.js >=20. No npm packages or database credentials required.

## Environment

```text
SYNTRAKE_CLERK_AB_PREVIEW_URL=https://zkqgpejlkgootkvkebhd.supabase.co/
SYNTRAKE_CLERK_AB_PUBLISHABLE_KEY=<preview publishable key>
SYNTRAKE_CLERK_A_TOKEN=<Clerk signed session JWT for A>
SYNTRAKE_CLERK_B_TOKEN=<Clerk signed session JWT for B>
```

On Windows PowerShell, inject tokens into the current process without putting their values into source files or shell history. Example: `$env:SYNTRAKE_CLERK_A_TOKEN=[System.Net.NetworkCredential]::new("",(Read-Host "A token" -AsSecureString)).Password` (repeat for B). Set the Preview URL and publishable key separately. Run:

```powershell
node scripts/security/clerk-ab-readonly.mjs
```

Afterwards clear the sensitive environment variables in that terminal session. Do not record full output from HTTP requests, cookies or bearer headers.

## Acceptance

- `PASS_READ_ONLY_AB` requires two different signed Clerk JWTs, issuer/audience match, signed own reads, at least one own account and portfolio each, no cross-disclosed rows, and rejection of unsigned and corrupted tokens.
- Any missing data, inaccessible service, unexpected HTTP response, cross-access, token error or incompatible project yields `BLOCKED`; inspect the reason code and fix the **cause**, not the test.
- A passed unit-test workflow **only validates the harness with synthetic mocks**, not real A/B authentication.
- Required separately before R2-C2 promotion: authenticated *POST RPC* tests in a dedicated, authorised disposable rehearsal; Clerk session/JWKS configuration evidence; restore/retry/reconciliation evidence; privileged SQL review; migrations and exact SHA gate.

**No Production migrations, deploys, merges or financial operations are authorised by this harness.**
