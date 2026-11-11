# News Core N1 — PostgreSQL e executor autónomo

## Estado

Implementação inicial preparada para auditoria. Este documento não declara o N1 concluído nem prova operação 24/7 em produção.

## Arquitetura

- `news_core.sources`, `publications`, `observations`, `checkpoints`, `collection_targets` e `executions` vivem num schema separado do Market Core.
- A identidade SEC é estável por `publication_id`/`origin_fingerprint` e por `provider_observation_key`; as constraints SQL são a última barreira contra duplicados.
- Cada `collection_scope_key` tem o seu checkpoint e target. A atualização do cursor é monotónica por `watermark_key` dentro da transação de ingestão.
- A ingestão insere publicações, observações e checkpoint numa única transação PostgreSQL. `ingested_at` e `as_known_at` são gerados pelo servidor dentro da transação; nada fica visível a leitores PIT se a transação fizer rollback.
- `readAsOf(asOf)` filtra por `as_known_at <= asOf`, sem expor informação futura.
- O executor reclama um target com `FOR UPDATE SKIP LOCKED`, lease e execução persistida. Heartbeat, expiração de lease, retry/backoff e estado de erro permitem retomar trabalho após queda de um worker.
- `scripts/news-postgres-worker.ts` não usa sessão web, cookies ou utilizador ligado. O processo é iniciado por serviço externo e continua a executar com zero sessões.

## Migração

`supabase/migrations/20261111150000_news_core_postgres_n1.sql` é uma migração versionada e isolada. Revoga acesso de `public`, cria roles sem login `news_service`/`news_reader` e concede apenas os privilégios necessários. Não foi aplicada a uma base remota.

## Evidência e limites

- A suite JSON existente mantém-se intacta e passa 8/8.
- A suite PG17 está em `news-core/tests/postgresNews.test.ts` e não usa mocks quando `NEWS_DATABASE_URL`/`TEST_DATABASE_URL` está definido; sem essa variável, fica explicitamente marcada como skipped.
- O workflow `news-core` cria PostgreSQL 17 como service container e executa a migração no próprio teste, além de `test:news`, TypeScript e lint.
- Nesta máquina não foi detetado um servidor PostgreSQL local, pelo que a execução PG17 local ainda não é prova operacional. A prova deverá ser o run do workflow no SHA deste branch.
- Continua pendente a validação de produção, observabilidade externa, configuração de credenciais reais e ensaio prolongado 24/7. O N1 não é declarado concluído.
