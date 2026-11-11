# SYNTRAKE News Intelligence Core — revisão crítica do N0

**Data:** 2026-11-11  
**Objeto:** PR #89, `docs/news/N0_CANONICAL_SPEC.md`  
**Base inspecionada:** `main` @ `47f68c2515611c8b5b458a19a31f232ab4b35383`  
**Tipo:** revisão cruzada independente do texto contra `main` e o head do PR, executada nesta branch. **Não equivale a aprovação formal por um revisor humano distinto.**

## Evidência diretamente verificada

- `market-data-core/contracts.ts`: `validateEnvelope` rejeita `asKnownAt > ingestedAt` e `publishedAt > ingestedAt`, conforme semântica de dados de mercado.
- `market-data-core/identity.ts`: `instrumentIdentity()` fornece apenas descrição; `canonicalIdentity()` exige ids de instrumento/listing do registo; `resolveProviderAlias()` distingue EXACT/AMBIGUOUS/UNRESOLVED/REVIEW_REQUIRED.
- `market-data-core/consumerMarketService.ts`: consumidores INVESTING/TRADING são separados do serviço de mercado, com pedidos verificados no servidor.
- `market-data-core/dynamicMarketGateway.ts`: leitura sob pedido, com cache curto; não constitui arquivo de publicações e revisões históricas.
- `docs/market-data/PERSONAL_RELEASE_READINESS.md`: funcionamento on-demand; armazenamento persistente de dados de mercado desativado; infraestrutura sem cron dependente de sessão não implementada no Market Core em `main`.
- PR #89, antes desta revisão: nenhum review ou thread de revisão registado. Não interpretar ausência de comentários como aprovação.

## Achados e correções incorporadas

| ID | Prioridade | Achado | Resolução no documento canónico |
|---|---|---|---|
| A-01 | BLOCKER | Incompatibilidade real de `asKnownAt` entre Market Core e News Core | `NewsEnvelope` separado; ponte explícita e teste N0-T33; nenhum código de mercado alterado |
| A-02 | HIGH | Dois agregadores podiam ocultar a proveniência de uma mesma publicação | `NewsProviderObservation` independente; distinção publicador/origem/fornecedor; N0-T34 |
| A-03 | BLOCKER | Um evento derivado podia parecer conhecido antes da evidência | `asKnownAt(derivado) >= max(asKnownAt(dependências))`; N0-T35 |
| A-04 | HIGH | Recuperação após crash não definia corretamente quando avançar o checkpoint | `at-least-once`, gravação idempotente e checkpoint após commit durável; N0-T36 |
| A-05 | MEDIUM | Aceitação de recolha 24/7 dependia de publicação nova durante uma janela aleatória | Dois polls reais e ingestão controlada de publicação genuína verificável; N0-T25 |
| A-06 | MEDIUM | Cursor/cutoff e fronteiras runtime da API insuficientemente concretos | `NewsEnvelope`, validação runtime, cursor verificável, limites 1–100, cutoff não futuro; N0-T37 |

**Estado dos achados:** seis correções incorporadas na especificação. Estes estados significam apenas **correção documental proposta**, não provas de implementação. Zero testes de integração foram executados.

## Reavaliação das invariantes

| Critério | Estado documental |
|---|---|
| Sem dependência de utilizadores ligados, N0-AUT-001 obrigatório | Conforme |
| Identidade conservadora: ticker não equivale a issuer/listing | Conforme |
| Publicação, observação e evento são objetos diferentes | Conforme |
| PIT aplica-se a publicações, evidências, classificações, links e fusões | Conforme após A-03 |
| Falhas e recuperação não geram falsos eventos nem perdas silenciosas | Contrato definido; prova operacional pendente |
| API consumer-neutral e sem dependência direta de fornecedores em Investing/Trading | Conforme |
| Segurança de fontes externas, SSRF e conteúdo hostil | Contrato definido; prova operacional pendente |
| Matrizes de teste com IDs únicos N0-T01..T37 | Verificação estrutural PASS (37 IDs) |
| PR com aprovação de outro revisor | **PENDENTE** |

## Achados da revisão cruzada de 2026-11-11

| ID | Prioridade | Evidência | Bloqueio e correção |
|---|---|---|---|
| X-01 | BLOCKER | `market-data-core/contracts.ts:315-324` valida `asKnownAt <= ingestedAt`; a especificação News Core exige `ingestedAt <= asKnownAt` | O risco de reutilização indevida estava identificado, mas faltava tornar a ponte temporal executável. A especificação agora exige `NewsEnvelope` separado, regras de `publishedAt`/`servedAt` e teste de rejeição de `asOf` futuro. Market Core não foi alterado. |
| X-02 | BLOCKER | A matriz N0-T01..N0-T37 era apenas texto; não havia artefacto que definisse fixture, observação ou resultado por ID | Sem isso, “37 testes” podia ser confundido com 37 testes executados. A especificação agora exige ligação de cada ID a teste/ensaio reproduzível e separação entre fixture, fonte real e operação. |
| X-03 | BLOCKER | O texto dizia “gravações e checkpoints transacionais”, mas não fixava o ponto de commit nem as chaves de idempotência | A especificação agora define a unidade transacional, o comportamento antes/depois do commit e as constraints lógicas mínimas para recuperação após crash e concorrência. |
| X-04 | HIGH | “isolamento de contas” não definia se watchlists privadas eram enviadas à fonte nem como se separavam de vigilância global | A especificação agora exige escopo `accountId` autorizado no servidor e proíbe enviar inventários/watchlists privadas ao fornecedor. |
| X-05 | MEDIUM | `publishedAt` e `servedAt` estavam nomeados, mas não havia regra explícita para relógios externos ou cutoff futuro | A especificação agora conserva relógios incoerentes apenas com flag, não os usa para PIT, e rejeita `asOf` posterior a `servedAt`. |

### Verificação objetiva dos 37 critérios

Foi contado um conjunto contínuo `N0-T01` a `N0-T37` no documento. Esta contagem é uma verificação estrutural da matriz, não uma execução: não existem ainda adaptador, armazenamento News Core, scheduler, fixtures ou testes N0 no PR 89. Portanto, o estado correto continua a ser `N0_REVIEW_READY`, não `N0_APPROVED` nem N1 funcional.

## Questões que não bloqueiam a especificação, mas bloqueiam a entrega operacional

- Seleção e provisionamento do executor/scheduler sem sessão, com durabilidade e mecanismos de reinício (N1).
- Escolha e validação de esquemas SQL e migrações em ambiente de testes; nenhuma alteração remota autorizada aqui (N1).
- Ensaios reais por fornecedor; não alegar cobertura geográfica ou latência sem medições (N1–N4).
- Provas de ingestão real, PIT, deduplicação, isolamento multiutilizador, recuperação e operação contínua (N1–N5).
- Qualquer ponte para o registry/resolver dos antigos branches Draft exige confirmação do contrato no commit integrado efetivamente usado.

## Gate

**Revisão crítica técnica do conteúdo:** concluída, com correções incorporadas nesta branch.  
**Auditoria formal por terceiro:** **NÃO concluída** — PR sem revisão registada de um revisor distinto.  
**N0:** `N0_REVIEW_READY`, nunca `N0_APPROVED` só por existir documentação.  
**N1:** não implementado.  
**Merge/produção:** não executados.

Checklist para revisor independente:

- [ ] Validar especialmente A-01/A-03 e semântica `asKnownAt`.
- [ ] Validar idempotência, checkpoint, fonte/publicador e reconciliação de observações.
- [ ] Confirmar N0-AUT-001 como requisito obrigatório, exequível sem sessão.
- [ ] Confirmar ausência de dependência de contratos Draft.
- [ ] Emitir aprovação com identidade própria ou apontar bloqueios concretos.
