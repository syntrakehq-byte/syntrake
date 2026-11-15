# N0 — matriz de rastreabilidade e aceitação final do News Core

## Fonte normativa e linhagem

Fonte normativa imutável: PR #90, `a358cf9cc3e0427cefc18b02f6c3c653b2a61e7b`, contendo `docs/news/N0_CANONICAL_SPEC.md` e a matriz original N0-T01..T37. O estado dessa fonte é `N0_REVIEW_READY`, não `N0_APPROVED`. O PR #99 diverge dessa linhagem; o ficheiro canónico N0 não está presente na árvore deste SHA. Esta matriz é uma reconciliação de rastreabilidade, não uma substituição silenciosa da especificação original.

O gate de reconciliação canónica do N0 permanece pendente antes de integração/merge. Não foi feito cherry-pick, merge ou alteração automática do PR #90.

Esta matriz preserva os critérios N0-T01..T37. `PASS` significa que existe uma execução reproduzível no SHA deste PR; `NOT_PROVEN` significa que o critério continua sem prova suficiente; `BLOCKED` significa que o ensaio demonstrou uma fronteira que impede declarar o critério fechado. Esta matriz não declara `N0_APPROVED`, operação 24/7 ou produção.

| ID | Fase | Estado no snapshot histórico N3-D | Prova/limitação |
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
| N0-T14 | N2 | PASS | `postgresNewsN2c.test.ts`, workflow PG17, `N0_T14_PROOF`: merge/membership correction, split, leituras PIT antes/depois e histórico append-only |
| N0-T15 | N1 | PASS | workflow News Core `43710279989`, job `132800125135`, SHA `0f6fbb2a203c0544b507f6ff6e6ea8620b726ba6`: dois CIK reais (`0000320193`/`0000789019`), dois processos independentes, `SIGKILL` ao grupo real, reclaim natural após expiração do lease, checkpoints separados, fencing e replay sem duplicação |
| N0-T16 | N1 | PASS | testes de indisponibilidade do adaptador SEC |
| N0-T17 | N1 | PASS | payload malformado rejeitado |
| N0-T18 | N3/N4 | NOT_PROVEN | N4 cobre bloqueio determinístico de hosts privados e redirects; DNS rebinding em rede controlada ainda não foi provado |
| N0-T19 | N3 | PASS | conteúdo hostil tratado como dados em N3-A |
| N0-T20 | N3 | PASS | workflow News Core `43726149171`, job `132848394075`, SHA `691030ae34ad883f3d2f7cb90570060e5d1a458d`: duas identidades LOGIN autenticadas, RLS server-side, cada identidade vê apenas a sua conta e a fronteira News global não encaminha dados privados |
| N0-T21 | N3 | PASS | workflow News Core `43726566145`, job `132849672293`, SHA `737bb5d7f`: `news-consumer-v1` é o mesmo contrato neutral para `INVESTING` e `TRADING`, sem campos privados, ordens, carteiras ou dependências reversas; Trading permanece apenas consumidor contratual |
| N0-T22 | N2/N5 | PASS | N5 unitário/PG17 cobre paginação estável, cursor HMAC, histórico PIT e cutoff |
| N0-T23 | N2/N3 | PASS | recusa conservadora sem evidência em N3-A/B |
| N0-T24 | N1 | PASS | rollback/atomicidade em PG17 |
| N0-T25 | N1/N4/N5 | PASS | `secLiveN5.test.ts`, workflow PG17/SEC live, baseline 0, accession genuíno, primeira ingestão 1, segunda 1, checkpoint e revisão única |
| N0-T26 | N1/N3/N4 | PASS | `secLiveN5.test.ts`, processo-filho PID1 terminado por `SIGKILL` pós-fetch/pré-commit, checkpoint/publicação ausentes durante a falha, PID2 recupera e PID3 repete sem duplicação |
| N0-T27 | N1/N3 | PASS | workflow News Core `43726149171`, job `132848394075`, SHA `691030ae34ad883f3d2f7cb90570060e5d1a458d`: resposta SEC genuína, lacuna temporal, outage, backoff natural, checkpoint estável, backfill de 147 accession e deduplicação |
| N0-T28 | N2 | NOT_PROVEN | rehearsal consolidado confirma `SOURCE_CLOCK_CONFLICT`, `asKnownAt` posterior à ingestão e PIT anterior oculto; não cobre autoridade de relógio externa completa |
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
| N0-T14 | Fusão/split posterior mantém histórico anterior reproduzível | `postgresNewsN2c.test.ts`, workflow News PG17 final, `N0_T14_PROOF` regista `mergeMembers=2`, `splitEffective=0`, `historyRows=6` e `pitBeforeAfter=verified` | PASS | Prova limitada a relações editoriais estruturais em PG17 isolado; não é prova de produção |
| N0-T15 | Duas partições CIK têm checkpoints e recovery independentes | SHA `25325ffef0d76d23c2ea483c34451f44faba18cd`, workflow News `43689194384`, job `132736003726`: `N0_CONSOLIDATED_PROOF` confirma CIK `0000320193`/`0000789019`, `checkpoints=2` e `replayDuplicates=0` em PG17 | NOT_PROVEN | Prova controlada de partições e replay; falta falha/recovery independente de cada partição com recolha real completa |
| N0-T16 | Fornecedor offline gera falha explícita, sem dados inventados | Testes de indisponibilidade SEC/adaptador | PASS | — |
| N0-T17 | Resposta externa malformada é rejeitada | Testes N1/N4 de payload malformado | PASS | — |
| N0-T18 | SSRF e redirect para IP interno são bloqueados, incluindo rebinding | N4 cobre destinos privados, redirects e TLS; DNS rebinding controlado não foi provado | NOT_PROVEN | Ensaio de rede controlado contra resolução mutável |
| N0-T19 | Prompt injection em artigo nunca é executado | N3-A trata conteúdo externo exclusivamente como dados | PASS | — |
| N0-T20 | Duas contas distintas permanecem isoladas | O circuito News é global e não demonstra consumidores de contas privadas | NOT_PROVEN | Ensaio autorizado de isolamento por conta |
| N0-T21 | Investing e Trading usam contratos compatíveis sem dependências reversas | Investing passa; compatibilidade conjunta com Trading não foi ensaiada | NOT_PROVEN | Rehearsal dos dois consumidores sem alterar os motores |
| N0-T22 | Paginação PIT não omite, duplica nem inclui futuro | N5 unitário/PG17 cobre cursor, páginas, cutoff e histórico | PASS | — |
| N0-T23 | Classificação sem evidência não confirma | N3-A/B e pipeline conservador | PASS | — |
| N0-T24 | Falha transacional não deixa metade da revisão | N3-C PG17, rollback/crash/idempotência | PASS | — |
| N0-T25 | Zero sessões, dois ciclos e publicação genuína verificável | No SHA `3d3e97a241cccde2d658075642af8030272399c8`, job PG17/SEC live `132586237285`, `N0_T25_PROOF` regista CIK `0000320193`, accession `0001140361-26-042798`, fonte SEC, fingerprint, baseline 0, firstCount 1, secondCount 1 e checkpoint | PASS | Rehearsal usa uma resposta SEC live genuína e replay determinístico em base temporária; não prova autonomia 24/7 |
| N0-T26 | Crash entre fetch e persistência recupera sem duplicação | No SHA `564ccaeea0a8427b699ed6e54de82ec336b77587`, workflow News Core `43683264677`, job `132718271928`: `N0_T26_PID1 pid=4701 exitSignal=SIGKILL publicationsDuringCrash=0 checkpointsDuringCrash=0`; `N0_T26_RECLAIM_READY` confirmou execução RUNNING ligada e lease expirado; `N0_T26_PROOF` registou PID2 `4732`, PID3 `4756`, `finalPublications=1`, `finalRevisions=1`, `replayDuplicates=0` | PASS | Prova limitada ao PostgreSQL 17/SEC live em base temporária e ao harness de crash; não é prova de produção 24/7 |
| N0-T27 | Período de indisponibilidade recupera por backfill/checkpoint | SHA `25325ffef0d76d23c2ea483c34451f44faba18cd`, job `132736003726`: `T27=PARTIAL_PASS`, outage deixou checkpoint inalterado e ciclo posterior recuperou | NOT_PROVEN | Falta backfill integral de uma lacuna temporal e prova de indisponibilidade da fonte por período operacional |
| N0-T28 | Conflito de relógio gera flag e não falsifica `asKnownAt` | Mesmo job: `T28=PARTIAL_PASS`, `futureFlag=SOURCE_CLOCK_CONFLICT`, `asKnownAtPIT=verified`, data passada sem flag indevida | NOT_PROVEN | Falta autoridade de relógio externa e ensaio completo de drift adiantado/atrasado no ambiente normativo |
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

`N0_APPROVED=NO` e `NEWS_CORE_PRODUCTION_READY=NO`. Permanecem bloqueadores normativos T03, T15, T18, T20, T21, T27, T28, T33 e AUT-001, além da reconciliação formal e revisão independente do PR #90. Não houve merge, cherry-pick, deploy ou migração remota.

## Snapshot histórico N3-D (substituído pela auditoria final)

`postgresNewsN3d.test.ts` executa em PostgreSQL 17 real o circuito N2 COMMITTED → `DeterministicFactClassifierV1` → `DeterministicEvidenceCorroboratorV1` → `PostgresFactualStore` → leitura PIT. Verifica identidade, fingerprints, proveniência, estados, dependências, revisão `REPORTED`, visibilidade antes/depois e recuperação idempotente de uma revisão OPEN após falha pós-commit.

## Evidência N5

`n5Api.test.ts` prova a forma canónica `NewsEnvelope` versão `1.0`, `requestId`, autenticação de serviço, filtros, limites, cutoff futuro, paginação com cursor HMAC e rejeição de adulteração. A migration `20261112150000_news_core_n5_read_api.sql` expõe apenas funções PIT de leitura para histórico, evidência e filtros, mantendo as tabelas factuais sem privilégios de leitura direta. O gate PG17 N5 aplica N1, N2-A e N3-C antes desta migration e executa com uma role de serviço não administrativa.

Este parágrafo é um registo histórico do snapshot N3-D e não descreve o HEAD atual. As provas BL3/BL4 posteriores demonstram o encadeamento operacional, o supervisor, SIGKILL, fencing e recuperação de backlog. O rehearsal N0-T25/T26 posterior fechou esses dois critérios no âmbito PG17/SEC live; T26 inclui agora crash real de processo-filho com recuperação em processos distintos. AUT-001, T18, T20, T21, T27, T28 e T33 continuam igualmente não provados.

O ensaio histórico comprova que `news_service` não podia ler tabelas factuais nem selar revisões no snapshot então testado. No HEAD atual, a ACL BL1 revoga DML bruto e EXECUTE direto da selagem às identidades não autorizadas e mantém o writer atrás da fronteira protegida, no âmbito PG17 testado. A compatibilidade do destino de produção continua `NOT_PROVEN_IN_PRODUCTION`; este documento não transforma a prova local em garantia de produção.

Não foram executados neste PR: fornecedores externos alternativos, DNS rebinding em rede controlada, operação autónoma 24/7, deploy ou migrações remotas. O encadeamento N3-A/B→N5 foi executado posteriormente nos ensaios BL3/BL4, e T25/T26 foram fechados pelo rehearsal isolado documentado abaixo. As APIs N5 foram executadas nos gates unitário, PG17 e SEC live; isso não promove os critérios pendentes a PASS.

## Evidência N4

`secLiveN4.test.ts` executou o endpoint oficial SEC EDGAR em CI e registou no log um SHA-256 sanitizado da resposta, CIK validado e publicações oficiais. `sourceSecurityN4.test.ts` cobre schemes/hosts privados, metadata, redirects, TLS e IPv4/IPv6, mas a segunda resolução de DNS em socket mutável ainda não foi provada como ensaio real de rebinding; por isso T18 permanece `NOT_PROVEN`. O rehearsal `secLiveN5.test.ts` isolou o baseline e fechou T25/T26 no âmbito PG17/SEC live; isso não promove AUT-001 nem os restantes critérios pendentes.

## Errata final BL5 — tabela autoritativa sobre os snapshots anteriores

Esta secção é a decisão documental autoritativa para este SHA. As tabelas e parágrafos anteriores que usam o rótulo N3-D são snapshots históricos, preservados para rastreabilidade temporal; não são afirmações atuais quando divergem desta secção.

### Correções de estado e prova

| Critério | Estado autoritativo | Prova observada | Limitação objetiva |
|---|---|---|---|
| N0-T18 | NOT_PROVEN | `sourceSecurityN4.test.ts` cobre destinos privados, metadata, redirects, TLS e IPv4/IPv6; o transporte usa o IP validado | falta prova de rebinding real com segunda resolução mutável entre resolução e socket |
| N0-T25 | PASS | `secLiveN5.test.ts`, job `132586237285`, baseline 0, accession genuíno, firstCount 1, secondCount 1, checkpoint e revisão única | prova limitada ao rehearsal SEC live + replay determinístico em base temporária |
| N0-T26 | PASS | `secLiveN5.test.ts`, SHA `564ccaeea0a8427b699ed6e54de82ec336b77587`, job `132718271928`: PID1 `4701` terminou por `SIGKILL`, PID2 `4732` recuperou após lease expirado e PID3 `4756` repetiu; publicação/revisão finais 1/1 e `replayDuplicates=0` | prova restrita ao ensaio PG17/SEC live em base temporária; não substitui operação 24/7 em produção |
| N0-T28 | NOT_PROVEN | SHA `25325ffef0d76d23c2ea483c34451f44faba18cd`, job `132736003726`: flag futura, data passada sem flag, `asKnownAt` e PIT verificados | falta autoridade de relógio externa e ensaio completo de drift no ambiente normativo |

T25 e T26 são `PASS` apenas no âmbito do rehearsal PG17/SEC live identificado acima. A lista vigente de requisitos `NOT_PROVEN` é: T03, T15, T18, T20, T21, T27, T28, T33 e AUT-001. Há agora 29 critérios `PASS` e 9 `NOT_PROVEN`; nenhum `PASS` significa prova de produção.

### Rehearsal consolidado dos critérios locais restantes

No SHA `25325ffef0d76d23c2ea483c34451f44faba18cd`, o workflow News Core `43689194384`, job `132736003726`, executou `test:news:n0:consolidated` em PostgreSQL 17 real. O log `N0_CONSOLIDATED_PROOF` registou `T15=PARTIAL_PASS` (dois CIK/checkpoints e replay idempotente), `T27=PARTIAL_PASS` (outage sem avanço de checkpoint e recuperação) e `T28=PARTIAL_PASS` (flag de relógio futuro, data passada sem flag indevida e PIT por `asKnownAt`). Estes resultados são evidência parcial, não promoção automática a `PASS`.

### Reconciliação das secções legadas

As afirmações históricas sobre inexistência de encadeamento N3-A/B→N5 foram verdadeiras apenas nos snapshots anteriores ao BL3/BL4. No HEAD auditado, os testes `productionReadinessBlock3Operational.test.ts`, `newsFactualSupervisorRecovery.test.ts` e `secLiveN5.test.ts` demonstram o encadeamento operacional, supervisor, fencing, recuperação de backlog e o rehearsal específico T25/T26; AUT-001 continua fora do âmbito.

As afirmações históricas sobre writer `NOLOGIN`, DML direto e selagem também não devem ser lidas como estado atual: BL1/ACL corrigiu essa fronteira no âmbito PG17 testado. A compatibilidade do destino Supabase/produção continua `NOT_PROVEN_IN_PRODUCTION` porque não houve deploy, migração remota ou verificação do ambiente.

### Decisão preservada

`N0_APPROVED=NO` e `NEWS_CORE_PRODUCTION_READY=NO`. Não declarar fecho do Bloco 5 enquanto os requisitos acima permanecerem sem prova completa. Não houve merge, deploy, migração remota ou alteração de Market, Investing, Trading ou Ledger.

### Prova BL4 factual estabilizada

No SHA `7456db48a7973dd85431cb074f69333304f015b183`, os jobs News Core `132576255379`/`132577224460` do workflow `43637123793`/`43637436104` executaram `newsFactualSupervisorRecovery.test.ts` sem falhas. A publicação-alvo foi observada antes da leitura N5 em `state=DONE`, `completed=PERSISTED`, `pit_visibility_state=DURABLE`, com `finalized_at`, `as_known_at` e `committed_at` presentes. No SHA `564ccaeea0a8427b699ed6e54de82ec336b77587`, o job `132718271928` fechou T25/T26 com base temporária, baseline limpo, replay SEC genuíno e crash real de PID1 por `SIGKILL`, recuperação em PID2 e replay em PID3. T25/T26 estão `PASS` no âmbito do rehearsal; a operação 24/7 e a garantia de produção permanecem fora da prova.
### Fecho consolidado de autonomia (SHA 58f06bad)

O runbook `docs/news/VERCEL_DAEMONS_RUNBOOK.md` prepara uma opcao de execucao
continua, mas nao constitui deploy, ensaio no ambiente de destino ou prova de
compatibilidade Supabase/Vercel. A proposta Investing-only tambem nao derroga
`N0-AUT-001`: autonomia 24/7 continua requisito obrigatorio.

Os criterios T03, T18, T20, T21, T27, T33 e `N0-AUT-001` permanecem
`NOT_PROVEN`. T15 foi promovido a `PASS` apenas depois da prova PG17/SEC live
com dois processos e reclaim natural descrita abaixo; nenhuma
fonte, identidade, integracao ou resultado foi fabricado. `N0_APPROVED=NO` e
`NEWS_CORE_PRODUCTION_READY=NO` permanecem.

## Revisao normativa independente de T18 e T28 — 2026-11-15 (estado vigente)

Esta revisao compara **diretamente** os criterios do PR #90 (`a358cf9cc3e0427cefc18b02f6c3c653b2a61e7b`) com testes e codigo existentes no SHA `d7b3ef214b20414791269a77aa6a585702dd91aa`. **Substitui os estados T18/T28 e as contagens de todos os snapshots historicos anteriores deste documento, sem alterar a especificacao canonica.** A classificacao e especifica ao criterio N0, nao implica disponibilidade de producao nem aprovacao do PR #90.

| Criterio | Estado normativo reavaliado | Prova no codigo/testes | Fronteira que NAO se afirma |
|---|---|---|---|
| **N0-T18** — `SSRF/redirect para IP interno`: bloqueado | **PASS (ambito canonico)** | `sourceSecurityN4.test.ts` cobre URLs privadas, metadata, hosts restritos, redirecionamentos e IPv4/IPv6; a prova `BL2 real SEC TLS transport pins the approved address and resists a second DNS resolution` obtém dados reais de `data.sec.gov`, usa um resolver cuja segunda resposta seria `127.0.0.1` e verifica **uma unica chamada de resolucao**. `sourceSecurity.ts:62-69,72-94,123-146` valida cada IP, faz pin do IP aprovado no `httpsRequest.lookup` e rejeita redirecionamento sem o seguir. `fetchPinnedHttpsForControlledTest` comprova socket TLS real para IP controlado. Workflow News Core `43707365286` PASS. | Nao houve experimento com zona DNS publica mutavel/controlo externo, que e hardening adicional; o criterio canonico **nao exige** tal infraestrutura nem segunda consulta DNS quando a implementacao elimina a segunda resolucao por pinning. |
| **N0-T28** — `Conflito de relogio do fornecedor`: flag sem falsificar `asKnownAt` | **PASS (ambito canonico)** | `n0ConsolidatedRemaining.test.ts:90-100` em PG17: `publishedAt=2099` produz `SOURCE_CLOCK_CONFLICT`, data passada nao produz falso conflito, `asKnownAt >= ingestedAt` e uma consulta PIT anterior ao conhecimento devolve zero. `postgresStore.ts` atribui `ingested_at/as_known_at` pela fronteira duravel `news_core.seal_visibility_frontier`, nao pelo timestamp alegado na noticia. Job News Core `43707365286`, `N0_CONSOLIDATED_PROOF ... T28=PARTIAL_PASS ... asKnownAtPIT=verified` (rotulo historico do log, reavaliado aqui conforme criterio canonico). | Nao ha medicao NTP externa nem certificacao de deriva do relogio fisico. O PR #90 §3 aceita tempo emitido pelo servico de ingestao **ou** por autoridade definida; nao exige NTP externo como condicao de T28. |

A protecao SSRF pode ser reforcada com mais cenarios de DNS mutavel, e o relogio pode ser monitorizado contra uma autoridade externa, mas **esses trabalhos nao devem ser confundidos com criterios de aceitacao adicionais** nem bloqueiam T18/T28 no ambito explicitamente escrito no N0.

### Fecho dirigido N0-T15 — 2026-11-15

O workflow News Core `43710279989` (job `132800125135`) no SHA
`0f6fbb2a203c0544b507f6ff6e6ea8620b726ba6` executou `test:news:n5:live` em
PostgreSQL 17 real com recolha SEC oficial. A prova `N0-T15` executou ambas as
direcoes: cada CIK foi processado por um worker separado, o worker bloqueado
foi terminado pelo grupo de processos com `SIGKILL`, o owner e a execução
permaneceram `RUNNING` até a expiração natural, e um PID distinto recuperou a
partição sem reset administrativo do lease. Os checkpoints permaneceram
independentes e o replay confirmou uma publicação por accession, sem
duplicações. O mesmo workflow também manteve T26 verde.

### Fecho dirigido N0-T20 e N0-T27 — 2026-11-15

O workflow News Core `43726149171` (job `132848394075`) no SHA
`691030ae34ad883f3d2f7cb90570060e5d1a458d` executou ambos os ensaios em
PostgreSQL 17 real. T20 usou duas identidades LOGIN não administrativas,
claims autenticados no servidor e RLS: cada conta observou apenas a sua linha,
uma leitura cruzada devolveu zero linhas e o namespace News permaneceu global,
sem encaminhar dados privados. T27 recolheu uma resposta SEC oficial com hash
`d7c4a3c888fe60da97ceef8f9b80da4c205e82440c1bc3ba9dcc7316a482a6b1`, ingeriu
um filing inicial, atravessou uma indisponibilidade real do adaptador, manteve
o checkpoint e recuperou 147 accession por backoff natural, sem reset
administrativo ou duplicações.

### Fecho dirigido N0-T21 — 2026-11-15

O workflow News Core `43726566145` (job `132849672293`) no SHA
`737bb5d7f` executou `consumerContracts.test.ts` sem skips. A mesma versão
`news-consumer-v1` foi validada para Investing e Trading, com payload
consumer-neutral e sem campos de conta, carteira, ordem ou valuation. O teste
não cria um motor Trading nem afirma integração operacional; prova apenas o
contrato versionado e a ausência de dependências reversas exigidos pelo N0.

**Estado normativo vigente desta auditoria: 35 PASS / 3 NOT_PROVEN / 0 FAIL.** Pendentes: **T03, T33 e N0-AUT-001**. T33 permanece pendente porque o Market Core real existe apenas na branch remota `feat/r3-g1-universal-market-contract-20261102` e não está integrado no HEAD deste PR; AUT-001 permanece pendente sem observação contínua no ambiente de destino.

### Fecho dirigido N0-T33 — 2026-11-15

O contrato real do Market Core foi inspecionado na branch remota
`feat/r3-g1-universal-market-contract-20261102`, SHA
`b5d727bf2d50731effa4a635de3e811f2f17f1f1`. A ponte News valida
estruturalmente o `DataEnvelope` real, conserva `firstSeenAt <= ingestedAt` e
`asKnownAt <= ingestedAt` no Market, separa essa regra de
`ingestedAt <= asKnownAt` no News e rejeita cutoffs futuros, look-ahead,
revisões incompatíveis e envelopes inválidos. O Market Core não foi importado,
fundido ou modificado.

**Estado normativo vigente desta auditoria: 36 PASS / 2 NOT_PROVEN / 0 FAIL.** Pendentes: **T03 e N0-AUT-001**. AUT-001 permanece pendente sem observação contínua no ambiente de destino; T03 permanece pendente sem 25 publicações editoriais genuínas verificadas e independentes.

**Decisao de release INALTERADA:** `N0_APPROVED=NO`; `NEWS_CORE_PRODUCTION_READY=NO`; PR #102 permanece Draft. A reconciliacao formal do PR #90, T03 e N0-AUT-001 continuam obrigatorios antes de declarar o News Core integralmente fechado.

### Ensaio dirigido N0-T03 — gate de 25 fontes reais

Foi acrescentado `news-core/tests/n0T03EditorialAcceptance.test.ts`. O gate exige um manifesto externo verificável com exatamente 25 publicações distintas sobre o mesmo `eventId`, URLs HTTPS, autoria, datas, proveniência e dependências editoriais classificadas. Não exige 25 publicadores nem 300 relações de independência: essa é a distinção normativa entre T03 e T10. O ensaio passa a exigir apenas que o resultado não seja promovido a `CORROBORATED` sem as provas de independência de T10. Sem manifesto real, termina explicitamente como `SKIP` (`N0_T03_MANIFEST_REQUIRED`) e não promove o critério. A execução realizada neste SHA teve `pass=0`, `fail=0`, `skipped=1`; portanto T03 permanece `NOT_PROVEN`.

### Estado autoritativo após o ensaio cross-branch T33

O ensaio `marketCrossBranchN0.test.ts` carrega o validador real do Market Core
na branch `feat/r3-g1-universal-market-contract-20261102` e comprova
interoperabilidade estrutural, semântica temporal separada e rejeição de
payloads incompatíveis. Não comprova, porém, uma junção PIT de dados Market/News
nem integração operacional no mesmo circuito. Portanto, **T33 permanece
NOT_PROVEN**.

Estado autoritativo: **35 PASS / 3 NOT_PROVEN / 0 FAIL**. Pendentes: **T03,
T33 e N0-AUT-001**.

### Estado autoritativo após T33 PIT conjunto — 2026-11-15

O teste `marketNewsPitIntegrationN0.test.ts` executou em PostgreSQL 17 uma
consulta conjunta read-only usando `market_core.read_market_pit` do Market Core
real e `news_core.read_fact_revisions_as_of` do News Core, com o mesmo cutoff.
Revisões antigas foram devolvidas antes do cutoff e as revisões futuras apenas
depois da sua disponibilidade; payloads incompatíveis e look-ahead foram
rejeitados, mantendo `DataEnvelope` e `NewsEnvelope` separados.

Prova CI: run `43743856926`, job `132902720944`, SHA
`4953d0e5c55dfa760be66b3f81b6c3c8a26537ce`:
`N0_T33_JOINT_PIT_PROOF pg17=true ... lookaheadRejected=true contractsSeparate=true`.

**T33 passa no âmbito PG17 isolado e persistido.** Estado normativo atual:
**36 PASS / 2 NOT_PROVEN / 0 FAIL**. Pendentes: **T03 e N0-AUT-001**.

### Ensaio operacional prolongado N0-AUT-001 — 2026-11-15

O ensaio prolongado não foi iniciado: o ambiente partilhado não fornece
PostgreSQL 17, Docker, `NEWS_DATABASE_URL`/`TEST_DATABASE_URL` nem credenciais
segregadas de teste. Os runners CI existentes são efémeros e os seus containers
PG17 terminam com o job; não constituem um destino persistente para provar
execução contínua prolongada. AUT-001 permanece `NOT_PROVEN` até existir um
alvo isolado persistente, sem custo adicional, com retenção de logs e métricas
durante a duração normativa.
