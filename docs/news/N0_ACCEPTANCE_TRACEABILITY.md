# N0 — matriz de rastreabilidade dos critérios de aceitação

Esta matriz define como cada critério será provado. `PASS` só pode ser registado quando o teste/ensaio e o artefacto indicado estiverem disponíveis; a presença desta matriz não é execução.

| ID | Teste/ensaio futuro | Fase | Evidência esperada |
|---|---|---|---|
| N0-T01 | `publicationIdempotency.test` | N1 | duas ingestões, uma publicação |
| N0-T02 | `publicationRevision.test` | N2 | duas revisões, anterior preservada |
| N0-T03 | `eventManyToMany.test` | N2 | 25 publicações, um evento justificado |
| N0-T04 | `eventNonMerge.test` | N2 | títulos semelhantes, dois eventos |
| N0-T05 | `identityAmbiguity.test` | N2 | AMBIGUOUS, sem ID inventado |
| N0-T06 | `tickerVenueAmbiguity.test` | N2 | ambiguidade ou resolução segura |
| N0-T07 | `issuerFirstLink.test` | N2 | link ao emissor antes do listing |
| N0-T08 | `etfIndirectExposure.test` | N2 | INDIRECT_EXPOSURE, sem DIRECT |
| N0-T09 | `rumorConfirmation.test` | N2 | confirmação não promovida |
| N0-T10 | `independenceGroup.test` | N2 | republicações, uma fonte independente |
| N0-T11 | `pitLatePublication.test` | N2 | publicação ausente antes de asKnownAt |
| N0-T12 | `pitLateCorrection.test` | N2 | correção só após cutoff |
| N0-T13 | `pitLateIdentityLink.test` | N2 | link ausente antes do cutoff |
| N0-T14 | `pitMergeSplitHistory.test` | N2 | histórico anterior reconstruível |
| N0-T15 | `partitionedIdempotency.test` | N1 | CIK A/B, checkpoints independentes |
| N0-T16 | `providerUnavailable.test` | N1 | erro explícito, zero invenção |
| N0-T17 | `malformedProvider.test` | N1 | payload rejeitado |
| N0-T18 | `ssrfRedirect.test` | N3 | destino privado bloqueado |
| N0-T19 | `hostileContent.test` | N3 | conteúdo não executado |
| N0-T20 | `accountIsolation.test` | N3 | dados privados isolados |
| N0-T21 | `consumerBoundary.test` | N3 | Investing/Trading sem dependência reversa |
| N0-T22 | `pitPagination.test` | N2 | páginas estáveis, sem duplicados/futuro |
| N0-T23 | `evidenceRequired.test` | N2 | classificação sem evidência rejeitada |
| N0-T24 | `atomicRevision.test` | N1 | rollback sem estado parcial |
| N0-T25 | `zeroSessionRealPoll.test` | N1/N4 | dois polls reais e publicação verificável |
| N0-T26 | `crashRecovery.test` | N1 | restart sem duplicação/lacuna |
| N0-T27 | `outageBackfill.test` | N1/N3 | cursor por partição e backfill |
| N0-T28 | `providerClockConflict.test` | N2 | qualityFlag, PIT não falsificado |
| N0-T29 | `concurrentSameItem.test` | N1 | uma revisão lógica |
| N0-T30 | `emptyAvailable.test` | N1 | AVAILABLE com lista vazia |
| N0-T31 | `scheduledVsOccurred.test` | N2 | scheduledFor separado |
| N0-T32 | `derivedDependencyPit.test` | N2 | derivação excluída antes das dependências |
| N0-T33 | `marketNewsEnvelopeBoundary.test` | N0/N1 | validadores incompatíveis, Market intacto |
| N0-T34 | `providerObservationProvenance.test` | N1/N2 | observações separadas |
| N0-T35 | `derivedKnownAt.test` | N2 | derivação não antecede evidência |
| N0-T36 | `checkpointCommitRecovery.test` | N1 | checkpoint só após commit |
| N0-T37 | `signedCursorFutureCutoff.test` | N2 | cursor adulterado/cutoff futuro recusado |

Os ensaios N1/N4 com fonte real devem guardar log sanitizado, timestamp, hash do fixture/resposta e contagem; não devem depender de uma publicação nova durante uma janela aleatória. N0-AUT-001 permanece obrigatório: qualquer implementação deve executar sem sessão, cookie ou utilizador ligado.
