# Investing - Phase 0 Adoption & Trust Audit

Data: 2026-08-10  
Produto: Syntrake  
Repositorio tecnico: `122n4/signalcore` / `signalcore-site`  
Escopo: arquitectura actual, runtime data flow, Supabase/RLS/auth, broker, market data, mocks/fallbacks, auditoria e proposta minima de PR #1.  
Regra de produto: quando a origem, preco, permissao ou proveniencia nao estiverem confirmados, a experiencia deve preferir `Dados indisponíveis neste momento` a numeros financeiros inventados ou silenciosamente estimados.

## 0. Guardrails desta auditoria

Esta fase foi feita como auditoria read-only. Nao foram criadas migracoes, tabelas, modelos, features, reescritas de UI nem alteracoes de dados.

Base de evidencia:

- Codigo local em `app/`, `lib/`, `components/` e `supabase/migrations`.
- Catalogo Supabase live consultado em modo read-only no projecto `qdnvbamoamtkujzwrxdb` (`122n4's Project`, `ACTIVE_HEALTHY`).
- Supabase advisors de seguranca/performance consultados apenas para metadata.
- Nao foi consultado conteudo sensivel de linhas financeiras. O unico agregado de `journal_entries` usado foi volume/periodo/tipo.

## A. Mapa da arquitectura actual

| Dominio / tabelas | Papel actual | Escritores principais | Leitores principais | Fronteira auth | Fonte de verdade | Estado | Risco de migracao |
|---|---|---|---|---|---|---|---|
| `investing_tenants`, `investing_tenant_memberships` | Tenancy e membership live | Live DB / migrations remotas; codigo local parcial | RLS tenant-member, engine/read models remotos | RLS live por membership; server ainda usa muito `user_id` | Canonico live para tenancy | Canonico, mas nao totalmente reflectido no codigo local | Alto |
| `user_settings` | Perfil, setup, `plan_v1`, `investing_ui_state`, broker connection legacy | `/api/investing/plan`, `/api/investing/preferences`, broker store, rotas legacy | Dashboard compact RPC, daily cycle, broker status, legacy UI | Clerk -> server service role; RLS directa ainda existe | Transicional | Activo e compartilhado | Alto |
| `plans` | Plano Investing actual usado pelo runtime | `/api/investing/plan`, `/api/plans` legacy | Dashboard, daily cycle, rotas legacy | Clerk -> service role; RLS directa | Transicional para plano activo | Activo | Alto |
| `portfolio_items`, `portfolios`, `daily_snapshots` | Portfolio/trading/shared legacy e compatibilidade broker | `/api/portfolio*`, `/api/daily*`, `/api/fix-now/run`, broker sync | Tabs trading/shared, legacy APIs | RLS legacy por user/mode | Legacy para Investing; canonico para shared/trading | Nao remover ainda | Alto |
| `journal_entries` | Audit/memoria partilhada e historico UX | Muitas rotas legacy e Investing | Ops, historico, receipts legacy | RLS legacy por user/mode | Audit shared, nao portfolio SoT | Activo: 40,507 entradas, 64 users, 2026-02-14 a 2026-08-10 | Alto |
| `investing_accounts` | Identidade canonica de account paper/simulation/tracking | `/api/investing/accounts`, RPC `investing_open_paper_account_v2` | Dashboard, accounts, daily cycle, broker connections | Service role + filtros `user_id`; RLS live por tenant-member | Canonico Investing | Activo | Critico |
| `investing_cash_balances`, `investing_cash_movements` | Cash current-state e movimentos auditaveis | RPCs cash/fill/open account | Dashboard, daily cycle, reconciliation | Service role RPC validando actor/account | Canonico Investing | Activo | Critico |
| `investing_positions`, `investing_opening_position_imports` | Posicoes actuais e import append-only | Fill/import/split RPCs | Dashboard, daily cycle, account movements | Service role RPC validando actor/account | Canonico Investing | Activo | Critico |
| `investing_orders`, `investing_fills`, `investing_fees` | Lifecycle paper order/fill/fees | Paper order/fill/cancel RPCs | Paper order APIs, dashboard, reconciliation | Service role RPC validando actor/queue/account | Canonico paper execution | Activo | Critico |
| `investing_execution_queue`, `investing_execution_approvals`, `investing_execution_events`, `investing_control_evaluations` | Propostas, approvals, eventos e control checks | Daily cycle, approval, order, live-block RPCs | Dashboard, approvals, ops audit | Service role RPC; owner checks em SQL | Canonico governance/execution | Activo | Critico |
| `investing_ledger_transactions`, `investing_ledger_entries` | Ledger double-entry | Cash/order/fill/split RPCs | Reconciliation, ops | Service role RPC e triggers | Canonico contabilistico | Activo append-only | Critico |
| `investing_reconciliation_runs`, `investing_reconciliation_items`, `investing_reconciliation_resolutions` | Reconciliation paper | Reconcile/resolve RPCs | Ops, paper orders | Service role RPC validando actor/order | Canonico reconciliation | Activo | Alto |
| `investing_daily_cycles`, `investing_mandate_snapshots`, `investing_rebalance_ledger`, `investing_research_snapshots` | Recibos imutaveis do ciclo diario | `investing_record_daily_cycle_v2` | Dashboard, ops | Service role RPC com validacoes payload/user/account | Canonico para ciclo persistido | Activo | Alto |
| `investing_market_snapshots`, `investing_market_snapshot_items` | Evidencia de market data persistida | `investing_record_market_snapshot_v1` | Daily cycle/proveniencia | Service role only; RLS live sem policy | Canonico para evidencia de mercado | Activo/locked | Medio |
| `investing_engine_*` | Engine v1 persistence, artifacts, summaries, reasons, shadow packages, idempotency | Engine persistence services | Replay/audit/internal | Force RLS; triggers; grants mostly service-role/none | Canonico interno engine | Activo, mas cliente nao consome como decisao operacional | Alto |
| `investing_research_*`, readiness/release/onboarding remote-only | Research governance, readiness e rollout live | RPCs/workers remotos | Research/readiness tooling | Tenant-scope e service role; algumas tabelas locked | Canonico live desconhecido | Nao mexer sem auditoria dedicada | Alto |
| `paper_trades`, `paper_trade_runs`, `paper_trade_user_locks` | Paper trading legacy/shared | Trading bot/legacy | Trading surfaces | RLS/policies proprias | Nao e Investing v2 | Separado | Medio |

Conclusao: o repo ja tem um nucleo Investing canonico, mas o runtime cliente ainda usa uma ponte transicional (`user_settings`/`plans` + adapter volatil) e a DB live tem uma camada tenant/research/readiness mais avancada que nao esta totalmente representada no codigo local.

## B. Runtime data-flow map

Fluxo base:

1. Browser chama uma rota `app/api/investing/*`.
2. A rota usa Clerk (`auth()` via `getRequestUserId`) para obter `userId`.
3. A rota usa Supabase service role (`getInvestingSupabaseAdmin`) e filtra por `user_id`/`account_id`/`portfolio_id`.
4. RPCs v2 fazem as validacoes fortes de ownership e estado quando a escrita passa por RPC.
5. O servidor projecta o resultado para `InvestingDashboardSurface`.

Superficies Investing:

| Superficie | Entrada runtime | Tabelas/APIs tocadas | Fonte canonica | Riscos/fallbacks |
|---|---|---|---|---|
| Portfolio | `/api/investing/dashboard` -> `loadInvestingDashboard` -> `read_investing_dashboard_compact_v1` | `investing_accounts`, cash, positions, orders/queue, daily cycles, `plans`, `user_settings`, quotes | Canonico para account/cash/positions; transicional para plan | Se quote falta, usa `cost_basis_fallback`; deve ser `ESTIMATED` ou unavailable |
| Risk | `InvestingDashboardSurface` usa `customerDecision` do dashboard | Mesma resposta do dashboard | Persistido apenas quando vem de daily cycle | Pode vir de `volatile_runtime_adapter`, nao Phase3F |
| Advisor / Research | Mesma resposta do dashboard; tabs Advisor/Research apontam para projections | `investing_research_snapshots` quando ha ciclo; otherwise runtime adapter | Canonico so quando persistido | `labValidation: not_connected`, scorecards unavailable |
| Opportunities | Derivado de alvo, drift, queue/proposta | `investing_execution_queue`, rebalance outputs | Canonico quando proposal persistida | Oportunidades podem ser heuristicas/runtime, exigir provenance label |
| Execution / Autonomy | Daily cycle, approvals, paper orders | `investing_execution_queue`, approvals, orders, events, ledger | Canonico paper execution | Live bloqueado; paper depende de market data fresh |

Tabs legacy (`PortfolioTab`, `RiskTab`, `AdvisorTab`, `OpportunitiesTab`, `ExecutionTab`) continuam no repo para trading/shared, mas o modo Investing em `app/app/ui.tsx` renderiza `InvestingDashboardSurface` para as vistas principais. O risco esta em reutilizacao acidental dessas tabs antigas, nao no caminho principal actual.

## C. Canonico vs legacy

Canonico Investing agora:

- `investing_accounts`
- `investing_cash_balances`, `investing_cash_movements`
- `investing_positions`, `investing_opening_position_imports`
- `investing_orders`, `investing_fills`, `investing_fees`
- `investing_execution_queue`, `investing_execution_approvals`, `investing_execution_events`, `investing_control_evaluations`
- `investing_ledger_transactions`, `investing_ledger_entries`
- `investing_reconciliation_runs/items/resolutions`
- `investing_daily_cycles`, `investing_mandate_snapshots`, `investing_rebalance_ledger`, `investing_research_snapshots`
- `investing_market_snapshots/items`
- `investing_engine_*` para audit/replay interno, ainda nao para decisao cliente operacional.

Transicional:

- `user_settings`: ainda carrega setup, preferencias, UI state e broker state legacy.
- `plans`: ainda e o plano activo lido pelo runtime/daily cycle.
- `investing_reconciliation_ledger`: ledger antigo de reconciliation coexistindo com runs/items/resolutions.

Legacy para Investing, mas ainda activo noutros produtos:

- `portfolio_items`
- `portfolios`
- `daily_snapshots`
- rotas `/api/portfolio*`, `/api/daily*`, `/api/fix-now/run`
- tabs trading/shared.

Desconhecido/nao tocar ainda:

- Tabelas remote-only de research/readiness/release/onboarding e tenant workflow ate haver mapa de writers live e contratos.

## D. Clerk/Supabase auth model

O servidor usa Clerk como identidade de request. `lib/auth/requestUser.ts` devolve `userId` de `auth()`, com bypass local QA controlado por request local. As rotas Investing depois usam service role para ler/escrever Supabase.

Pontos fortes:

- O browser nao recebe service role.
- RPCs v2 importantes recebem `p_actor_user_id` e validam account/order/queue ownership no SQL.
- Live execution e bloqueada por design e gera evento via `investing_record_live_blocked_attempt_v2`.

Gaps:

- Nao ha helper central encontrado como `requireTenantContext` ou `requireAccountAccess`.
- Varias rotas fazem direct query/upsert com service role e filtros ad hoc.
- `portfolioId` vem frequentemente do cliente; quando nao ha `account_id`, a validacao DB e mais fraca.
- DB live ja tem tenant tables/policies, mas o codigo local ainda trata `user_id` como fronteira primaria em muitos caminhos.

Regra recomendada: financial read/write server-side deve exigir `userId + tenantId + accountId/portfolioId` resolvidos no servidor, ou devolver `Dados indisponíveis neste momento`.

## E. Service-role threat analysis

Service role e inevitavel para RPCs internas, mas hoje a superficie e ampla.

Riscos principais:

- Direct writes em `/api/investing/accounts`, `/api/investing/plan` e `/api/investing/preferences` dependem de filtros de rota, nao de uma fronteira unica.
- `/api/investing/dashboard` chama RPC compacta com `p_user_id` e `p_portfolio_id: "primary"`; sem tenant context explicito, o isolamento depende do contrato da RPC e do user id.
- `/api/investing/daily-cycle` valida `portfolioId` sintacticamente e delega ownership ao DB quando ha account. Sem account, ainda pode gravar para um portfolio id arbitrario do proprio user context.
- `/api/ops/investing/approvals` tem nome `/ops`, mas permite GET/POST user-scoped sem owner gate. Pode estar correcto como user approval endpoint, mas a fronteira de produto esta confusa.
- Broker store grava estado completo em `user_settings.broker_connection` e tambem em `journal_entries.details.connection`; isto merece classificacao explicita de segredo/dado sensivel.

Mitigacao minima: encapsular service-role access numa camada de authz/contexto e impedir rotas financeiras de construir queries com IDs livres vindos do cliente sem validacao central.

## F. RLS/policy analysis

Live Supabase:

- Muitas tabelas `investing_*` tem RLS enabled e parte delas tem `FORCE ROW LEVEL SECURITY`.
- Varias tabelas live tem RLS enabled e zero policies. Isto pode ser intencional como service-role-only/locked, mas deve estar documentado: `investing_beta_activation_decisions`, `investing_effective_beta_readiness`, `investing_effective_readiness_revocations`, `investing_market_snapshot_items`, `investing_market_snapshots`, `investing_onboarding_progress`, `investing_release_candidates`, `investing_research_beta_readiness_reports`, `investing_worker_heartbeats`, alem de `research_lab_*`, `setup_status`, `trading_scanner_snapshots`, `user_alerts`.
- Advisor Supabase reportou o lint `rls_enabled_no_policy` para essas tabelas. Remediation: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- `investing_accounts` live tem policy tenant-member (`investing_accounts_select_tenant_member`), diferente da historia local inicial baseada apenas em `user_id`.
- Tabelas legacy (`user_settings`, `daily_snapshots`, `journal_entries`, `portfolio_meta`) tem policies duplicadas/multiplas. Isto e mais performance/higiene que P0, mas aumenta ambiguidade.
- Performance advisor tambem aponta `multiple_permissive_policies` e duplicate indexes em tabelas legacy. Remediation: https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies e https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index

Decisao arquitectural recomendada:

- Para financeiras Investing, assumir server-only + service-role RPC com authz propria como modelo primario.
- So expor leitura directa anon/authenticated se o contrato tenant JWT estiver fechado, testado e documentado.
- Nao misturar RLS client-side e service-role ad hoc para o mesmo dado financeiro sem uma matriz de ownership.

## G. SECURITY DEFINER analysis

Funcoes `SECURITY DEFINER` sao o centro correcto para operacoes atomicas, mas precisam de inventario permanente.

Achados:

- RPCs v2 criticas (`investing_record_daily_cycle_v2`, `investing_record_approval_v2`, `investing_submit_paper_order_v2`, cash/fill/reconcile/split/reverse) estao configuradas live com `search_path=pg_catalog, public`, `anon_execute=false`, `authenticated_execute=false`, `service_role_execute=true`.
- Funcoes engine trigger (`investing_engine_*`) aparecem sem execute para anon/authenticated/service_role, consistente com uso por triggers.
- Versoes antigas como `investing_record_daily_cycle`, `investing_record_approval`, `investing_record_live_blocked_attempt` aparecem sem execute para service_role live, consistente com containment.
- Supabase security advisor apontou duas funcoes `SECURITY DEFINER` executaveis por `authenticated`: `investing_has_scope_permission_v1(...)` e `investing_research_has_exact_scope_v1(...)`. Isto pode ser intencional para policy helpers, mas deve ser explicitamente revisto. Remediation: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- Advisor tambem aponta helper/trigger functions com mutable search path, incluindo `investing_touch_updated_at`, `investing_block_append_only`, `investing_assert_ledger_balanced` e helpers de trading/research. Remediation: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

Validacoes SQL fortes encontradas nas RPCs v2:

- Account ownership por `account_id + user_id + portfolio_id + environment`.
- Bloqueio de `live`.
- Idempotency keys/client request ids.
- Expected status/version para approvals e queue.
- Fresh market data para paper orders.
- Ledger double-entry e reconciliation checks.
- Append-only triggers para ledgers, cycles, engine persistence e market snapshots.

Gap residual: estas garantias so existem quando a rota usa a RPC certa. Direct query/upsert service-role continua a precisar de authz central.

## H. Broker data-flow

Estado actual:

- Broker generico vive em `lib/broker/*`.
- `lib/broker/investingBoundary.ts` bloqueia shared broker sync quando `mode=investing`; `/api/broker/sync` e `/api/broker/reconcile` retornam caminho substituto/410 para Investing.
- `/api/investing/broker/connections` expoe manual tracking/paper/simulation e marca demo/live connector como `connector_required` / `not_available`.
- SnapTrade legacy em `/api/broker/connect` apenas monta redirect/connect URL com `clientUserId`. Nao ha evidencia de fluxo OAuth/state completo, token vault, callback robusto ou normalizacao para `investing_accounts/positions/orders`.
- Memory fallback do broker store so e permitido fora de production ou com `ALLOW_MEMORY_FALLBACK=1`.

Classificacao:

- Manual tracking/paper: SIMULATED/REAL dentro do ambiente paper/simulation, dependendo da origem.
- Demo broker: UNAVAILABLE ate connector real.
- Live broker: UNAVAILABLE e deve continuar bloqueado.
- SnapTrade legacy: LEGACY/INCOMPLETE para Investing.

Risco: `journal_entries` recebe payload de broker connection. Mesmo sanitizado no client, a camada server precisa de regra explicita para nunca armazenar tokens/secrets em `journal_entries` nem em JSON genrico.

## I. Market-data flow

Implementacao actual:

- `lib/market/marketClient.ts` orquestra providers: AlphaVantage, Binance, Coinbase, Finnhub, FMP, Kraken e Twelve Data.
- `ProviderPref` inclui `twelvedata`.
- Auto-order actual: crypto prefere Coinbase/Binance/Kraken antes de Twelve Data; equities preferem Finnhub/FMP/AlphaVantage antes de Twelve Data; forex/metals usam Twelve Data primeiro.
- `lib/market/quotes.ts` tenta quote single-symbol via Twelve Data e cai para candles `auto` se falhar.
- `marketClient` tem cache e last-known-good fallback com `MARKET_DATA_STALE_FALLBACK_MS`.
- Consumidores Investing: dashboard, daily cycle, market snapshot persistence, paper order submit.
- Consumidores legacy/shared: daily bundle, FixNow, broker sync, scanners, research/debug.

Conclusao: Twelve Data nao esta "escondido"; esta implementado e usado, mas nao existe uma interface de dominio formal `MarketDataProvider` isolando Investing do cliente generico de mercado.

Risco de produto: fallback por candles/last-known-good pode produzir valores numericos que parecem actuais. Para Investing, outputs financeiros devem carregar provenance (`REAL`, `STALE`, `ESTIMATED`, `UNAVAILABLE`) e a UI deve preferir `Dados indisponíveis neste momento` quando a cobertura nao e suficiente.

## J. Mock/heuristic inventory

| Area | Origem | Classificacao necessaria | Accao recomendada |
|---|---|---|---|
| `investing_accounts`, cash, positions, orders, fills, ledger | Investing core | REAL dentro de paper/simulation/tracking | Mostrar ambiente claramente |
| Daily customer decision persistido | `investing_daily_cycles` + snapshots | REAL receipt para aquele ambiente | Mostrar timestamp/hash |
| Customer decision sem ciclo persistido | `volatile_runtime_adapter` | ESTIMATED/SIMULATED | Nao apresentar como recomendacao final |
| Valuation sem quote | `cost_basis_fallback` | ESTIMATED | Mostrar unavailable/degraded, nao "market value" |
| Market cache stale/candle fallback | `marketClient`/`quotes.ts` | STALE/ESTIMATED | Bloquear decisoes paper se stale |
| Research lab validation | `labValidation: not_connected` | UNAVAILABLE | Texto de dados indisponiveis |
| Scorecards/research publication vazios | dashboard projection | UNAVAILABLE | Nao preencher com placeholders |
| Demo/live broker | `/api/investing/broker/connections` | UNAVAILABLE | Manter bloqueado |
| Legacy Risk components | `components/risk/*`, `RiskTab` | DEMO/PROXY para trading/shared | Nao reutilizar em Investing |
| LocalStorage starter/fallbacks | `PortfolioTab` legacy | DEMO/LEGACY | Nao deixar entrar na superficie Investing |

Regra operacional: qualquer numero financeiro vindo de fallback deve ser explicitamente rotulado ou suprimido. A frase preferida para lacunas de dados e `Dados indisponíveis neste momento`.

## K. Journal/audit analysis

`journal_entries` nao e uma tabela descartavel.

Metadata live agregada:

- Total: 40,507 entradas.
- Periodo: 2026-02-14 23:26:58 UTC a 2026-08-10 17:47:33 UTC.
- Users distintos: 64.
- Maiores categorias: `trading/engine_event` (30,712), `investing/engine_event` (7,302), `crypto/engine_event` (1,234), `forex/engine_event` (443), `investing/conversion_event` (433).
- Investing tambem contem `manual_execution_state`, `daily_done`, `decision_receipt`, `execution_proof`, `starter_applied` e `fix_now_run`.

Implicacoes:

- `journal_entries` e audit shared e memoria historica. Nao deve ser removida nem migrada sem plano de retencao, PII/secrets review e mapping para eventos canonicos Investing.
- Para Investing novo, `investing_execution_events`, `investing_daily_cycles`, ledgers e engine persistence sao trilhas canonicas mais fortes.
- Journal pode continuar como camada historica/compatibilidade, mas nao deve ser fonte primaria de estado financeiro.

## L. Top production blockers

1. Falta uma fronteira central de authz/tenant/account antes do uso de service role em rotas financeiras.
2. A UI/runtime ainda consegue projectar decisoes ou valores com `volatile_runtime_adapter`, `cost_basis_fallback` ou market fallback sem uma barreira de produto suficientemente dura.
3. A ponte Phase3F/engine v1 para cliente esta explicitamente `unavailable`; o cliente nao deve vender isso como motor final operacional.
4. DB live tem tenancy/readiness/research remotos que o codigo local nao modela totalmente; ha risco de drift entre local migrations e producao.
5. Broker live/demo nao esta implementado end-to-end para Investing; SnapTrade actual e legacy/incompleto para este dominio.
6. Market data nao tem contrato Investing-isolado com provenance/availability obrigatoria.
7. RLS live tem tabelas locked sem policy, policies duplicadas em legacy e duas `SECURITY DEFINER` functions executaveis por `authenticated`; tudo precisa de decisao/documentacao antes de adopcao maior.
8. `journal_entries` tem volume real e multiproduto; qualquer limpeza ou migracao sem inventario de writers quebra auditoria/historico.

## M. Proposta minima de PR #1

Objectivo: reduzir risco de adopcao sem criar novo core, sem migrations e sem reescrever UI.

Escopo proposto:

1. Criar uma camada server-only `lib/investing/server/authz.ts`.
2. Expor helpers pequenos:
   - `requireInvestingUser(req)` -> Clerk user id ou 401.
   - `resolveInvestingTenantContext(userId)` -> tenant/membership live quando disponivel; se ambiguo/ausente, falha fechado para rotas financeiras.
   - `requireInvestingAccountAccess({ userId, tenantId, accountId, portfolioId, environment })` -> confirma account scope via service role antes de qualquer operacao account-bound.
   - `assertInvestingPortfolioScope({ userId, tenantId, portfolioId })` -> para rotas sem account.
3. Refactor minimo das rotas:
   - `/api/investing/dashboard`
   - `/api/investing/accounts`
   - `/api/investing/accounts/[accountId]/movements`
   - `/api/investing/paper/accounts`
   - `/api/investing/paper/accounts/[accountId]/movements`
   - `/api/investing/paper/orders`
   - `/api/investing/paper/orders/[orderId]`
   - `/api/investing/daily-cycle`
   - `/api/investing/plan`
   - `/api/investing/preferences`
   - `/api/investing/broker/connections`
   - `/api/ops/investing/approvals` ou renomear/classificar como user endpoint.
4. Adicionar responses fechadas:
   - 401 quando Clerk falha.
   - 403 quando user nao pertence ao tenant/account.
   - 409/503 com `Dados indisponíveis neste momento` quando a app nao consegue resolver tenant/provenance suficiente.
5. Pequena camada de provenance no dashboard:
   - Se `customerDecisionSource === "volatile_runtime_adapter"`, expor `decisionAvailability: "estimated"`.
   - Se valuation usa `cost_basis_fallback`, expor `priceAvailability: "estimated"` ou `unavailable`.
   - UI nao deve apresentar fallback como valor de mercado real.

Fora do PR #1:

- Novas tabelas/migrations.
- Migracao de `portfolio_items`/`daily_snapshots`/`journal_entries`.
- Broker live/demo.
- Nova engine.
- Reescrita de tabs.
- Alteracoes aos provider internals de market data.

## N. Tabelas/ficheiros a nao tocar ainda

Nao tocar em schema/data:

- Todas as tabelas `investing_*` canonicas sem plano de migracao dedicado.
- `investing_tenants`, `investing_tenant_memberships`.
- Tabelas remote-only de research/readiness/release/onboarding.
- `journal_entries`.
- `portfolio_items`, `portfolios`, `daily_snapshots`, `plans`, `user_settings`.
- `paper_trades`, `paper_trade_runs`, `paper_trade_user_locks`.

Nao tocar em codigo numa primeira PR:

- `lib/investing/engine/**` salvo apenas para leitura/contratos.
- `lib/broker/sync.ts` e conectores broker legacy.
- `lib/market/providers/**` e provider order global.
- Tabs legacy de trading/shared, excepto se houver uma importacao directa no modo Investing.
- Migrations existentes, especialmente as que ja reflectem ambiente live.

## Conclusao

Syntrake ja tem um core Investing serio para paper/simulation: accounts, cash, positions, orders, fills, ledger, reconciliation, execution events, daily cycles e engine persistence. O problema de adopcao nao e falta de tabelas; e fronteira de confianca.

A primeira mudanca deve consolidar authz, tenant/account scope e provenance de dados antes de qualquer expansao. Enquanto isso nao estiver fechado, qualquer numero financeiro estimado, stale ou sem origem deve ser tratado como indisponivel para decisao: `Dados indisponíveis neste momento`.
