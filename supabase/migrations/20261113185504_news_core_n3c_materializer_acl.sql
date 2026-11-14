-- BL1-ACL-01: the durable PIT materializer is an internal writer capability.
-- PUBLIC is revoked explicitly because PostgreSQL grants EXECUTE on new
-- functions to PUBLIC by default; the named revokes make the intended
-- boundary auditable for all application capabilities.
revoke all on function news_core.materialize_fact_revision_visibility_v1(text)
  from public, news_reader, news_service, news_factual_attestor, news_pipeline_verifier;
grant execute on function news_core.materialize_fact_revision_visibility_v1(text)
  to news_factual_writer;
