# News Core — Production Readiness Gate

## Estado consolidado de aceitação — 2026-11-15 (prevalece sobre snapshots históricos)

Fonte normativa: PR #90, SHA `a358cf9cc3e0427cefc18b02f6c3c653b2a61e7b`. A evidência acumulada no PR #102 até ao SHA `a22a4938fa5b94ba3959660008af9c937be90ed6` regista **37 PASS / 1 NOT_PROVEN / 0 FAIL** para N0-T01..T37 e N0-AUT-001. T03, T15, T20, T21, T27 e T33 estão PASS apenas no âmbito explicitamente demonstrado pelos respetivos ensaios. T03 executou 25 publicações editoriais distintas, sem atribuir independência editorial não comprovada; o workflow News Core incluiu o manifesto e não permitiu SKIP. Oito workflows no HEAD citado concluíram com sucesso. **N0-AUT-001 continua NOT_PROVEN**: não existe evidência de operação autónoma contínua no ambiente persistente de destino, incluindo supervisão, recuperação e retenção de evidências pelo período normativo. Revisão independente e compatibilidade do destino continuam condicionantes de release. **N0_APPROVED=NO; NEWS_CORE_PRODUCTION_READY=NO.** Não inferir produção a partir de PG17 efémero ou CI verde.

As tabelas e notas anteriores abaixo são snapshots históricos, conservados para rastreabilidade; não constituem o estado vigente. Esta atualização é apenas documental, sem execução de migrações, deploy ou alteração de motores.


Base de auditoria: PR #101, SHA `65d4337820d735c08c023ee0dba46e4218539323`.
Fonte normativa: PR #90, SHA `a358cf9cc3e0427cefc18b02f6c3c653b2a61e7b`, estado `N0_REVIEW_READY`.

Este documento é um gate de readiness, não uma aprovação de produção. Não altera os contratos N1–N5 nem converte provas de fixtures em provas operacionais.

| Bloco | Resultado | Prova disponível | Bloqueio concreto |
|---|---|---|---|
| 1. factual writer | INDEPENDENT_REVIEW_PENDING | migration `20261112170000_news_core_n3c_factual_writer_boundary.sql` revoga DML/selagem e expõe apenas as funções protegidas; `securityBoundaryN4.test.ts` tenta DML, selagem e confirmação forjada sob LOGIN não administrativa | confirmações `PRIMARY_CONFIRMED`/`CORROBORATED` ficam fail-closed até existir atestação server-side; a auditoria independente do bloco ainda é necessária |
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

## Prova executada do Bloco 1

No SHA `d1afbf597b08931a6176c1a7d6f9722f1fa63c3c`, o workflow `news-core` run `43297781529` terminou `success` em PostgreSQL 17. Foram executados sem skips: N1/N2 PG17, N3-C, N3-D, N4 security, N4 PG17/live SEC, N5 unitário/PG17/live SEC, TypeScript e lint. Os workflows `investing-core` `43297781677`, `investing-release-readonly-pg17` `43297781449` e `investing-r0a-quality-gates` `43297781406` também terminaram `success`.

As provas adversariais observadas no log PG17 incluem `permission denied` para INSERT factual e `finalize_fact_revision`, e `NEWS_FACT_CONFIRMATION_REQUIRES_ATTESTED_SERVER_RECEIPT` para uma tentativa `PRIMARY_CONFIRMED` forjada. Isto comprova o comportamento do gate no CI, mas não substitui a auditoria independente nem autoriza produção.

## Estado de release revalidado — 2026-11-15 (HEAD do PR #102)

Esta secção prevalece sobre a tabela inicial deste documento, que representa o estado histórico do Bloco 1 e **não** o estado atual dos Blocos 2–5. A matriz normativa atual é `docs/news/N0_ACCEPTANCE_TRACEABILITY.md` e o PR #90 continua a ser a fonte de requisitos; a revisão formal independente permanece por concluir.

- **36 PASS / 2 NOT_PROVEN / 0 FAIL** na auditoria N0 mais recente. Pendentes: **N0-T03, N0-AUT-001**.
- **N0-T18 PASS no âmbito canónico**: IP validado ligado ao socket TLS, sem segunda resolução DNS no transporte e com rejeição de redirects; não depende de uma zona DNS pública mutável.
- **N0-T28 PASS no âmbito canónico**: `SOURCE_CLOCK_CONFLICT` para fonte futura, ausência de falso conflito para fonte passada e fronteira PIT independente do relógio da publicação; não depende de NTP externo.
- **N0-T15 PASS no âmbito do rehearsal PG17/SEC live**: CIK Apple/Microsoft, processos independentes, `SIGKILL` em ambos os sentidos, recuperação por lease natural, checkpoints isolados e deduplicação; prova no workflow News Core `43710279989`, SHA `0f6fbb2a203c0544b507f6ff6e6ea8620b726ba6`.
- **HEAD de verificação**: `2c213f3b85663a471eb2be774cb03a06ddd649eb`, todos os oito workflows associados concluídos com `success`, incluindo `news-core` run `43711137775`. Verde em CI **não** equivale a aprovação dos seis requisitos ainda pendentes.
- **T27 permanece NOT_PROVEN**: o ensaio consolidado recupera um lote genuíno após indisponibilidade simulada, mas não demonstra um intervalo histórico real em que publicações novas surgiram e foram integralmente recuperadas, inclusive além da janela `filings.recent` da SEC. Não usar `BACKFILL_LOCAL` como prova de backfill histórico integral.
- **AUT-001 permanece NOT_PROVEN**: supervisão, restart e recovery local não substituem observação 24/7 no ambiente de destino. Sem deploy, migrações remotas ou custos autorizados, não existe prova operacional do destino.
- **N0-T20 PASS no âmbito PG17**: o workflow `43726149171`, job `132848394075`, isolou duas identidades LOGIN autenticadas com RLS server-side e confirmou que o namespace global News não encaminha dados privados.
- **N0-T27 PASS no âmbito PG17/SEC live**: o mesmo job confirmou uma lacuna oficial, indisponibilidade, backoff natural, checkpoint estável e backfill idempotente de 147 accession, sem reset administrativo.
- **N0-T21 PASS no âmbito contratual**: `news-consumer-v1` fornece a mesma fronteira consumer-neutral a Investing e Trading, sem implementar Trading nem criar dependências reversas.
- **N0-T33 PASS no âmbito contratual**: ponte read-only validada contra o `DataEnvelope` real do Market Core remoto, mantendo semânticas temporais independentes e sem alterar o Market.

**Decisão:** `N0_APPROVED=NO`, `NEWS_CORE_PRODUCTION_READY=NO`, PR #102 Draft. Não fazer merge, deploy ou migrações remotas com base apenas nos workflows verdes.

Estado autoritativo após o ensaio cross-branch: **35 PASS / 3 NOT_PROVEN / 0
FAIL**. T33 tem interoperabilidade estrutural comprovada contra o validador
Market remoto, mas continua `NOT_PROVEN` quanto à integração PIT operacional;
os restantes pendentes são T03 e N0-AUT-001.

Atualização posterior: o run `43743856926` executou a consulta conjunta PIT
Market/News em PostgreSQL 17 persistido, com os leitores reais de ambos os
motores, e comprovou exclusão de revisões futuras no mesmo cutoff. T33 está
`PASS` no âmbito isolado testado. Estado atual: **36 PASS / 2 NOT_PROVEN / 0
FAIL**; pendentes T03 e N0-AUT-001.

O ensaio prolongado AUT-001 não foi iniciado porque o ambiente atual não tem
PostgreSQL 17, Docker, URLs de base de dados ou credenciais segregadas. CI
fornece apenas runners e bases efémeras; isso não prova autonomia contínua no
destino.
