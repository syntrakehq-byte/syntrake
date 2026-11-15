# N0 - proposta de ambito para decisao humana

Estado: proposta nao aprovada. Nao altera o PR #90 nem promove `N0_APPROVED`.

## Ambito canonico completo

Continua a exigir T01-T37 e N0-AUT-001. No rehearsal consolidado, T14 foi
fechado no ambito de relacoes editoriais PG17; permanecem `NOT_PROVEN` T03, T15,
T18, T20, T21, T27, T28, T33 e AUT-001.

## Possivel release Investing-only

Esta e apenas uma proposta para decisao humana; nao e uma derrogacao do N0. A
release Investing-only continua obrigada a satisfazer `N0-AUT-001` e os demais
requisitos operacionais aplicaveis. Nao pode ser aprovada enquanto a autonomia
24/7 no ambiente de destino nao estiver demonstrada.

Uma release restrita poderia expor apenas:

- leitura global de publicacoes/eventos News com `NewsEnvelope` versionado;
- estados factuais conservadores e proveniencia PIT;
- consumo por Investing atraves de adaptador read-only explicitamente versionado;
- nenhum dado privado de conta enviado a fontes externas;
- nenhuma ordem, carteira, Ledger ou decisao automatica produzida pelo News Core.

Condicoes minimas: aprovacao humana do ambito, matriz N0 reconciliada, validacao
do consumidor Investing no commit de release, ambiente PostgreSQL/Supabase
verificado, prova de `N0-AUT-001` e manutencao explicita dos criterios pendentes
como bloqueios fora do ambito. Uma proposta Investing-only nao pode converter
`AUT-001` em requisito opcional.

Exclusoes: Trading, multiutilizador privado, fontes adicionais nao verificadas e
qualquer `N0_APPROVED=YES` global. A exclusao de Trading/multiutilizador nao
exclui a obrigacao de autonomia 24/7 do News Core.

## Evolucao futura

Trading, isolamento multiutilizador e compatibilidade News/Market exigem
contratos versionados, testes de compatibilidade e revisao formal do PR #90. Nao
podem ser introduzidos por alteracao silenciosa da matriz N0.

## Infraestrutura 24/7 necessaria

Scheduler independente de sessoes, supervisor, workers FACTUAL/N1 segregados,
PostgreSQL duravel, leases/fencing, filas/backoff, backfill, metricas de
backlog/erro/ultimo sucesso, logs sanitizados, alertas, limites de recursos e
ensaio de restart no ambiente de destino. CI e PG17 isolado nao substituem essa
prova. O runbook de referencia esta em
`docs/news/VERCEL_DAEMONS_RUNBOOK.md`.
