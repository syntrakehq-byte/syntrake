-- Finalization remains atomic and fenced, but the measured finalization path
-- can exceed the original one-second bound on the free preview database.
-- Keep a finite guard rather than disabling transaction_timeout; global
-- ingestion is also chunked in PostgresNewsStore so normal batches stay well
-- below this bound.
create or replace function news_core.begin_news_finalization_guard()
returns table(transaction_started_at timestamptz, availability_at timestamptz)
language plpgsql security definer
set search_path to pg_catalog, news_core
as $function$
begin
  perform set_config('transaction_timeout', '5s', true);
  return query select transaction_timestamp(), transaction_timestamp() + interval '5.25 seconds';
end
$function$;
