# News Core N1 — relatório técnico de implementação inicial

**Estado:** circuito inicial implementado e validado localmente; **N1 não concluído**.

## Circuito entregue

`news-core/secAdapter.ts` recolhe o endpoint oficial `data.sec.gov/submissions/CIK{cik}.json`, valida a forma mínima da resposta, limita os formulários a `10-K`, `10-Q`, `8-K`, `20-F` e `6-K`, e cria uma publicação financeira com URL oficial SEC, `publishedAt` da filing, `firstSeenAt`, `ingestedAt` e `asKnownAt` do serviço. A resposta externa nunca é tratada como instrução.

`news-core/fileStore.ts` é um store durável local para o primeiro circuito. Faz commit por ficheiro temporário seguido de rename atómico; deduplica por `originFingerprint` e `providerObservationKey`; só grava o checkpoint no mesmo commit lógico dos itens. `news-core/worker.ts` é executável por processo e não importa sessão web, cookies ou request HTTP de utilizador.

O contrato é próprio do News Core (`news-core/contracts.ts`); não reutiliza `DataEnvelope`, não altera `market-data-core` e não envia watchlists ou dados de contas à SEC.

## Evidências executadas

- `npm run test:news`: **4/4 PASS**.
  - payload SEC válido e URL oficial;
  - payload malformado rejeitado;
  - fonte HTTP 503 exposta como `SEC_UNAVAILABLE`;
  - repetição idempotente;
  - interrupção antes do commit deixa estado/checkpoint anterior.
- `npx tsc --noEmit`: **PASS**.
- `npm run lint -- --quiet`: **PASS**.
- Ensaio real, sem sessão, em 2026-11-11: duas execuções contra `data.sec.gov`, User-Agent explícito, store temporário local.
  - primeira execução: `ingested=147`, `publications=147`, `observations=147`, `checkpoints=1`;
  - segunda execução: `ingested=0`, mesmo checkpoint `2026-11-09:0001354457-26-001062`;
  - ambos os processos terminaram com exit code 0.

Este ensaio comprova uma recolha real e uma repetição sem duplicação no store local, não disponibilidade 24/7, SLA da SEC, execução supervisionada ou produção.

## Limitações e pendências

- O store é local e adequado ao ensaio N1; falta a persistência PostgreSQL multi-instância, RLS/isolamento operacional, leases e supervisor de produção.
- Ainda não há API interna de leitura, paginação PIT, revisão/correção, ligação a eventos, scheduler permanente, backfill avançado ou dead-letter.
- O teste de interrupção é uma injeção determinística antes do commit; não é ainda um ensaio de kill de processo entre fetch e persistência com supervisor real.
- Não foi executada migração remota, deploy, merge ou produção.
- O ensaio real dependeu da disponibilidade da SEC no momento; não constitui prova de operação contínua.

Consequentemente, este branch é uma preparação de Draft PR N1 e não uma declaração de encerramento do N1.
