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
| N0-T18 | N3/N4 | NOT_PROVEN | N4 cobre bloqueio determinístico de hosts privados e redirects; DNS rebinding em rede controlada ainda não foi provado |
| N0-T19 | N3 | PASS | conteúdo hostil tratado como dados em N3-A |
| N0-T20 | N3 | NOT_PROVEN | isolamento de contas não pertence ao circuito News testado |
| N0-T21 | N3 | NOT_PROVEN | Investing passou, mas a compatibilidade conjunta Investing + Trading não foi ensaiada |
| N0-T22 | N2/N5 | PASS | N5 unitário/PG17 cobre paginação estável, cursor HMAC, histórico PIT e cutoff |
| N0-T23 | N2/N3 | PASS | recusa conservadora sem evidência em N3-A/B |
| N0-T24 | N1 | PASS | rollback/atomicidade em PG17 |
| N0-T25 | N1/N4/N5 | PASS | N5 SEC live executa dois ciclos; BL4 prova supervisor factual sem sessão; autonomia 24/7 permanece fora desta prova |
| N0-T26 | N1/N3/N4 | PASS | recovery/idempotência N1/N3-C, backlog durável, SIGKILL e fencing BL4 |
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
| N0-T37 | N2/N5 | PASS | N5 HMAC, estrutura exata do cursor e rejeição de cutoff futuro em unitário/PG17/live |
| N0-AUT-001 | N0/N1/N4/N5 | NOT_PROVEN | há ciclos SEC live, supervisor e recovery PG17, mas não há prova de operação contínua 24/7 no destino |

## Auditoria final N5 — reconciliação individual contra N0 original

Fonte normativa: PR #90, SHA `a358cf9cc3e0427cefc18b02f6c3c653b2a61e7b`, estado `N0_REVIEW_READY`. A tabela abaixo não promove a especificação a aprovada e não altera o PR #90. Evidência de CI refere-se ao SHA final desta cadeia quando indicada; provas de fixture, mocks e PG17 isolado não são tratados como provas de produção.

| ID | Contrato normativo original | Implementação/prova reproduzível | Estado | Lacuna ou correção necessária |
|---|---|---|---|---|
| N0-T01 | Mesma publicação duas vezes produz uma identidade lógica | N1/PostgreSQL, idempotência de publicação e `secLiveN5` | PASS | — |
| N0-T02 | Publicação corrigida cria revisão nova e preserva a anterior | N2-A revisões append-only/PIT | PASS | — |
| N0-T03 | 25 jornais sobre o mesmo facto, sem falsa independência | N2-C/N3-B só ensaiam relações estruturais e grupos editoriais menores | NOT_PROVEN | Ensaio normativo com 25 fontes reais e dependência editorial comprovada |
| N0-T04 | Títulos parecidos mas eventos diferentes não são fundidos | N2-C não-fusão conservadora | PASS | — |
| N0-T05 | Empresas com nomes semelhantes não recebem identidade arbitrária | N2-B identidade ambígua | PASS | — |
| N0-T06 | Mesmo ticker em bolsas diferentes resolve com segurança ou ambiguidade | N2-B ticker/venue ambíguo | PASS | — |
| N0-T07 | Empresa com várias cotações liga primeiro ao emissor quando adequado | N2-B ligação ao emissor | PASS | — |
| N0-T08 | Empresa detida por ETF é `INDIRECT_EXPOSURE`, não relação direta | N2-B exposição indireta | PASS | — |
| N0-T09 | Rumor não confirmado não é facto confirmado | N3-A/B recusa conservadora e estados ortogonais | PASS | — |
| N0-T10 | Republicações da mesma origem contam uma única vez | N3-B grupos editoriais e independência | PASS | — |
| N0-T11 | Publicação posterior ao cutoff não aparece no passado | N2/N3 PIT PG17 | PASS | — |
| N0-T12 | Correção posterior não aparece antes da correção | Revisões históricas N2/N3-C | PASS | — |
| N0-T13 | Identity link posterior não aparece historicamente | N2-C PIT de links | PASS | — |
| N0-T14 | Fusão/split posterior mantém histórico anterior reproduzível | Não existe ensaio completo de merge/split normativo | NOT_PROVEN | Executar merge e split com leituras antes/depois do cutoff |
| N0-T15 | Duas partições CIK têm checkpoints e recovery independentes | Há partições/checkpoints no contrato e testes unitários, sem ensaio completo A/B live | NOT_PROVEN | Rehearsal com dois CIK e recovery independente |
| N0-T16 | Fornecedor offline gera falha explícita, sem dados inventados | Testes de indisponibilidade SEC/adaptador | PASS | — |
| N0-T17 | Resposta externa malformada é rejeitada | Testes N1/N4 de payload malformado | PASS | — |
| N0-T18 | SSRF e redirect para IP interno são bloqueados, incluindo rebinding | N4 cobre destinos privados, redirects e TLS; DNS rebinding controlado não foi provado | NOT_PROVEN | Ensaio de rede controlado contra resolução mutável |
| N0-T19 | Prompt injection em artigo nunca é executado | N3-A trata conteúdo externo exclusivamente como dados | PASS | — |
| N0-T20 | Duas contas distintas permanecem isoladas | O circuito News é global e não demonstra consumidores de contas privadas | NOT_PROVEN | Ensaio autorizado de isolamento por conta |
| N0-T21 | Investing e Trading usam contratos compatíveis sem dependências reversas | Investing passa; compatibilidade conjunta com Trading não foi ensaiada | NOT_PROVEN | Rehearsal dos dois consumidores sem alterar os motores |
| N0-T22 | Paginação PIT não omite, duplica nem inclui futuro | N5 unitário/PG17 cobre cursor, páginas, cutoff e histórico | PASS | — |
| N0-T23 | Classificação sem evidência não confirma | N3-A/B e pipeline conservador | PASS | — |
| N0-T24 | Falha transacional não deixa metade da revisão | N3-C PG17, rollback/crash/idempotência | PASS | — |
| N0-T25 | Zero sessões, dois ciclos e publicação genuína verificável | N5 SEC live executa dois ciclos; BL4 executa supervisor factual sem sessão e leitura N5 | PASS | A prova não constitui garantia 24/7 do destino |
| N0-T26 | Crash entre fetch e persistência recupera sem duplicação | BL3/BL4, backlog durável, `SIGKILL`, fencing e replay | PASS | — |
| N0-T27 | Período de indisponibilidade recupera por backfill/checkpoint | Há recovery controlado e backfill de fila, mas não período real de indisponibilidade de fonte | NOT_PROVEN | Simular/ensaiar indisponibilidade temporal real e backfill completo |
| N0-T28 | Conflito de relógio gera flag e não falsifica `asKnownAt` | Há invariantes PIT, mas não ensaio completo de relógio externo conflitante | NOT_PROVEN | Fixture/rehearsal com relógio de fornecedor adiantado/atrasado |
| N0-T29 | Duas tarefas concorrentes do mesmo item geram um resultado lógico | Constraints, claims, fencing e testes PG17 | PASS | — |
| N0-T30 | Lista vazia de fonte funcional é `AVAILABLE` com `data=[]` | N5 envelope e testes de lista vazia | PASS | — |
| N0-T31 | Evento futuro usa `scheduledFor`, não `occurredAt` | N3-A temporal e testes negativos | PASS | — |
| N0-T32 | Evidência derivada posterior é excluída do cutoff anterior | N3-C/N5 PIT e dependências temporais | PASS | — |
| N0-T33 | Semânticas temporais Market/News não são confundidas | NewsEnvelope próprio e Market intacto; compatibilidade temporal end-to-end não foi provada | NOT_PROVEN | Adaptador versionado e ensaio conjunto, sem alterar Market |
| N0-T34 | Dois agregadores preservam observações e só unificam com prova editorial | N2 observações/proveniência separadas | PASS | — |
| N0-T35 | `asKnownAt` derivado é posterior ou igual às dependências | N3-D/N3-C dependências PIT | PASS | — |
| N0-T36 | Falha parcial antes do checkpoint não perde pendências | N1/N3 backlog, atomicidade e recovery PG17 | PASS | — |
| N0-T37 | Cursor adulterado e cutoff futuro são recusados | N5 HMAC, estrutura exata e cutoff futuro em unitário/PG17/live | PASS | — |
| N0-AUT-001 | News Core trabalha sem sessões, com scheduler, checkpoint, recovery, backoff, leases e supervisor | BL4 prova supervisor, `SIGKILL`, fencing, backlog local, dois ciclos e SEC live; não prova horas/dias de autonomia no destino | NOT_PROVEN | Validação operacional contínua no ambiente de produção |

### Decisão de aceitação

`N0_APPROVED=NO` e `NEWS_CORE_PRODUCTION_READY=NO`. Permanecem bloqueadores normativos T03, T14, T15, T18, T20, T21, T27, T28, T33 e AUT-001, além da reconciliação formal e revisão independente do PR #90. Não houve merge, cherry-pick, deploy ou migração remota.

## Provas transversais N3-D

`postgresNewsN3d.test.ts` executa em PostgreSQL 17 real o circuito N2 COMMITTED → `DeterministicFactClassifierV1` → `DeterministicEvidenceCorroboratorV1` → `PostgresFactualStore` → leitura PIT. Verifica identidade, fingerprints, proveniência, estados, dependências, revisão `REPORTED`, visibilidade antes/depois e recuperação idempotente de uma revisão OPEN após falha pós-commit.

## Evidência N5

`n5Api.test.ts` prova a forma canónica `NewsEnvelope` versão `1.0`, `requestId`, autenticação de serviço, filtros, limites, cutoff futuro, paginação com cursor HMAC e rejeição de adulteração. A migration `20261112150000_news_core_n5_read_api.sql` expõe apenas funções PIT de leitura para histórico, evidência e filtros, mantendo as tabelas factuais sem privilégios de leitura direta. O gate PG17 N5 aplica N1, N2-A e N3-C antes desta migration e executa com uma role de serviço não administrativa.

O circuito completo sem sessão, duas recolhas SEC live, recuperação autónoma de OPEN e compatibilidade Investing+Trading continuam `NOT_PROVEN` nesta fase: a N5 não fabrica uma prova end-to-end quando o worker existente não encadeia automaticamente N3-A/B nem há isolamento de produção do `news_factual_writer`. DNS rebinding/TOCTOU e operação 24/7 permanecem pendentes.

O mesmo ensaio comprova que `news_service` não pode ler tabelas factuais nem selar revisões, que as três roles são `NOLOGIN` e que `news_factual_writer` não herda memberships. Também regista explicitamente a limitação de confiança: o writer dedicado ainda possui INSERT bruto e EXECUTE da selagem. Essa capacidade é `BLOCKED` para uma afirmação de isolamento de produção; não é convertida em PASS por uma conexão administrativa com `SET ROLE`.

Não foram executados neste PR: fornecedores externos alternativos, DNS rebinding em rede controlada, operação autónoma 24/7, integração automática N3-A/B→N5, deploy ou migrações remotas. As APIs N5 foram executadas nos gates unitário, PG17 e SEC live deste PR; isso não promove os critérios pendentes a PASS.

## Evidência N4

`secLiveN4.test.ts` executou o endpoint oficial SEC EDGAR em CI e registou no log um SHA-256 sanitizado da resposta, CIK validado e publicações oficiais. `sourceSecurityN4.test.ts` cobre política local para schemes/hosts privados, metadata, redirects e conteúdo hostil. Essas provas não alteram `N0-T18` para PASS porque o critério normativo exige DNS/rebinding controlado. `N0-T25` foi promovido a PASS apenas pelo ensaio posterior de dois ciclos SEC live e pela prova sem sessão do BL4; isso não promove `N0-AUT-001` nem demonstra operação contínua 24/7 no destino.
