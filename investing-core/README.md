# Investing Core foundation

This bounded context is independent from Research, Trading and Billing. The intended production path is Clerk's native Supabase third-party auth integration: Supabase verifies the Clerk session JWT, and RLS reads `auth.jwt()->>'sub'`. The Supabase project and Clerk integration are not configured or verified in this repository, so production access remains blocked until that external configuration is independently audited.

Financial values are non-negative `bigint` minor units plus an uppercase ISO-4217 currency. Unknown values are rejected, never coerced to zero. Ledger transactions are append-only, double-entry and balanced per currency.

The SQL is versioned but is not executed remotely by this change. `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` are not required by the domain tests and must never be used as authorization. Server-side privileged provisioning, if later required, must be an explicit operation with its own Clerk actor check and audit record.
