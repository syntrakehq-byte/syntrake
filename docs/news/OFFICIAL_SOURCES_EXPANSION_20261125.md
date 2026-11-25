# SYNTRAKE News Core — official source expansion (candidate)

**PR #105, based on PR #103.** No production activation or migrations.

## Verified on 25 November 2026

The News Core GitHub Actions isolated PostgreSQL 17 live rehearsal
[45667626410](https://github.com/syntrakehq-byte/syntrake/actions/runs/45667626410)
fetched, normalized, persisted and read through N5 the following official RSS feeds.

| Source | Persisted publications | N5 page result |
| --- | ---: | ---: |
| Bank of Canada | 10 | 10 |
| Reserve Bank of Australia | 1 | 1 |
| U.S. Bureau of Labor Statistics | 1 | 1 |
| Federal Reserve Board | 20 | 10 |

The N5 query used a 10-row limit; it does not imply only 10 Federal Reserve
publications were persisted. These are counts from the isolated rehearsal,
not ongoing monitored production volumes.

## Opt-in daemon configuration

The existing `scripts/news-postgres-worker.ts` can now select the fixed,
versioned seven-source profile explicitly by setting:

```bash
NEWS_GLOBAL_SOURCES_PROFILE=official-expanded-v1
```

This includes the three previously rehearsed ECB, Bank of England and SEC
press RSS feeds, plus the four additions above. The SEC EDGAR filing target
is a separate existing job and is not replaced by the SEC press RSS feed.

The daemon still requires its normal existing PostgreSQL service connection,
security roles and factual-pipeline configuration. The default without
`NEWS_GLOBAL_SOURCES_PROFILE` or `NEWS_GLOBAL_SOURCES_JSON` remains **no
global RSS feeds**, preserving the existing deployment behavior.

The two configuration methods are mutually exclusive. Invalid profile
names and malformed/custom unsafe source registries fail closed.
All feeds use `METADATA_ONLY`; the daemon must not redistribute or
store full article bodies based on this profile.

## Production boundary

This PR only configures code and proves isolated CI reception. Neither
`syntrake` nor the Preview Supabase projects had a `news_core` database
schema at the last read-only inspection. Do not claim continuous news
ingestion or activate this profile in production without an authorized
database, migrations, private service credentials, supervisor and an
operational acceptance run.
