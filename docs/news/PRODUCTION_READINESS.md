# News Core — Production Readiness Gate

Base de auditoria: PR #101, SHA `65d4337820d735c08c023ee0dba46e4218539323`.
Fonte normativa: PR #90, SHA `a358cf9cc3e0427cefc18b02f6c3c653b2a61e7b`, estado `N0_REVIEW_READY`.

Este documento é um gate de readiness, não uma aprovação de produção. Não altera os contratos N1–N5 nem converte provas de fixtures em provas operacionais.

| Bloco | Resultado | Prova disponível | Bloqueio concreto |
|---|---|---|---|
| 1. factual writer | BLOCKED | `postgresNewsN3d.test.ts` e `securityBoundaryN4.test.ts` demonstram roles NOLOGIN e recusas a `news_service`/`news_reader` | `news_factual_writer` ainda tem INSERT factual direto e EXECUTE da selagem; uma capacidade privilegiada comprometida pode contornar validação TypeScript |
| 2. DNS rebinding/TOCTOU | NOT_PROVEN | `sourceSecurityN4.test.ts` cobre DNS inicial, endereços privados e redirects | a resolução validada não está vinculada ao socket efetivo; falta ensaio de rede controlado com rebinding |
| 3. N1→N5 automático | NOT_PROVEN | `secLiveN5.test.ts` prova duas recolhas SEC N1→PG17 idempotentes | o executor existente não encadeia automaticamente N3-A/B/C; SEC submissions fornecem metadados e não prova factual suficiente por si só |
| 4. autonomia operacional | NOT_PROVEN | checkpoints, leases, retries e recovery N1/N3-C têm fixtures PG17 | falta scheduler/supervisor 24/7, recuperação OPEN sem replay manual, backfill real e prova após restart de processo |
| 5. rehearsal N0 | BLOCKED | N1–N5 e Investing passaram nos gates do SHA base | N0 permanece divergente e `N0_REVIEW_READY`; writer, DNS, autonomia, integração N3 completa e Investing+Trading continuam sem prova completa |

## Decisão

`NEWS_CORE_PRODUCTION_READY`: **NÃO**.

`N0_APPROVED`: **NÃO**.

O próximo avanço seguro exige, nesta ordem:

1. uma interface de escrita factual cujo chamador não possua DML nem selagem direta, com validação server-side dos recibos N2/N3-A/N3-B;
2. transporte externo com destino DNS validado e ligado ao socket/TLS efetivo, ensaiado numa rede controlada;
3. um orquestrador autónomo que encadeie apenas propostas suportadas, termine explicitamente em insuficiência quando a fonte não tiver evidência, e recupere OPEN sem replay manual;
4. rehearsal N0-T01..T37 e N0-AUT-001 com SHA, logs e PostgreSQL 17 reais.

Não foram feitos merge, deployment, migrations remotas, contratação de fornecedores ou alterações a Market, Investing, Trading ou Ledger.
