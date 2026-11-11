# Ensaio operacional N1 — News Core

Data: 2026-11-11
Branch: `feat/news-n1-postgres-autonomous`
Estado: ensaio local limitado para auditoria; não é produção, nem prova de disponibilidade 24/7.

## Ambiente e limites

- PostgreSQL 17.11 local, em base isolada (`syntrake_news_live` para o ensaio real e `syntrake_news_fresh` para testes).
- Fonte real: SEC EDGAR `https://data.sec.gov/submissions/CIK0000320193.json`, CIK `0000320193`.
- User-Agent identificável: `SYNTRAKE-N1-validation/1.0 contact=security@syntrake.com`.
- Sem sessões web, cookies ou utilizadores ligados; o processo é iniciado diretamente por Node/tsx.
- Não foram executadas migrações remotas, nem usados serviços pagos.
- O URL da base e quaisquer credenciais foram mantidos fora dos logs e deste relatório.

## Recolha SEC real

O circuito executado foi SEC EDGAR → adaptador SEC → executor autónomo → PostgreSQL → leitor PIT.

Resultados observados na base isolada:

- Primeira recolha: `claimed=true`, 147 publicações novas.
- Segunda recolha do mesmo scope: `claimed=true`, 0 novas; total permaneceu 147.
- Scope: `sec-edgar|sec|cik=0000320193|forms=10-K,10-Q,8-K,20-F,6-K|overlap=7|v=2`.
- Checkpoint confirmado: watermark `2026-11-09:0001354457-26-001062`, overlap 7.
- As publicações continham fingerprints, URLs e metadados provenientes da resposta SEC; não foram usados dados fictícios.
- A consulta PIT do leitor devolveu 147 publicações confirmadas. A leitura direta das tabelas brutas por `news_reader` foi recusada.

Foi executada uma interrupção controlada após o commit da ingestão e antes da finalização. Após recovery, o checkpoint manteve-se no mesmo watermark, o replay produziu 0 publicações e 0 observações novas, e a contagem permaneceu 147.

## Supervisor local

Comando usado (com uma URL de PostgreSQL isolada fornecida apenas no ambiente):

```powershell
$env:NEWS_DATABASE_URL = '<isolated-postgres-url>'
$env:SEC_USER_AGENT = 'SYNTRAKE-N1-validation/1.0 contact=security@syntrake.com'
$env:NEWS_POLL_INTERVAL_MS = '500'
$env:NEWS_LEASE_SECONDS = '3'
pwsh -File .\scripts\news-local-supervisor.ps1 -RunSeconds 12 -CrashAfterSeconds 0.5 -LogDirectory .\tmp-news-supervisor-logs
```

Eventos redigidos observados:

```text
START pid=<p1> restart=0
CRASH_INJECTED pid=<p1>
EXIT pid=<p1>
START pid=<p2> restart=1
SIGTERM pid=<p2>
EXIT pid=<p2>
SUPERVISOR_STOP restarts=1 crashInjected=True
```

Após o ensaio: nenhum lease ativo, `consecutive_failures=0`, checkpoint `COMMITTED`, 147 publicações e 147 identidades distintas. O primeiro kill ocorreu cedo demais para observar de forma isolada uma execução abandonada depois de reclamar o target; portanto este ensaio comprova restart, SIGTERM, ausência de duplicados e estado final consistente, mas não é apresentado como prova independente de recuperação de lease. A recuperação de lease continua coberta pelos testes PG17 e pela falha controlada do circuito real.

O script regista início, crash injetado, SIGTERM, saída e número de restarts; os logs do worker são separados de stdout/stderr e não contêm credenciais. Não foi mantido um supervisor ativo após o ensaio.

## Observabilidade e recuperação

O executor persiste `execution_id`, worker, lease/heartbeat, tentativas, falhas consecutivas, último sucesso e próxima execução. O backoff usa `consecutive_failures`; `attempt_count` permanece total. A chamada SEC tem timeout/cancelamento e o processo responde a SIGTERM.

O ensaio real foi limitado a segundos e não mede disponibilidade permanente, reinício do host, rotação de credenciais, alertas externos, rate limiting prolongado ou recuperação de uma indisponibilidade SEC real. Não foi fabricado um erro HTTP SEC nem se afirma um retry operacional ao vivo que não tenha sido observado.

## Estado para auditoria

- Funciona e foi observado: recolha SEC real, validação, proveniência, persistência PG17, checkpoint por scope/CIK, segunda recolha idempotente, leitura PIT, recuperação controlada pós-commit, start/restart/SIGTERM sem sessão web.
- Testado automaticamente: fencing, heartbeat, ACK, PIT B-08/B-09, VACUUM, permissões, recuperação e executor com payload controlado.
- Ainda pendente: ensaio prolongado com supervisor efetivamente ativo, operação 24/7, observabilidade externa e validação de produção. O N1 não é declarado concluído.
