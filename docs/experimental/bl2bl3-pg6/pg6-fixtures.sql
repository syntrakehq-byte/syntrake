\set ON_ERROR_STOP on
-- Deterministic local-only fixtures; executed as the database administrator
-- before switching to bl2proof_runtime.
INSERT INTO investing.identity_accounts(user_id)
VALUES ('pg6_actor_a'), ('pg6_actor_b')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO investing.investment_accounts(id, owner_user_id, name, base_currency)
VALUES
 ('00000000-0000-4000-8000-0000000000a1','pg6_actor_a','PG6 A','EUR'),
 ('00000000-0000-4000-8000-0000000000b1','pg6_actor_b','PG6 B','EUR')
ON CONFLICT (id) DO NOTHING;

INSERT INTO investing.portfolios(id, investment_account_id, name)
VALUES
 ('00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a1','PG6 Portfolio A'),
 ('00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b1','PG6 Portfolio B')
ON CONFLICT (id) DO NOTHING;
