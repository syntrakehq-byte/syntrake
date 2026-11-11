# News Core N1 — relatório técnico de implementação inicial

**Estado:** circuito inicial implementado e validado localmente; **N1 não concluído**.

## Circuito entregue

`news-core/secAdapter.ts` recolhe o endpoint oficial `data.sec.gov/submissions/CIK{cik}.json`, valida CIK, arrays alinhados, datas de calendário, accession e caminhos de documento, limita os formulários a `10-K`, `10-Q`, `8-K`, `20-F` e `6-K`, e rejeita traversal. Como a SEC fornece `filingDate` sem hora de publicação, `publishedAt` permanece `null`; não é criada uma hora artificial. A resposta externa nunca é tratada como instrução.

`news-core/fileStore.ts` é um store durável local para o primeiro circuito. Faz staging privado em `store.json.staging`, com `fsync` do ficheiro, rename atómico e `fsync` do diretório quando suportado; o ficheiro principal só recebe estado final COMMITTED. Serializa escritores no mesmo path, usa temporários únicos, deduplica por `originFingerprint` e `providerObservationKey`, e só grava o checkpoint depois de os itens estarem duráveis. `ingestedAt`/`asKnownAt` são preenchidos após o staging durável e antes da publicação final; uma interrupção deixa apenas staging privado e permite finalização no próximo ciclo. `read()` rejeita estados principais provisórios. `news-core/worker.ts` é executável por processo e não importa sessão web, cookies ou request HTTP de utilizador.

O cursor é particionado por `sec-edgar + CIK + versão/formulários/janela`; cada poll relê uma janela de sobreposição de sete dias e usa accession/CIK como chave de idempotência. Isso permite aceitar filings que chegam fora de ordem sem recuar o watermark.

O contrato é próprio do News Core (`news-core/contracts.ts`); não reutiliza `DataEnvelope`, não altera `market-data-core` e não envia watchlists ou dados de contas à SEC.

## Evidências executadas

- `npm run test:news`: **7/7 PASS**.
  - payload SEC válido e URL oficial;
  - payload malformado rejeitado;
  - fonte HTTP 503 exposta como `SEC_UNAVAILABLE`;
  - CIKs independentes e chegada fora de ordem com janela de sobreposição;
  - concorrência de dois writers no mesmo store;
  - repetição idempotente e fonte 503;
  - leitura durante staging incompleto sem exposição PIT;
  - crash antes do staging e depois do staging durável, com recuperação de timestamps/checkpoint;
  - payloads com CIK incoerente, arrays desalinhados, datas impossíveis, accession inválido e traversal rejeitados.
- `npx tsc --noEmit`: **PASS**.
- `npm run lint -- --quiet`: **PASS**.
- Ensaio real, sem sessão, em 2026-11-11: quatro processos contra `data.sec.gov`, User-Agent explícito, store temporário local, CIK Apple `0000320193` e CIK Microsoft `0000789019`.
  - Apple: `147` novas publicações no primeiro ciclo;
  - Microsoft: `85` novas publicações no primeiro ciclo;
  - Apple repetido: `0` novas publicações depois da janela já estabilizada;
  - resultado: `232` publicações, `232` observações e `2` checkpoints com `collectionScopeKey` distintos; todos os processos terminaram com exit code 0.

Este ensaio comprova uma recolha real e uma repetição sem duplicação no store local, não disponibilidade 24/7, SLA da SEC, execução supervisionada ou produção.

## Limitações e pendências

- O store é local e adequado ao ensaio N1; falta a persistência PostgreSQL multi-instância, RLS/isolamento operacional, leases e supervisor de produção. O locking implementado é intra-processo/intra-runtime; não é uma garantia multi-instância.
- Ainda não há API interna de leitura, paginação PIT, revisão/correção, ligação a eventos, scheduler permanente, backfill avançado ou dead-letter.
- Os testes de interrupção são injeções determinísticas antes e depois do primeiro commit durável; não são ainda um ensaio de kill de processo com supervisor real.
- O workflow `.github/workflows/news-core.yml` executa `npm ci`, `npm run test:news` e `npx tsc --noEmit` em alterações do News Core. A execução remota anterior (`run 42978309581`) passou 6/6 no SHA anterior; esta correção aguarda uma nova execução no SHA final.
- Não foi executada migração remota, deploy, merge ou produção.
- O ensaio real dependeu da disponibilidade da SEC no momento; não constitui prova de operação contínua.

Consequentemente, este branch é uma preparação de Draft PR N1 e não uma declaração de encerramento do N1.
