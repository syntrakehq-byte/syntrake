# Stripe Live webhook hardening — implementation gate (2026-10-17)

Status: **BLOCKED for Production**. This document is a design/acceptance contract, not a completed implementation.

## Verified current behavior

- `app/api/stripe/webhook/route.ts` validates Stripe's signature but trusts `client_reference_id` or event metadata `clerkUserId` as the target for Clerk `publicMetadata` writes.
- `readPublicMetadata` swallows Clerk lookup errors and substitutes `{}`; failures must instead stop processing.
- `checkout.session.completed` immediately sets `isPaid=true`, without checking `payment_status`, subscription status, Stripe account/mode, customer binding, or current subscription truth.
- Subscription event handlers set paid state directly from event payload; an older event can overwrite newer state.
- No durable event deduplication, transactional state machine, or reconciliation is present in this repository.
- The new project has no verified production database/ledger for webhook processing. Do not fabricate one.
- Existing Stripe Live endpoint `https://signalcore.vercel.app/api/stripe/webhook` remains active; do not add a second mutating Live endpoint before idempotent reconciliation is proven.

## Required minimum architecture

1. Resolve the authenticated commercial subject server-side: immutable Clerk user ID bound to Stripe customer and subscription in a durable table. Checkout metadata is a *hint*, never authority. Validate against a verified Checkout Session created by this service and the matching customer/subscription.
2. Persist Stripe event ID (unique), account, livemode, event type, event creation time, object identity, processing state, attempts, and sanitized error. Atomic claim and state transition must be protected by database uniqueness and concurrency control.
3. Retrieve current subscription from Stripe when computing entitlements. Only active/trialing count as entitled unless an explicitly accepted billing policy says otherwise. Handle unpaid, past_due, canceled, incomplete, trial expiration and refunds explicitly. Never grant based only on `checkout.session.completed`.
4. Serialize updates per customer/subscription; reject mismatched ownership, cross-account events, missing links, duplicate events, and stale transitions. Clerk metadata is a projection of authoritative persisted entitlement, not its source of truth.
5. Persist authoritative state and an outbox record atomically. A separate idempotent projection worker updates Clerk, retries on failure, and reconciles state. Never acknowledge a mutating event as successfully processed if persistence failed.
6. Keep the old endpoint active until new endpoint is tested using isolated fixtures, nonmutating replay and verified signing secret; plan single-writer cutover. No production migrations or webhook activation without explicit approval.

## Acceptance tests

- Invalid/missing signature -> 400; missing configuration -> fail closed.
- Unbound or mismatched Clerk user, customer, subscription, account or mode -> no entitlement mutation.
- Checkout completed but unpaid/incomplete -> no grant.
- Duplicate delivery and concurrent duplicate -> exactly one durable transition and one projection intent.
- Out-of-order update/delete -> current Stripe state wins; no entitlement resurrection.
- Clerk outage -> persisted retry, no fabricated success or partial entitlement truth.
- Cross-tenant/other user ID in metadata -> no mutation.
- Production endpoint delivery and reconciliation after isolated rehearsal -> independently audited.
- Verify build/typecheck/CI, PostgreSQL transaction and RLS tests, exact candidate SHA before acceptance.

## Gate

This branch is a contract-only candidate until a durable financial state store and ownership model are identified and independently verified. Do not merge, deploy, create a Live webhook, or transfer the official domain on the basis of this document.
