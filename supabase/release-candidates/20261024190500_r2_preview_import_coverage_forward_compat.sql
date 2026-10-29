-- CANDIDATE, NOT EXECUTED. Forward-only Preview compatibility delta.
-- Historical Preview ref: zkqgpejlkgootkvkebhd. Do not apply to Production.
-- Legacy snapshot rows have NO coverage assertions. Preserve that truth as
-- NULL => LEGACY_COVERAGE_UNKNOWN in readers, never zero or user-complete.
-- Requires manual registry/hash/schema reconciliation and explicit permission.
-- NOT a substitute for R2_PHASE or R0_TO_R2_CUMULATIVE rehearsal.
begin;

do $gate$
begin
  if to_regclass('investing.portfolio_import_snapshots') is null then
    raise exception 'R2 Preview import table missing: BLOCKED' using errcode='55000';
  end if;
  if exists (
    select 1 from pg_attribute
    where attrelid='investing.portfolio_import_snapshots'::regclass
      and attname in ('reported_cash_coverage','reported_position_coverage')
      and not attisdropped
  ) then
    raise exception 'R2 Preview coverage columns already exist: reconcile migration lineage first'
      using errcode='55000';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid='investing.portfolio_import_snapshots'::regclass
      and attname='expected_cash_rows' and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid='investing.portfolio_import_snapshots'::regclass
      and attname='expected_position_rows' and not attisdropped
  ) then
    raise exception 'R2 Preview header contract drift: BLOCKED' using errcode='55000';
  end if;
end;
$gate$ language plpgsql;

-- DO NOT set a DEFAULT or backfill old data: historical completeness is unknown.
alter table investing.portfolio_import_snapshots
  add column reported_cash_coverage text,
  add column reported_position_coverage text;

-- NOT VALID preserves old immutable NULL/NULL rows while **enforcing**
-- new rows and any UPDATE. Missing values on future INSERTs are prohibited.
-- Unlike CHECK(coverage IN(...)) alone, IS NOT NULL prevents SQL NULL loopholes.
alter table investing.portfolio_import_snapshots
  add constraint portfolio_import_new_coverage_required
  check (
    reported_cash_coverage is not null
    and reported_position_coverage is not null
    and reported_cash_coverage in ('NOT_REPORTED','PARTIAL','ASSERTED_COMPLETE')
    and reported_position_coverage in ('NOT_REPORTED','PARTIAL','ASSERTED_COMPLETE')
    and (
      reported_cash_coverage = 'ASSERTED_COMPLETE'
      or (reported_cash_coverage = 'NOT_REPORTED' and expected_cash_rows = 0)
      or (reported_cash_coverage = 'PARTIAL' and expected_cash_rows > 0)
    )
    and (
      reported_position_coverage = 'ASSERTED_COMPLETE'
      or (reported_position_coverage = 'NOT_REPORTED' and expected_position_rows = 0)
      or (reported_position_coverage = 'PARTIAL' and expected_position_rows > 0)
    )
  ) not valid;

-- No DROP FUNCTION, no role change, no data rewrite, no owner assumption.
-- Explicit manual review required for pre-existing SECURITY DEFINER RPC.
commit;
