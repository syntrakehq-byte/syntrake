# N0-AUT-001 local rehearsal

This compose project is isolated to a named Docker volume and binds PostgreSQL
only to `127.0.0.1:55432`. Credentials must be supplied through an external
env file generated locally; no repository `.env` file is read.

The database initialization applies only the News Core migrations and creates
LOGIN credentials for the four segregated capabilities. The daemon runs the
real `Dockerfile.news-daemon` entrypoint in `FACTUAL` mode.

Do not use `docker compose down -v` until logs and database evidence have been
archived; it removes the persistent rehearsal volume.
