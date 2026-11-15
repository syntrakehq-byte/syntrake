# N0 — proposta de âmbito para decisão humana

Estado: proposta não aprovada. Não altera o PR #90 nem promove `N0_APPROVED`.

## Âmbito canónico completo

Continua a exigir T01–T37 e N0-AUT-001. No rehearsal consolidado, T14 foi fechado no âmbito de relações editoriais PG17; permanecem `NOT_PROVEN` T03, T15, T18, T20, T21, T27, T28, T33 e AUT-001.

## Possível release Investing-only

Uma release restrita poderia expor apenas:

- leitura global de publicações/eventos News com `NewsEnvelope` versionado;
- estados factuais conservadores e proveniência PIT;
- consumo por Investing através de adaptador read-only explicitamente versionado;
- nenhum dado privado de conta enviado a fontes externas;
- nenhuma ordem, carteira, Ledger ou decisão automática produzida pelo News Core.

Condições mínimas: aprovação humana do âmbito, matriz N0 reconciliada, validação do consumidor Investing no commit de release, ambiente PostgreSQL/Supabase verificado e manutenção explícita dos critérios pendentes como bloqueios fora do âmbito.

Exclusões: Trading, multiutilizador privado, fontes adicionais não verificadas, operação 24/7 no destino, DNS rebinding não provado e qualquer `N0_APPROVED=YES` global.

## Evolução futura

Trading, isolamento multiutilizador e compatibilidade News/Market exigem contratos versionados, testes de compatibilidade e revisão formal do PR #90. Não podem ser introduzidos por alteração silenciosa da matriz N0.

## Infraestrutura 24/7 necessária

Scheduler independente de sessões, supervisor, workers FACTUAL/N1 segregados, PostgreSQL durável, leases/fencing, filas/backoff, backfill, métricas de backlog/erro/último sucesso, logs sanitizados, alertas, limites de recursos e ensaio de restart no ambiente de destino. CI e PG17 isolado não substituem essa prova.
