# Ensaio operacional N1 — News Core

Data: 2026-11-11
Branch: `feat/news-n1-postgres-autonomous`
Estado: ensaio local limitado; não é produção nem prova de disponibilidade 24/7.

## Ambiente e limites

- PostgreSQL 17.11 local, em base isolada (`syntrake_news_live` para o ensaio real e `syntrake_news_fresh` para testes).
- Fonte real usada no ensaio SEC: `https://data.sec.gov/submissions/CIK0000320193.json`, CIK `0000320193`.
- User-Agent identificável: `SYNTRAKE-N1-validation/1.0 contact=security@syntrake.com`.
- Sem sessões web, cookies ou utilizadores ligados.
- Não foram executadas migrações remotas nem usados serviços pagos.
- URLs de base e credenciais ficaram fora dos logs e deste relatório.

## Recolha SEC real anterior

O circuito executado foi SEC EDGAR → adaptador SEC → executor autónomo → PostgreSQL → leitor PIT.

- Primeira recolha: `claimed=true`, 147 publicações novas.
- Segunda recolha do mesmo scope: `claimed=true`, 0 novas; total 147.
- Scope: `sec-edgar|sec|cik=0000320193|forms=10-K,10-Q,8-K,20-F,6-K|overlap=7|v=2`.
- Checkpoint: watermark `2026-11-09:0001354457-26-001062`, overlap 7.
- As publicações tinham fingerprints, URLs e metadados provenientes da resposta SEC.
- Após interrupção controlada pós-commit/pré-finalização: replay 0 publicações/0 observações, checkpoint inalterado, total 147.

## Ensaio de restart e encerramento cooperativo

Para não gerar chamadas SEC desnecessárias, o target existente foi temporariamente programado 10 minutos no futuro na base isolada. O worker entrou no loop autónomo sem reclamar trabalho. O primeiro processo foi terminado à força apenas para comprovar restart; o segundo recebeu um pedido cooperativo através de `NEWS_SHUTDOWN_FILE`.

Comando efetivo, com URL apenas no ambiente:

```powershell
$env:NEWS_DATABASE_URL = '<isolated-postgres-url>'
$env:SEC_USER_AGENT = 'SYNTRAKE-N1-validation/1.0 contact=security@syntrake.com'
$env:NEWS_POLL_INTERVAL_MS = '500'
$env:NEWS_LEASE_SECONDS = '3'
powershell -ExecutionPolicy Bypass -File .\scripts\news-local-supervisor.ps1 -RunSeconds 8 -CrashAfterSeconds 0.5 -LogDirectory .\tmp-news-supervisor-cooperative-2
```

O `ExecutionPolicy Bypass` foi usado apenas para executar o script local desta validação; não altera a política persistente do sistema.

Log redigido completo: `docs/news/evidence/N1_OPS_SUPERVISOR_20261111.log`.

Eventos observados, com timestamps reais locais:

```text
2026-11-11T21:24:27.0122022+01:00 START pid=23716 restart=0
2026-11-11T21:24:27.5604171+01:00 CRASH_INJECTED pid=23716
2026-11-11T21:24:27.5737967+01:00 EXIT pid=23716 code=
2026-11-11T21:24:27.5967084+01:00 START pid=6468 restart=1
2026-11-11T21:24:35.0948592+01:00 COOPERATIVE_SHUTDOWN_REQUESTED pid=6468
2026-11-11T21:24:35.2373684+01:00 WORKER_STORE_CLOSED pid=6468
2026-11-11T21:24:35.2373684+01:00 EXIT pid=6468 code=
2026-11-11T21:24:35.2464801+01:00 SUPERVISOR_STOP restarts=1 crashInjected=True
```

Duração do ensaio: 8.2342789 segundos entre o primeiro `START` e `SUPERVISOR_STOP`. O worker registou `NEWS_SHUTDOWN_REQUESTED reason=COOPERATIVE_FILE` e `NEWS_STORE_CLOSED`. Não houve timeout nem terminação forçada no encerramento cooperativo. Os PIDs dos dois workers já não existiam após a saída.

Estado PostgreSQL após o ensaio:

```json
{"target":{"lease_owner":null,"lease_until":null,"active_execution_id":null,"consecutive_failures":0},"counts":{"publications":147,"distinct_publications":147},"checkpoint":{"watermark_key":"2026-11-09:0001354457-26-001062","visibility_state":"COMMITTED"}}
```

Isto demonstra: receção do pedido cooperativo, ativação do `AbortController`, interrupção do loop, `store.close()`, ausência de lease órfão, checkpoint preservado e ausência de duplicados. O crash forçado e o shutdown cooperativo são eventos distintos.

## Observabilidade e limites

O executor persiste `execution_id`, worker, lease/heartbeat, tentativas, falhas consecutivas, último sucesso e próxima execução. O backoff usa `consecutive_failures`; `attempt_count` permanece total. A chamada SEC tem timeout/cancelamento.

O ensaio durou segundos e não prova disponibilidade 24/7, reinício do host, rotação de credenciais, alertas externos, rate limiting prolongado ou produção. Não foi fabricado erro HTTP SEC nem repetida a recolha SEC nesta etapa.

## Estado para auditoria

- Funciona e foi observado: recolha SEC real, proveniência, persistência PG17, checkpoint por CIK/scope, segunda recolha idempotente, leitura PIT, recovery, restart supervisionado e shutdown cooperativo sem sessão web.
- Testado automaticamente: fencing, heartbeat, ACK, PIT B-08/B-09, VACUUM, permissões, recovery e executor com payload controlado.
- Continua pendente para produção: supervisor permanente, operação 24/7, observabilidade externa, credenciais/segredos operacionais e ensaio prolongado.
- `news_service` continua a ser uma role interna confiável; DML administrativo direto não é uma fronteira de segurança de produção.

O N1 não é declarado como operação 24/7 de produção.
