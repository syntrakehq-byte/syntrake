# Commercial persistence architecture — proposed, not deployed

Date: 2026-10-17. Candidate predecessor: `b0ca55ccddeb786ee24256e69a9eec33b3b92c4b`.

## Observed constraints

- Connected Supabase account currently lists **zero projects**; no production database or schema can be verified.
- New Next.js project currently declares no PostgreSQL or Supabase client dependency.
- Stripe Live webhook on the old site is still active. No live event replay or mutation is authorized.
- The old project's data is not an authorization source for the new project unless migrated and reconciled explicitly.

## Minimum PostgreSQL design (proposal only)

- `commercial_subjects`: server-authoritative internal subject ID, Clerk instance ID and Clerk user ID; unique per instance/user; never infer ownership from caller metadata.
- `stripe_customer_links`: Stripe account ID, livemode, customer ID and subject ID; unique by (account, livemode, customer); immutable binding except audited administrative reconciliation.
- `stripe_subscription_state`: Stripe account, livemode, subscription ID, customer ID, latest Stripe status, current period/trial/cancel information, retrieved-at timestamp, canonical subscription snapshot hash and revision; one owner and one active row per subscription.
- `stripe_webhook_inbox`: unique (account, livemode, event ID), signed event metadata, payload digest, processing status, retry/error fields and received timestamp.
- `commercial_entitlements`: subject ID, source subscription ID, entitlement type, effective status, policy version, deterministic revision and provenance. Never treat Clerk metadata as financial truth.
- `commercial_projection_outbox`: unique entitlement revision, target Clerk instance/user, delivery attempts and last error; projection is retried and reconciled.

## Required invariants

1. All DB access is through a server-only scoped service; no public RLS grants for webhook tables. A service role grants capability, not permission to resolve arbitrary users.
2. Signed Stripe event is a *trigger*, not entitlement authority. Verify livemode/account; retrieve current customer/subscription from Stripe, verify binding, and compute entitlement deterministically.
3. Claim event and update canonical state/outbox in one transaction, with uniqueness and row locking. Concurrent and duplicate events produce no extra entitlement transitions.
4. Missing identity binding, ambiguous subscription ownership, stale or unavailable Stripe data, Clerk errors and persistence failures fail closed and are observable; no fabricated zero or unpaid state.
5. Outbox projection is idempotent and can be retried after crashes; Stripe-to-Clerk updates never grant access solely on client_reference_id or metadata.
6. Reconciliation compares Stripe current state, DB state and Clerk projection; mismatch blocks cutover.
7. Preserve audit/provenance, retention policy, restricted access, redacted logs, secrets in server environment, migration lineage and rollback plan.

## Next executable slice, only after storage selection

1. Choose and verify production DB project, auth isolation and migration strategy.
2. Commit versioned schema migrations plus PG17 transaction/uniqueness/concurrency/negative tests in a candidate branch.
3. Implement server-side customer binding, signed event intake, Stripe current-state reconciliation, transactional inbox/outbox and Clerk projection.
4. Run isolated fixture tests; validate Stripe sandbox endpoint and webhook signature before any Live endpoint creation.
5. Independent diff and CI audit. Require explicit approval before DB production migration, Live webhook configuration, or domain transfer.

**Gate:** no production persistence, webhook or domain changes authorized by this design document.
