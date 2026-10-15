# Auditoria Tecnica Syntrake

Data: 2026-07-10

Escopo auditado: workspace local em `signalcore-site`, incluindo `app/`, `lib/`, `components/`, `scripts/`, `supabase/`, `tests/`, `config/`, `docs/` e a pipeline em `.github/`.

Base metodologica:
- Leitura estrutural do repositÃ³rio inteiro.
- Revisao direta de rotas, modulos de runtime, migracoes, scripts e testes.
- Verificacao executavel com `npx vitest run --reporter=dot`, `npm run lint`, `npx tsc --noEmit` e `npm run build`.
- Nenhuma conclusao abaixo depende de contexto externo ao repositÃ³rio.

## Resultado executivo

Conclusao curta: o projeto e real, grande e tecnicamente ambicioso. Nao e um mockup nem um simples site. Ha bastante software de produto, runtime, pesquisa e operacao. Ao mesmo tempo, a base atual ainda nao sustenta uma due diligence positiva para producao institucional nem para investimento sem condicoes fortes.

Veredito:
- Colocar hoje em producao institucional ampla: nao.
- Colocar em producao controlada para um conjunto pequeno de utilizadores, com limites operacionais e sem promessas institucionais de trading/research fully-automated: apenas com condicoes.
- Comprar o software hoje como ativo estrategico: nao, nao ao preco de um sistema maduro.
- Investir na empresa apenas com base no repositorio: nao hoje.

Principais razoes:
- A superficie apresentada como plataforma institucional esta muito acima da maturidade demonstrada em governanca de dados, schema security e boundaries.
- O runtime central esta excessivamente concentrado em ficheiros monoliticos com muitos fallbacks e varios modos de degradacao.
- O build e os testes passam, mas o typecheck do workspace falha em varios testes, o que significa que o estado "verde" nao e semanticamente consistente.
- O "engine v4" esta ligado por defeito, mas existem 15 modulos `stub` na arvore `lib/engine/v4`, o que enfraquece a credibilidade arquitetural dessa geracao.

## Verificacao executada

- `npx vitest run --reporter=dot`: passou.
- `npm run lint`: passou.
- `npm run build`: passou.
- `npx tsc --noEmit`: falhou.

Resumo factual do estado de verificacao:
- Suite de testes: 209 ficheiros de teste, 719 testes totais, 697 passados e 22 skipped.
- Lint e build de producao passam.
- O typecheck falha em multiplos testes, incluindo `tests/paperSignalExecutionContract.test.ts`, `tests/tradingLightScanner.test.ts`, `tests/tradingResearchPaperPromotion.test.ts`, `tests/tradingBacktestRiskOverrides.test.ts` e `tests/tradingRiskFramingEngine.test.ts`.

Leitura institucional deste resultado:
- A equipa investiu claramente em testes.
- A garantia de corretude estatica esta quebrada no workspace atual.
- O comando `verify:ci` depende de `npx tsc --noEmit`, portanto o estado local auditado nao esta consistente com a barra de CI declarada.

## Achados

### SYN-001

Titulo: As tabelas canonicas de investing sao criadas sem RLS nem policies visiveis.

Modulo: Dados / Seguranca / Infraestrutura

Ficheiros afetados:
- `supabase/migrations/20260707190000_create_investing_core_tables.sql`

Descricao:
- A migracao que cria `user_settings`, `plans`, `portfolio_items`, `daily_snapshots`, `journal_entries`, `portfolios` e `portfolio_meta` nao contem `enable row level security` nem `create policy`.

Evidencia:
- `supabase/migrations/20260707190000_create_investing_core_tables.sql:3`
- `supabase/migrations/20260707190000_create_investing_core_tables.sql:43`
- `supabase/migrations/20260707190000_create_investing_core_tables.sql:71`
- `supabase/migrations/20260707190000_create_investing_core_tables.sql:95`
- `supabase/migrations/20260707190000_create_investing_core_tables.sql:123`
- `supabase/migrations/20260707190000_create_investing_core_tables.sql:143`
- `supabase/migrations/20260707190000_create_investing_core_tables.sql:164`

Impacto:
- Se algum acesso nao passar exclusivamente por service role bem guardado, a superficie de exposicao e ownership de dados fica fragil.
- Mesmo quando toda a escrita passa hoje pelo backend, a ausencia de RLS/policies reduz a defesa em profundidade e complica qualquer evolucao para clientes Supabase diretos.

Severidade: Alta

Prioridade: P0

Categoria: Seguranca

Causa provavel:
- Foco na criacao rapida do schema e na compatibilidade de runtime, sem endurecimento completo de acesso.

Risco:
- Exposicao indevida de dados do utilizador e perda de garantias multi-tenant.

Solucao possivel:
- Ativar RLS em todas as tabelas canonicas e definir policies de leitura/escrita por `auth.uid()` ou equivalente backend-only.

Solucao recomendada:
- Tornar RLS + policies explicitamente parte da migracao canonica de investing antes de qualquer rollout serio.

Esforco estimado: Medio

Dependencias:
- Modelo de autenticacao final.
- Decisao sobre que acessos serao client-side vs server-only.

Risco da alteracao: Medio

### SYN-002

Titulo: O endurecimento de RLS no core de trading e incompleto e testado apenas por string matching.

Modulo: Seguranca / Dados

Ficheiros afetados:
- `supabase/migrations/20260701110000_enable_rls_on_trading_core_tables.sql`
- `tests/supabaseCoreRls.test.ts`

Descricao:
- A migracao limita-se a ativar RLS em 5 tabelas. Nao define policies. O teste apenas verifica a presenca textual dos `alter table ... enable row level security`.

Evidencia:
- `supabase/migrations/20260701110000_enable_rls_on_trading_core_tables.sql:1`
- `supabase/migrations/20260701110000_enable_rls_on_trading_core_tables.sql:9`
- `tests/supabaseCoreRls.test.ts:12`
- `tests/supabaseCoreRls.test.ts:20`

Impacto:
- Existe uma narrativa de hardening sem prova de regras efetivas de acesso.
- O teste atual pode passar mesmo que nao exista nenhuma policy util.

Severidade: Alta

Prioridade: P1

Categoria: Seguranca

Causa provavel:
- Hardening incompleto tratado como milestone simbolica.

Risco:
- Falsa sensacao de seguranca no modelo multi-tenant e de auditoria.

Solucao possivel:
- Adicionar policies explicitas e testes SQL/integrais para ler/escrever como user dono, user nao dono e service role.

Solucao recomendada:
- Tratar "RLS enabled" como insuficiente; promover "RLS policy matrix verified" a requisito.

Esforco estimado: Medio

Dependencias:
- Ambiente de teste Supabase controlado.

Risco da alteracao: Medio

### SYN-003

Titulo: O endpoint central `daily-bundle` e um monolito de 6.5k linhas com multiplos dominos e modos de fallback.

Modulo: Arquitetura / Produto / Runtime

Ficheiros afetados:
- `app/api/daily-bundle/route.ts`

Descricao:
- O endpoint mistura autenticacao, portfolio, pricing, risk policy, engine v3, engine v4, trading scanner, entitlements, anti-churn, follow-up, continuity, fallback fatal e projecoes de UI numa unica rota.

Evidencia:
- `app/api/daily-bundle/route.ts` tem 6581 linhas.
- `app/api/daily-bundle/route.ts:1` a `app/api/daily-bundle/route.ts:61` mostram imports de varios subdominios.
- `app/api/daily-bundle/route.ts:145` faz fallback de v4 para v3 com `console.error`.
- `app/api/daily-bundle/route.ts:6126` a `app/api/daily-bundle/route.ts:6903` constroem resposta `fatal_fallback` massiva.

Impacto:
- A rota torna-se single point of architectural failure.
- Pequenas mudancas comportamentais podem criar regressao transversal.
- O custo de entendimento, teste de contrato e isolamento de bugs e elevado.

Severidade: Alta

Prioridade: P0

Categoria: Arquitetura

Causa provavel:
- Crescimento incremental do produto sem extraÃ§Ã£o sistematica de boundaries.

Risco:
- Regressao silenciosa em producao e incapacidade de evoluir o sistema com previsibilidade.

Solucao possivel:
- Separar montagem de contexto, decisao, projecao de resposta, trading overlays e fallback policy em modulos pequenos com contratos tipados.

Solucao recomendada:
- Refatoracao arquitetural faseada, com testes de contrato por camada antes de continuar a expandir a rota.

Esforco estimado: Alto

Dependencias:
- Mapeamento do schema de resposta publico.

Risco da alteracao: Alto

### SYN-004

Titulo: O "engine v4" esta ativado por defeito enquanto a arvore inclui 15 modulos `stub`.

Modulo: Engine / Arquitetura / Credibilidade tecnica

Ficheiros afetados:
- `lib/engine/version.ts`
- `lib/engine/v4/aggression.ts`
- `lib/engine/v4/selector.ts`
- `lib/engine/v4/scoring.ts`
- `lib/engine/v4/proofs/policy.ts`
- `lib/engine/v4/proofs/confirmedMoney.ts`
- `lib/engine/v4/candidates.ts`
- `lib/engine/v4/learning/weights.ts`
- `lib/engine/v4/learning/edgeConfidence.ts`
- `lib/engine/v4/portfolio/leaks.ts`
- `lib/engine/v4/portfolio/construction.ts`
- `lib/engine/v4/risk/caps.ts`
- `lib/engine/v4/risk/drawdown.ts`
- `lib/engine/v4/risk/killSwitch.ts`
- `lib/engine/v4/regime/regime.ts`
- `lib/engine/v4/regime/quality.ts`

Descricao:
- O controlo de versao do engine assume `v4` por defeito. Ao mesmo tempo, a arvore `lib/engine/v4` contem 15 ficheiros com apenas `// stub` e `export {}`.

Evidencia:
- `lib/engine/version.ts:6`
- `lib/engine/version.ts:8`
- `lib/engine/v4/aggression.ts:1`
- Contagem por busca local: 15 ficheiros `// stub` em `lib/engine/v4`.

Impacto:
- A naming surface do sistema vende uma maturidade superior a implementacao real dessa geracao.
- A equipa fica com superficie morta ou placeholder dentro do runtime tree.

Severidade: Alta

Prioridade: P1

Categoria: Arquitetura

Causa provavel:
- Roadmap de engine adiantado na estrutura de pastas antes de consolidar comportamento real.

Risco:
- Confusao interna, falsas assuncÌ§oes de cobertura funcional e de readiness.

Solucao possivel:
- Ou implementar os modulos, ou removelos da arvore produtiva, ou movelos para `experimental/`.

Solucao recomendada:
- Nao chamar `v4-ultra` a um ramo que ainda conserva placeholders vazios no namespace canonico.

Esforco estimado: Medio

Dependencias:
- Decisao de roadmap do engine.

Risco da alteracao: Medio

### SYN-005

Titulo: O workspace atual falha typecheck apesar de testes, lint e build passarem.

Modulo: Codigo / CI-CD / Qualidade

Ficheiros afetados:
- `tests/paperSignalExecutionContract.test.ts`
- `tests/tradingLightScanner.test.ts`
- `tests/tradingResearchPaperPromotion.test.ts`
- `tests/tradingBacktestRiskOverrides.test.ts`
- `tests/tradingRiskFramingEngine.test.ts`

Descricao:
- O comando `npx tsc --noEmit` falha com incompatibilidades de tipos entre contratos de mercado, snapshots e playbook rules.

Evidencia:
- Execucao local de `npx tsc --noEmit` falhou.
- Erros reportados incluem falta de `marketType` e `sessionProfile` em snapshots e objetos parciais invalidos para `TradingPlaybookRules`.

Impacto:
- A baseline de qualidade declarada em `package.json` e em CI nao representa um estado limpo do workspace.
- Refactors seguros ficam mais caros porque o compilador ja nao e fonte confiavel de verdade.

Severidade: Alta

Prioridade: P0

Categoria: CI/CD

Causa provavel:
- Testes e fixtures nao acompanharam mudancas recentes de contratos.

Risco:
- Regressao estrutural escondida por suites que ainda passam em runtime.

Solucao possivel:
- Corrigir imediatamente os testes e fixtures quebrados ate `npx tsc --noEmit` voltar a verde.

Solucao recomendada:
- Tratar o typecheck vermelho como release blocker.

Esforco estimado: Baixo a Medio

Dependencias:
- Ajuste dos contratos `ComposeTradingLiveDecisionInput` e `TradingPlaybookRules` nos testes.

Risco da alteracao: Baixo

### SYN-006

Titulo: A CI permite passar sem smoke, audits de trading, audits de investing e billing audit quando faltam segredos.

Modulo: CI-CD / Operacoes

Ficheiros afetados:
- `.github/workflows/ci.yml`

Descricao:
- Varias etapas criticas fazem `exit 0` quando as credenciais ou URLs de QA nao estao configuradas.

Evidencia:
- `.github/workflows/ci.yml:41`
- `.github/workflows/ci.yml:45`
- `.github/workflows/ci.yml:59`
- `.github/workflows/ci.yml:76`
- `.github/workflows/ci.yml:89`

Impacto:
- Um pipeline "verde" pode significar apenas que as verificacoes mais caras foram ignoradas.
- O estado de deploy readiness fica dependente de configuracao externa e nao de uma policy obrigatoria.

Severidade: Media

Prioridade: P1

Categoria: CI/CD

Causa provavel:
- Tentativa de manter CI utilizavel mesmo sem ambiente QA completo.

Risco:
- Regressao chegar a producao sem deteccao.

Solucao possivel:
- Separar checks obrigatorios e checks informativos.

Solucao recomendada:
- Tornar pelo menos um smoke autenticado e um audit funcional obrigatorios no branch principal.

Esforco estimado: Medio

Dependencias:
- Ambiente QA estavel e segredos provisionados.

Risco da alteracao: Baixo

### SYN-007

Titulo: O repositorio normaliza persistencia por service role no backend, mas compensa inconsistencias de schema com fallbacks e retries permissivos.

Modulo: Dados / Backend / Arquitetura

Ficheiros afetados:
- `lib/signalcore/supabaseRepo.ts`
- `lib/broker/store.ts`

Descricao:
- O codigo tenta operar sobre schemas variaveis e incompletos, reduz payloads quando colunas faltam e cria dados default para evitar que a UI bloqueie.

Evidencia:
- `lib/signalcore/supabaseRepo.ts:105` a `lib/signalcore/supabaseRepo.ts:108`
- `lib/signalcore/supabaseRepo.ts:137` a `lib/signalcore/supabaseRepo.ts:189`
- `lib/broker/store.ts:18` a `lib/broker/store.ts:26`
- `lib/broker/store.ts:85` a `lib/broker/store.ts:92`
- `lib/broker/store.ts:162` a `lib/broker/store.ts:190`

Impacto:
- O sistema privilegia continuidade de UX sobre canonicidade de dados.
- O backend aceita implicitamente schemas divergentes em vez de falhar cedo.

Severidade: Alta

Prioridade: P1

Categoria: Dados

Causa provavel:
- Compatibilidade retroativa e pressao para manter o app sempre "utilizavel".

Risco:
- Corrupcao semantica de dados, defaults silenciosos e dificuldade de auditoria.

Solucao possivel:
- Declarar um schema unico e falhar em caso de drift.

Solucao recomendada:
- Eliminar retries "schema-proof" no caminho canonico e mover compatibilidade para migracoes explicitas.

Esforco estimado: Medio

Dependencias:
- MigraÃ§Ãµes corretivas e inventario de dados existentes.

Risco da alteracao: Medio

### SYN-008

Titulo: O sistema cria plano default automaticamente para evitar friccao de UI, sacrificando verdade de produto.

Modulo: Produto / Dados / Arquitetura

Ficheiros afetados:
- `lib/signalcore/supabaseRepo.ts`

Descricao:
- Quando nao existe plano, o backend cria automaticamente um plano `auto-default` com target, risk profile e horizon predefinidos.

Evidencia:
- `lib/signalcore/supabaseRepo.ts:137`
- `lib/signalcore/supabaseRepo.ts:164`
- `lib/signalcore/supabaseRepo.ts:181`

Impacto:
- O sistema passa a representar configuracao sintetica como se fosse intencao do utilizador.
- Fica mais dificil distinguir setup real de setup fabricado para satisfazer o frontend.

Severidade: Media

Prioridade: P1

Categoria: Produto

Causa provavel:
- Decisao de produto para nunca mostrar "activate a plan first".

Risco:
- Guidance, analytics e decisiones baseadas em dados default nao assumidos pelo utilizador.

Solucao possivel:
- Manter estado "incomplete" explicito com UX propria.

Solucao recomendada:
- Nao escrever plano default canonico sem acao explicita do utilizador.

Esforco estimado: Medio

Dependencias:
- Ajustes na UX de onboarding e daily bundle.

Risco da alteracao: Medio

### SYN-009

Titulo: O armazenamento de broker connection admite fallback em memoria e engole falhas de persistencia/audit trail.

Modulo: Broker / Observabilidade / Dados

Ficheiros afetados:
- `lib/broker/store.ts`

Descricao:
- O fluxo escreve primeiro em memoria, tenta persistir depois e engole varias falhas como `non-blocking`, retornando por vezes estado `memory`.

Evidencia:
- `lib/broker/store.ts:14`
- `lib/broker/store.ts:53`
- `lib/broker/store.ts:148`
- `lib/broker/store.ts:164`
- `lib/broker/store.ts:171`
- `lib/broker/store.ts:181`
- `lib/broker/store.ts:190`

Impacto:
- O utilizador pode acreditar que ligou broker/persistiu estado quando o canonical store falhou.
- O trilho de auditoria pode nao existir.

Severidade: Alta

Prioridade: P1

Categoria: Observabilidade

Causa provavel:
- Priorizacao de resiliencia percebida e demo continuity.

Risco:
- Perda de estado, troubleshooting dificil e comportamento divergente entre sessoes.

Solucao possivel:
- Tornar o canonical store obrigatorio para eventos de ligacao/desligacao.

Solucao recomendada:
- Permitir memoria apenas para ambiente de desenvolvimento explicitamente identificado e visivel ao utilizador.

Esforco estimado: Medio

Dependencias:
- Caminho estavel de persistencia em Supabase.

Risco da alteracao: Medio

### SYN-010

Titulo: O bypass de QA em desenvolvimento e muito permissivo.

Modulo: Seguranca / DevEx

Ficheiros afetados:
- `lib/auth/localQaAuth.ts`
- `lib/auth/requestUser.ts`

Descricao:
- Em `NODE_ENV !== production`, um header, cookie ou query string especifica basta para assumir o utilizador `qa-local-syntrake-user`.

Evidencia:
- `lib/auth/localQaAuth.ts:10`
- `lib/auth/localQaAuth.ts:18`
- `lib/auth/localQaAuth.ts:21`
- `lib/auth/localQaAuth.ts:24`
- `lib/auth/localQaAuth.ts:29`
- `lib/auth/requestUser.ts:4`
- `lib/auth/requestUser.ts:6`

Impacto:
- Facilita auditoria manual e QA local, mas reduz realismo dos ambientes de desenvolvimento partilhados.

Severidade: Media

Prioridade: P2

Categoria: Seguranca

Causa provavel:
- Necessidade de QA rapido em localhost.

Risco:
- Testes manuais em ambientes nao totalmente isolados podem mascarar defeitos de auth.

Solucao possivel:
- Exigir secret local de QA, host restrito e expor visualmente o modo bypass.

Solucao recomendada:
- Manter apenas em localhost com secret efemero e logging explicito.

Esforco estimado: Baixo

Dependencias:
- Ajuste do fluxo interno de QA.

Risco da alteracao: Baixo

### SYN-011

Titulo: Existem sinais de problemas de encoding e saneamento textual no frontend.

Modulo: Frontend / Qualidade

Ficheiros afetados:
- `components/daily/MarketPulse.tsx`
- `app/app/tabs/AutonomyTab.tsx`
- `lib/signalcore/supabaseRepo.ts`
- `app/api/daily-bundle/route.ts`

Descricao:
- O frontend contem funcoes para corrigir texto mojibake (`Ãƒ`, `Ã¢`, etc.), e varios comentarios/strings no codigo mostram corrupcao de encoding.

Evidencia:
- `components/daily/MarketPulse.tsx:24` a `components/daily/MarketPulse.tsx:37`
- `app/app/tabs/AutonomyTab.tsx:327` a `app/app/tabs/AutonomyTab.tsx:336`
- `lib/signalcore/supabaseRepo.ts:139`

Impacto:
- A presentacao textual depende de remendos em vez de pipeline de encoding correcto.
- Isto degrada confianca institucional no produto.

Severidade: Media

Prioridade: P2

Categoria: Codigo

Causa provavel:
- Copia/cola entre fontes com encodings diferentes.

Risco:
- Texto corrompido em UI, relatÃ³rios e logs.

Solucao possivel:
- Corrigir os artefactos na origem e remover sanitizacao ad hoc.

Solucao recomendada:
- Padronizar UTF-8 end-to-end e adicionar teste/lint simples para strings corrompidas.

Esforco estimado: Baixo

Dependencias:
- Revisao de fontes de conteudo.

Risco da alteracao: Baixo

### SYN-012

Titulo: A superficie de UI principal tambem esta concentrada em componentes enormes.

Modulo: Frontend / Arquitetura

Ficheiros afetados:
- `app/app/tabs/TradingTab.tsx`

Descricao:
- `TradingTab.tsx` tem 2141 linhas e agrega rendering, notificacoes, follow list, charts, decision surfaces e orchestration de estado.

Evidencia:
- `app/app/tabs/TradingTab.tsx` tem 2141 linhas.
- `app/app/tabs/TradingTab.tsx:1`

Impacto:
- Acoes pequenas no ecrÃ£ de trading ficam mais arriscadas.
- O custo cognitivo para onboarding e review e alto.

Severidade: Media

Prioridade: P2

Categoria: Frontend

Causa provavel:
- Crescimento de UX por anexacao ao mesmo surface principal.

Risco:
- Regressao visual/funcional e pouca reutilizacao.

Solucao possivel:
- Extrair view models e slices de UI por capacidade.

Solucao recomendada:
- Refatoracao por rail/panel, mantendo tests de snapshot/contract para cada bloco.

Esforco estimado: Medio

Dependencias:
- Definicao de boundaries de UX.

Risco da alteracao: Medio

## Pontos fortes

### STR-001

Ponto forte: O repositÃ³rio tem uma suite de testes grande e diversificada.

Porque e uma boa decisao:
- 209 ficheiros e 719 testes indicam investimento real em regressao automatica.

Que problema resolve:
- Reduz probabilidade de quebrar regras de negocio subtis em trading, investing, portfolio e rotas.

Porque e superior a outras abordagens:
- E superior a confiar apenas em smoke manual ou apenas em build/lint.

### STR-002

Ponto forte: Lint e build de producao passam no estado auditado.

Porque e uma boa decisao:
- Mostra que a base nao esta em colapso mecanico; ha disciplina minima de integracao.

Que problema resolve:
- Evita acumulacao de debt sintatica e de packaging basico.

Porque e superior a outras abordagens:
- Melhor do que um repositorio "ambicioso" que sequer nao compila.

### STR-003

Ponto forte: Existe autenticacao de cron/loop via bearer secret com bloqueio em producao sem segredo.

Porque e uma boa decisao:
- Rotas de automacao como `/api/engine/loop` e `/api/trading/scanner-refresh` nao ficam abertas por acidente em producao.

Que problema resolve:
- Reduz risco de abuso de endpoints de automacao.

Porque e superior a outras abordagens:
- E superior a confiar em obscuridade de URL ou apenas em middleware global.

### STR-004

Ponto forte: Ha uma nocao explicita de fallback safety em trading/live execution.

Porque e uma boa decisao:
- O sistema tenta bloquear execucao quando snapshots open-market estao stale ou ausentes.

Que problema resolve:
- Evita apresentar mercado aberto como "executavel" sem dados frescos.

Porque e superior a outras abordagens:
- E superior a uma UI que continua a emitir sinais mesmo com feed degradado.

### STR-005

Ponto forte: Existe preocupacao concreta com QA pos-deploy e auditorias funcionais.

Porque e uma boa decisao:
- Scripts como `qa:post-deploy`, `qa:trading:prod`, `qa:investing:prod` e `qa:billing:strict` mostram mentalidade de verificacao operacional.

Que problema resolve:
- Introduz uma ponte entre unit tests e comportamento real do produto.

Porque e superior a outras abordagens:
- E superior a parar no teste unitario e assumir que o sistema integrado vai funcionar.

## Areas onde nao ha evidencia suficiente

- Monte Carlo institucionalmente validado com comparacao contra benchmark externo: Sem evidÃªncia suficiente.
- DSR, PBO e White Reality Check implementados com rigor estatistico auditavel de ponta a ponta: Sem evidÃªncia suficiente.
- Disaster recovery testado em ambiente real: Sem evidÃªncia suficiente.
- Backup restore provado por runbook executado com sucesso: Sem evidÃªncia suficiente.
- Custos operacionais de producao com medicao real: Sem evidÃªncia suficiente.
- SLOs/SLIs formais com alerting ligado a on-call: Sem evidÃªncia suficiente.
- Broker sync real contra corretoras live em producao de forma repetivel: Sem evidÃªncia suficiente.
- Governance formal de datasets com versionamento reproduzivel end-to-end fora do staging local: Sem evidÃªncia suficiente.

## Maturidade (0-10)

- Maturidade global: 5/10
- Arquitetura: 4/10
- Trading: 6/10
- Research Lab: 5/10
- Paper Trading: 5/10
- Investing: 5/10
- Infraestrutura: 5/10
- CI/CD: 5/10
- Observabilidade: 4/10
- Seguranca: 4/10
- Produto: 6/10

## ProduÃ§Ã£o

Colocaria este sistema em producao?
- Nao, nao como plataforma institucional ampla nem como stack cuja narrativa comercial dependa de research/trading maturity elevada.

Em que condicoes poderia ir para producao limitada?
- RLS e policies completas nas tabelas canonicas.
- `npx tsc --noEmit` verde.
- Refactor do `daily-bundle` em contratos menores.
- Clarificacao do que e realmente `v4` e remocao dos `stub`.
- Persistencia canonica sem fallbacks silenciosos para eventos criticos.
- CI com pelo menos um caminho de audit funcional obrigatorio.

## Avaliacao da equipa

Nivel tecnico inferido:
- Equipa com capacidade real de produto e boa energia de construcao.
- Nivel medio-alto em execucao pragmatica.
- Nivel ainda abaixo do exigido para chamar ao sistema "institucional" no sentido forte.

Justificacao:
- A equipa demonstra velocidade, abrangencia funcional e cultura de teste.
- Ao mesmo tempo, ha sinais classicos de sobre-extensao: monolitos centrais, compatibilidade permissiva demais, placeholders em namespaces canonicos e endurecimento de seguranca incompleto.

## Roadmap de CTO

30 dias:
- Fechar todos os erros de `npx tsc --noEmit`.
- Ativar RLS/policies nas tabelas canonicas de investing e testar de forma real.
- Congelar novas features de `daily-bundle` e iniciar decomposicao.
- Inventariar todos os `stub` do engine v4 e decidir: implementar, mover para experimental ou remover.

90 dias:
- Separar claramente investing runtime, trading runtime e response projection.
- Eliminar auto-default plan como source of truth silenciosa.
- Remover fallbacks em memoria dos fluxos criticos de broker/persistencia.
- Tornar pelo menos um audit funcional obrigatorio em CI do branch principal.

6 meses:
- Introduzir contratos formais por dominio e testes de integracao por boundary.
- Endurecer observabilidade com SLOs, alerting e runbooks reais.
- Versionar datasets e artefactos de research com provenance verificavel.

12 meses:
- Reavaliar se a stack merece a designacao de plataforma institucional.
- So depois disso considerar execucao mais automatizada, maior exposicao comercial e due diligence de investimento positiva.

## Due Diligence final

Compraria este software?
- Nao no estado atual como ativo maduro.

Investiria nesta empresa?
- Nao hoje com base exclusiva neste repositÃ³rio.

Maiores riscos:
- Fratura entre narrativa de maturidade e maturidade comprovada.
- Dados canonicos e security hardening incompletos.
- Runtime central excessivamente acoplado.
- Fallbacks silenciosos que preservam UX mas degradam verdade operacional.

Maiores vantagens:
- Ha produto real.
- Ha muito mais software aqui do que marketing.
- Existe cultura de teste e alguma disciplina de release.
- A equipa aparenta capacidade para melhorar rapidamente se abrandar expansao e endurecer fundamentos.

Potencial tecnico:
- Bom potencial, mas ainda mais como base de uma futura plataforma do que como plataforma institucional pronta agora.

O que impede investimento hoje:
- Seguranca e governanca de dados insuficientemente demonstradas.
- Type safety quebrada no workspace auditado.
- Arquitetura central demasiado concentrada.
- Namespace v4 com placeholders.

O que teria de ser resolvido antes de um investimento:
- Fecho dos P0/P1 acima.
- Evidencia operacional real de seguranca, persistencia e observabilidade.
- Clarificacao honesta do que ja esta realmente em producao vs o que ainda esta em evolucao.

