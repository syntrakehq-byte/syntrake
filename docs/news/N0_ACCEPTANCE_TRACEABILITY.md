# N0 — matriz de rastreabilidade e provas N3-D

## Fonte normativa e linhagem

Fonte normativa imutável: PR #90, `a358cf9cc3e0427cefc18b02f6c3c653b2a61e7b`, contendo `docs/news/N0_CANONICAL_SPEC.md` e a matriz original N0-T01..T37. O estado dessa fonte é `N0_REVIEW_READY`, não `N0_APPROVED`. O PR #99 diverge dessa linhagem; o ficheiro canónico N0 não está presente na árvore deste SHA. Esta matriz é uma reconciliação de rastreabilidade, não uma substituição silenciosa da especificação original.

O gate de reconciliação canónica do N0 permanece pendente antes de integração/merge. Não foi feito cherry-pick, merge ou alteração automática do PR #90.

Esta matriz preserva os critérios N0-T01..T37. `PASS` significa que existe uma execução reproduzível no SHA deste PR; `NOT_PROVEN` significa que o critério continua sem prova suficiente; `BLOCKED` significa que o ensaio demonstrou uma fronteira que impede declarar o critério fechado. Esta matriz não declara `N0_APPROVED`, operação 24/7 ou produção.

| ID | Fase | Estado no N3-D | Prova/limitação |
|---|---|---|---|
| N0-T01 | N1 | PASS | `postgresNews.test.ts` — idempotência de publicação |
| N0-T02 | N2 | PASS | `postgresNewsN2a.test.ts` — revisões preservadas |
| N0-T03 | N2 | NOT_PROVEN | N2-C cobre apenas relações estruturais com 3 publicações; N0 exige 25 jornais do mesmo facto verificados |
| N0-T04 | N2 | PASS | `postgresNewsN2c.test.ts` — não fusão conservadora |
| N0-T05 | N2 | PASS | `postgresNewsN2b.test.ts` — identidade ambígua |
| N0-T06 | N2 | PASS | `postgresNewsN2b.test.ts` — ticker/venue ambíguo |
| N0-T07 | N2 | PASS | `postgresNewsN2b.test.ts` — ligação ao emissor |
| N0-T08 | N2 | PASS | `postgresNewsN2b.test.ts` — exposição indireta |
| N0-T09 | N2/N3 | PASS | `factualClassification.test.ts` e `evidenceCorroboration.test.ts` |
| N0-T10 | N2/N3 | PASS | corroboração e grupos editoriais N3-B |
| N0-T11 | N2 | PASS | PIT estrutural N2-A/B/C |
| N0-T12 | N2 | PASS | correção histórica N2-C |
| N0-T13 | N2 | PASS | PIT de ligações N2-C |
| N0-T14 | N2 | NOT_PROVEN | histórico estrutural parcial; merge/split completo do critério N0 não foi executado |
| N0-T15 | N1 | NOT_PROVEN | não há ensaio completo por CIK nesta auditoria |
| N0-T16 | N1 | PASS | testes de indisponibilidade do adaptador SEC |
| N0-T17 | N1 | PASS | payload malformado rejeitado |
| N0-T18 | N3 | NOT_PROVEN | SSRF/redirect não é exercitado pelo gate News |
| N0-T19 | N3 | PASS | conteúdo hostil tratado como dados em N3-A |
| N0-T20 | N3 | NOT_PROVEN | isolamento de contas não pertence ao circuito News testado |
| N0-T21 | N3 | NOT_PROVEN | Investing passou, mas a compatibilidade conjunta Investing + Trading não foi ensaiada |
| N0-T22 | N2 | NOT_PROVEN | paginação histórica end-to-end não é exercitada aqui |
| N0-T23 | N2/N3 | PASS | recusa conservadora sem evidência em N3-A/B |
| N0-T24 | N1 | PASS | rollback/atomicidade em PG17 |
| N0-T25 | N1/N4 | NOT_PROVEN | polls reais e autonomia 24/7 não demonstrados |
| N0-T26 | N1 | PASS | recovery/idempotência N1 e N3-C |
| N0-T27 | N1/N3 | NOT_PROVEN | backfill real por partição não demonstrado |
| N0-T28 | N2 | NOT_PROVEN | conflito de relógio de fornecedor não foi ensaiado neste gate |
| N0-T29 | N1 | PASS | concorrência/idempotência PG17 |
| N0-T30 | N1 | PASS | resposta vazia disponível distinguida de erro |
| N0-T31 | N2/N3 | PASS | `scheduledFor` separado de `occurredAt` |
| N0-T32 | N2/N3 | PASS | dependências PIT excluem conhecimento futuro |
| N0-T33 | N0/N1 | NOT_PROVEN | ausência de alterações ao Market não prova o cenário completo de validadores incompatíveis |
| N0-T34 | N1/N2 | PASS | observações e proveniência separadas |
| N0-T35 | N2/N3 | PASS | N3-D prova `as_known_at` derivado após proposta/dependências |
| N0-T36 | N1 | PASS | commit/checkpoint e recovery PG17 |
| N0-T37 | N2 | NOT_PROVEN | cursor assinado e cutoff futuro não são gate N3-D |

## Provas transversais N3-D

`postgresNewsN3d.test.ts` executa em PostgreSQL 17 real o circuito N2 COMMITTED → `DeterministicFactClassifierV1` → `DeterministicEvidenceCorroboratorV1` → `PostgresFactualStore` → leitura PIT. Verifica identidade, fingerprints, proveniência, estados, dependências, revisão `REPORTED`, visibilidade antes/depois e recuperação idempotente de uma revisão OPEN após falha pós-commit.

O mesmo ensaio comprova que `news_service` não pode ler tabelas factuais nem selar revisões, que as três roles são `NOLOGIN` e que `news_factual_writer` não herda memberships. Também regista explicitamente a limitação de confiança: o writer dedicado ainda possui INSERT bruto e EXECUTE da selagem. Essa capacidade é `BLOCKED` para uma afirmação de isolamento de produção; não é convertida em PASS por uma conexão administrativa com `SET ROLE`.

Não foram executados neste PR: fontes reais, fornecedores externos, SSRF, operação autónoma 24/7, APIs N5, deploy ou migrações remotas.
