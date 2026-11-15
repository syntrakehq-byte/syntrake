# N0-AUT-001 local rehearsal

This compose project is isolated to a named Docker volume and binds PostgreSQL
only to `127.0.0.1:55432`. Credentials must be supplied through an external
env file generated locally; no repository `.env` file is read.

The database initialization applies only the News Core migrations and creates
LOGIN credentials for the four segregated capabilities. The daemon runs the
real `Dockerfile.news-daemon` entrypoint in `FACTUAL` mode.

Do not use `docker compose down -v` until logs and database evidence have been
archived; it removes the persistent rehearsal volume.

## Verification and recovery

All commands below target this isolated stack only. The daemon uses the real
supervisor entrypoint and does not require a browser session.

```powershell
$d = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
& $d ps --filter name=syntrake-news-aut001
& $d logs --since 10m syntrake-news-aut001-daemon
& $d exec syntrake-news-aut001-postgres psql -U postgres -d syntrake_news_aut001 -c "select state, completed_status, count(*) from news_core.factual_pipeline_backlog group by state, completed_status order by state, completed_status;"
& $d exec syntrake-news-aut001-postgres psql -U postgres -d syntrake_news_aut001 -c "select count(*) from news_core.read_fact_revisions_as_of(clock_timestamp());"
```

For a controlled local failure, record the container PID and backlog first,
then use `docker kill --signal SIGKILL syntrake-news-aut001-daemon`. Start the
same container again with `docker start syntrake-news-aut001-daemon` (or
`docker compose up -d` with the ephemeral credentials re-supplied), and verify
lease reclamation, attempts, and idempotent logical/factual counts. A container
kill is a test action, not a production availability claim.

After a Windows/Docker Desktop restart, verify Docker Engine, then start the
PostgreSQL container followed by the daemon if they are stopped. Confirm
PostgreSQL health, the worker readiness line, backlog recovery, and PIT-visible
revisions before considering the rehearsal resumed. Do not recreate the volume
for ordinary recovery.

Docker's JSON log stream is the operational log for this rehearsal. Checkpoints,
leases, attempts, factual states, and durable revisions remain in PostgreSQL.
Archive sanitized logs and query output before destroying the isolated volume.
