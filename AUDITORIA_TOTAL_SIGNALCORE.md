# Auditoria Total - Syntrake

Data: 2026-02-25
Repositorio auditado: `signalcore-site`

Metodologia usada nesta auditoria:
- Leitura estatica do codigo (`app/`, `lib/`)
- Varredura de rotas, chamadas API, tabelas Supabase e `localStorage`
- Verificacao local de qualidade:
- `npm test` -> OK (2 ficheiros / 13 testes)
- `npm run build` -> OK
- `npm run lint` -> OK com 1 warning (helper nao usado em `app/app/tabs/PortfolioTab.tsx`)

Limites desta auditoria (importantes):
- Nao ha migrations/schema SQL versionado no repo (nao da para provar constraints/indices/RLS no Supabase).
- Nao ha logs de producao (Vercel/Supabase) para medir frequencia real de 500/races.
- O trace da NBA abaixo e um trace real de codigo/branches, nao de um utilizador especifico em producao.

## 1) Inventario & Duplicados

### 1.1 Flows (UI + API + engine/helpers)

### Welcome Setup
- UI:
- `app/app/page.tsx` (gate onboarding)
- `app/app/welcome/page.tsx`
- `app/app/welcome/welcomeClient.tsx`
- `app/app/offline-setup/page.tsx`
- `app/app/offline-setup/offlineSetupClient.tsx`
- APIs:
- `/api/user-settings` (`app/api/user-settings/route.ts`)
- `/api/setup/complete` (`app/api/setup/complete/route.ts`)
- `/api/plans` (`app/api/plans/route.ts`)
- `/api/daily-bundle` (preview starter)
- `/api/me` (via `usePaid`)
- Engine/helpers:
- `lib/signalcore/wealthMath.ts`
- `lib/signalcore/trial.ts`
- `lib/signalcore/dynamicStarterPack.ts` (via `daily-bundle`)
- `lib/signalcore/engineV3.ts` (via `daily-bundle`)
- Observacao:
- Setup completion e persistido por 2 caminhos (`/api/user-settings` + `/api/setup/complete`)

### Portfolio
- UI:
- `app/app/tabs/PortfolioTab.tsx` (principal)
- `app/app/portfolio/page.tsx` (route paralelo/legacy)
- `app/app/portfolio/QuickHoldingsModal.tsx` (legacy / incompatÃ­vel com API atual)
- APIs:
- `/api/portfolio-items` (`app/api/portfolio-items/route.ts`) [principal]
- `/api/portfolio-items/reset` (`app/api/portfolio-items/reset/route.ts`)
- `/api/market/search` (`app/api/market/search/route.ts`)
- `/api/fix-now/run` (`app/api/fix-now/run/route.ts`)
- `/api/daily-bundle`
- Legado/paralelo:
- `/api/portfolio` (`app/api/portfolio/route.ts`)
- `/api/portfolio/save` (`app/api/portfolio/save/route.ts`)
- `/api/portfolio-meta` (`app/api/portfolio-meta/route.ts`)
- Engine/helpers:
- `lib/signalcore/marketSearch.ts`
- `lib/signalcore/dynamicStarterPack.ts` (via `daily-bundle`)
- `lib/signalcore/engineV3.ts` + `lib/signalcore/valuation.ts` + `lib/signalcore/marketData.ts`

### Daily
- UI:
- `app/app/tabs/DailyTab.tsx` (principal)
- `app/app/daily/page.tsx` (redireciona para `/app?tab=daily`)
- `app/app/daily/DailyClient.tsx` (legacy paralelo)
- `app/app/daily/DailyPageClient.tsx` (legacy wrapper)
- APIs (ativas no tab):
- `/api/daily-bundle`
- `/api/broker/status`
- `/api/broker/sync`
- `/api/engine/events`
- `/api/engine/reliability`
- `/api/execution/proofs`
- `/api/execution/proofs/export`
- `/api/conversion/funnel`
- `/api/conversion/funnel/global`
- `/api/performance/track-record`
- `/api/fix-now/run`
- `/api/daily-snapshot`
- `/api/journal/log`
- `/api/portfolio-items/reset`
- `/api/trial/start`
- `/api/conversion/event`
- Engine/helpers:
- Canonico: `app/api/daily-bundle/route.ts` + `lib/signalcore/engineV3.ts`
- Suporte: `lib/signalcore/valuation.ts`, `lib/signalcore/marketData.ts`, `lib/signalcore/dynamicStarterPack.ts`

### Planning
- UI:
- `app/app/tabs/PlanningTab.tsx`
- APIs:
- `/api/plans`
- `/api/daily-bundle`
- `/api/portfolio-items`
- Engine/helpers:
- `lib/signalcore/wealthMath.ts`
- `daily-bundle` (estado/contexto)

### Advisor
- UI:
- `app/app/tabs/AdvisorTab.tsx`
- APIs:
- `/api/daily-bundle`
- Engine/helpers:
- `lib/signalcore/directives.ts`
- `lib/signalcore/wealthMath.ts`
- derivados de `daily-bundle`

### Autonomy
- UI:
- `app/app/tabs/AutonomyTab.tsx`
- `app/app/broker/BrokerPageClient.tsx`
- APIs:
- `/api/broker/status`
- `/api/broker/connect`
- `/api/broker/disconnect`
- `/api/broker/sync`
- `/api/daily-bundle`
- `/api/fix-now/run`
- `/api/daily-snapshot`
- `/api/journal/log`
- `/api/portfolio-items/reset`
- Engine/helpers:
- `lib/broker/store.ts`
- `lib/broker/sync.ts`
- `lib/broker/shared.ts`
- `lib/engine/events.ts`

### Billing
- UI:
- `app/pricing/page.tsx`
- APIs:
- `/api/stripe/checkout`
- `/api/stripe/sync-session`
- `/api/stripe/customer-portal`
- `/api/stripe/webhook`
- `/api/me`
- `/api/trial/start`
- Helpers:
- `lib/signalcore/trial.ts`
- `lib/server/urlSafety.ts`
- `lib/signalcore/conversion.ts`

### Paywall (distribuido)
- UI:
- `app/pricing/page.tsx`
- modal paywall em `app/app/tabs/DailyTab.tsx`
- bloqueio de modos Pro em `app/app/offline-setup/offlineSetupClient.tsx`
- banners/gates em `app/app/ui.tsx`
- `AutopilotSwitcher` via `useAutopilotMode`
- APIs:
- `/api/me`
- `/api/trial/start`
- `/api/conversion/event`
- `/api/conversion/funnel`
- `/api/conversion/funnel/global`
- Stripe endpoints
- Helpers:
- `lib/signalcore/usePaid.ts`
- `lib/signalcore/useAccess.ts`
- `lib/signalcore/useAutopilotMode.ts`
- `lib/signalcore/access.ts`
- `lib/signalcore/trial.ts`

### 1.2 Duplicacoes / conflitos (com fonte canonica proposta)

#### CONFLITO - Decision Engine
- Duplicados:
- `lib/signalcore/engineV3.ts` (ativo)
- `lib/signalcore/engine/index.ts`
- `lib/signalcore/engineV2.ts`
- `lib/signalcore/dailyBundle.ts`
- `lib/signalcore/dailyBundle.brain.ts`
- Evidencia:
- `app/api/daily-bundle/route.ts` importa `engineV3`
- `lib/signalcore/dailyBundle.ts` aponta para `dailyBundle.brain`
- Canonical source:
- `app/api/daily-bundle/route.ts` (payload final)
- `lib/signalcore/engineV3.ts` (calculo base)

#### CONFLITO - Fonte de plano
- Duplicados:
- `/api/plans` usa tabela `plans`
- `/api/plan/apply` le `user_settings` e usa `planFromSettings`
- `lib/signalcore/supabaseRepo.ts` contem `planFromSettings`
- Canonical source:
- tabela `plans` + `app/api/plans/route.ts`

#### CONFLITO - Fonte de holdings/portfolio
- Duplicados:
- `portfolio_items`
- `portfolios`
- `portfolio_meta`
- Canonical source:
- `portfolio_items` + `app/api/portfolio-items/route.ts`
- `portfolios` apenas snapshot/compat

#### CONFLITO - Estado de modo/autorizacao
- Duplicados:
- `user_settings.active_mode`
- `Clerk publicMetadata.mode` via `/api/user-mode`
- localStorage `sc_active_mode_v1`
- Canonical source:
- `user_settings.active_mode` + enforcement backend

#### CONFLITO - Estado de broker
- Duplicados:
- `user_settings.broker_connection`
- `journal_entries(type=broker_connection_state)`
- memory fallback (`mvpStore`)
- localStorage (espelhos UI)
- Canonical source:
- `user_settings.broker_connection`
- `journal_entries` apenas audit trail

#### DUPLICADO - Proof normalization / quality
- Duplicado em:
- `app/api/execution/proofs/route.ts`
- `app/api/execution/proofs/export/route.ts`
- `app/app/tabs/DailyTab.tsx`
- `app/api/daily-bundle/route.ts` (parsing/evidence)
- Canonical source:
- criar `lib/signalcore/executionProof.ts`

#### CONFLITO - Market data stack
- Duplicados:
- `lib/signalcore/marketData.ts` (ativo no core)
- `lib/market/marketClient.ts` + providers (`finnhub`, `twelvedata`)
- Canonical source:
- `lib/signalcore/marketData.ts` para core execution

#### DUPLICADO - Hooks de acesso
- Duplicados:
- `usePaid`
- `useAccess`
- ambos chamam `/api/me`
- Canonical source:
- `useAccess` (ou `useAccessState`) e `usePaid` como wrapper

#### DUPLICADO - Atualizacao de paid state Stripe
- Duplicados:
- `updatePaidState` em `/api/stripe/sync-session`
- `updatePaidState` em `/api/stripe/webhook`
- Canonical source:
- `lib/billing/stripePaidState.ts`

#### DUPLICADO - UI helper boilerplate
- Repetido em tabs/pages:
- `fetchJSON`, `normalizeMode`, `clsx`, `Card`, `Badge`, `fmtEUR`, `readGoalQuiz`, `readWealthPlan`
- Canonical source:
- `components/app/*` + `lib/signalcore/clientUtils.ts`

## 2) Next Best Action - Prova de "Decision Engine"

### 2.1 De onde vem a Next Best Action hoje (exatamente)

Fonte canonica final da NBA (payload entregue a UI):
- `app/api/daily-bundle/route.ts` constroi `daily.nba` final

Funcoes que calculam (camadas):
- Engine base (`lib/signalcore/engineV3.ts`)
- `computeDiagnostics`
- `buildCandidates`
- `buildNBA`
- `scoreExplained`
- `computeDecisionPressure`
- `proofFirst`
- Shaping/guardrails no route layer (`app/api/daily-bundle/route.ts`)
- `buildPlanPhase`
- `buildActionGate`
- `buildWhyNow`
- `computeFollowUpPlan`
- `computeExecutionCoach`
- `computeSuitabilityGate`
- `mergeActionGateWithSuitability`

### 2.2 Inputs usados hoje (reais)

Inputs diretos do backend (`daily-bundle`):
- `mode` query param
- `budgetEur` (starter pack preview)
- `auth.userId`

Persistencia usada na decisao:
- `journal_entries` (streak / `daily_done`)
- `journal_entries` (execution proof evidence)
- `daily_snapshots` (receipts count, timeline, doneToday)
- `user_settings` (suitability: risk/horizon/goal/setup)
- `plans` (plano)
- `portfolio_items` (holdings)

Dados de mercado / pricing:
- `getQuotes(...)` via `lib/signalcore/marketData.ts`
- valuation/pricing coverage via `computePortfolioValuation`

Inputs para NBA e gate:
- `hasPlan`, `hasHoldings`, `doneToday`, `starterPackCount`, `candidates`
- `diagnostics`, `pressureV2`, `planPhase`, `suitability`
- `recentActions`, `recentPhaseKeys`, `recentGateStatuses` (a partir da timeline)

### 2.3 Existe fallback "scriptado"? Sim.

Existe e e importante distinguir:
- `buildNBA` / `buildCandidates` sao engine real (rule-based deterministic)
- Existe texto parametrizado/predefinido (normal)
- Existe fallback defensivo em erro

Fallbacks/scripted relevantes:
- `daily-bundle` fatal error devolve fallback com `ok: true`
- `DailyTab` tem fallback local para `primary` se `nba` vier incompleta
- `microStepForAction` / `microStepForPhase` usam biblioteca de micro-passos predefinidos
- Day 1 usa branch de UX baseada em `receiptsCount === 0`

### 2.4 Trace real de decisao (codigo) - Cenario 1: Day 1 (primeira visita ao Daily)

Assuncao do cenario:
- utilizador autenticado
- setup e plano existem
- holdings existem (starter aplicado)
- `doneToday = false`
- `receiptsCount = 0`

Passo a passo:
1. `DailyTab` pede `/api/daily-bundle`.
2. Backend le `journal_entries`, `daily_snapshots`, `user_settings`, `plans`, `portfolio_items`.
3. `doneToday` e calculado por `daily_snapshots.day_key == today UTC`.
4. Receipts timeline e montada.
5. Quotes -> valuation -> diagnostics.
6. `buildCandidates(...)` calcula prioridades reais.
7. `buildNBA(...)` gera NBA base.
8. Route layer pode reescrever NBA por gate/phase repetition.
9. UI aplica fluxo visual de Day 1 quando `!doneToday && receiptsCount===0`.

Conclusao:
- A decisao backend e calculada por engine+route.
- O comportamento "primeiro dia" e sobretudo UX/layout, nao "decisao fake".

### 2.5 Trace real de decisao (codigo) - Cenario 2: Day 2 (next check-in)

Assuncao do cenario:
- existe pelo menos 1 snapshot/receipt
- novo dia UTC (`doneToday = false`)
- `receiptsCount >= 1`

Passo a passo:
1. `DailyTab` pede `/api/daily-bundle`.
2. Backend carrega timeline e historico recente de acoes/fases.
3. Engine recalcula diagnostics + candidates com estado atual.
4. Route layer usa `recentActions`/`recentPhaseKeys` para anti-repeticao e follow-up stateful.
5. Se houver repeticao/gate/phase, NBA pode virar `Plan follow-up: ...`.
6. `DailyTab` nao entra no first-cycle (porque `receiptsCount !== 0`), usa layout normal.
7. `Next best action` aparece em primeiro no fluxo normal.

### 2.6 Ha `if day==1/2` estatico?
- Nao no engine.
- Sim no UI (por estado derivado):
- `receiptsCount === 0` e `doneToday === false` no `DailyTab`.

### 2.7 Como substituir o "day1 UI branch" por calculo real (recomendado)
- Criar `onboarding_phase` persistido no backend (`user_settings` ou tabela propria)
- `daily-bundle` devolver `daily.loopStage`
- `DailyTab` renderizar por `loopStage`, nao por heuristica `receiptsCount===0`

## 3) Loops & Estados

### 3.1 Estados persistidos (Supabase tables)

Tabelas referenciadas no codigo:
- `user_settings`
- `plans`
- `portfolio_items`
- `portfolios`
- `portfolio_meta`
- `daily_snapshots`
- `journal_entries`

### 3.2 Estados persistidos (localStorage)

Chaves confirmadas:
- `sc_wealth_plan_v1`
- `sc_goal_quiz_v1`
- `sc_starter_budget_v1`
- `sc_onboarded`
- `sc_workspace_mode_v1`
- `sc_broker_connection_v1`
- `sc_hands_free_fixnow_v1`
- `sc_starter_warmup_v1`
- `sc_manual_exec_pending_v1`
- `sc_manual_exec_proof_v1`
- `sc_manual_broker_playbook_v1`
- `sc_first_daily_intro_seen_v1`
- `sc_first_advisor_intro_seen_v1`
- `sc_first_autonomy_intro_seen_v1`
- `sc_paywall_seed_v1`
- `sc_paywall_variant_anon`
- `sc_paywall_variant_user_<id>`
- `sc_active_mode_v1`
- `sc_campaign`

### 3.3 State machine (atual, real)

#### `setup_status`
- Persistido em `user_settings.setup_status`
- Escrito por `/api/user-settings` e `/api/setup/complete`
- Leitura do gate app em `app/app/page.tsx`
- O gate tambem aceita perfil completo e plano ativo como "complete"

#### `plan_status`
- Persistido em `plans.status` + `plans.is_active`
- Canonicamente resolvido em `/api/plans`
- Mas `daily-bundle` e `fix-now` usam latest row only (risco de divergencia)

#### `portfolio_status` (derivado)
- Derivado de existencia de `portfolio_items`
- valuation + pricing coverage + diagnostics

#### `daily_status` (derivado)
- `doneToday` via `daily_snapshots.day_key == today UTC`
- `streak` via `journal_entries(type=daily_done)`

#### `proof_status` (misto: server + client)
- Server:
- `journal_entries(type=execution_proof)`
- `daily_done.details.manualExecutionProof`
- Client:
- localStorage `sc_manual_exec_proof_v1`
- Gate de fecho no UI usa `manualExecutionProofReady` / `manualExecutionConfirmed`

### 3.4 Estados incoerentes identificados

1. `setup_status = new` mas app entra como complete
- Causa: gate fail-open + fallback por perfil/plano

2. `setup_status = complete` sem perfil completo
- Causa: `/api/setup/complete` nao valida perfil/goal

3. `/api/plans` diz "ha plano ativo", mas `daily-bundle`/`fix-now` podem ler draft mais recente
- Causa: selecao de plano diferente por endpoint

4. `doneToday = true` mas streak/discipline nao sobe
- Causa: snapshot e `daily_done` sao chamadas separadas

5. `broker connected` diverge entre UI/localStorage e backend
- Causa: multi-source de estado de broker

6. Free user com `active_mode` proibido persistido no server
- Causa: `/api/user-settings` nao aplica `enforceModeAccess`

## 4) Bugs & Riscos de Producao - TOP 20

1. CRITICO - `daily-bundle` pode usar plano errado (ultimo draft) e concluir `no_plan`
- Impacto: quebra NBA/gates/credibilidade
- Causa: query em `plans` usa `limit(1)` em vez de procurar plano ativo
- Ficheiros: `app/api/daily-bundle/route.ts`, contraste `app/api/plans/route.ts`
- Fix recomendado: helper `loadActivePlan(...)` partilhado

2. CRITICO - `fix-now` tem o mesmo bug do plano mais recente vs ativo
- Impacto: auto-fix pode operar com contexto errado
- Causa: `plans ... order(created_at desc).limit(1)`
- Ficheiro: `app/api/fix-now/run/route.ts`
- Fix recomendado: usar `loadActivePlan(...)`

3. CRITICO - Enforcement backend de modo Free/Pro incompleto
- Impacto: estado inconsistente entre UI e backend
- Causa: `useAutopilotMode` espera `402 + allowedMode`, `/api/user-settings` nao aplica `enforceModeAccess`
- Ficheiros: `lib/signalcore/useAutopilotMode.ts`, `app/api/user-settings/route.ts`, `lib/signalcore/access.ts`
- Fix recomendado: enforcement server-side no `POST /api/user-settings`

4. ALTO - `daily-bundle` mascara erro fatal com `ok: true`
- Impacto: observabilidade baixa e fallback silencioso
- Causa: catch final devolve payload de fallback com `ok: true`
- Ficheiro: `app/api/daily-bundle/route.ts`
- Fix recomendado: `ok:false` + `degraded:true` (ou 503) com payload seguro

5. ALTO - Gate de onboarding fail-open em erro de persistence/schema
- Impacto: utilizador entra no app sem onboarding valido
- Causa: `readSetupStatus()` catch retorna `"complete"`
- Ficheiro: `app/app/page.tsx`
- Fix recomendado: fail-closed controlado + evitar loops

6. ALTO - Fecho do dia no `DailyTab` nao e transacional (`snapshot` + `journal`)
- Impacto: `doneToday` sem `daily_done`; streak/proof inconsistentes
- Causa: duas chamadas separadas
- Ficheiro: `app/app/tabs/DailyTab.tsx`
- Fix recomendado: endpoint unico `/api/daily/close`

7. ALTO - `/api/daily-snapshot` tambem faz writes separados (snapshot + decision_receipt)
- Impacto: inconsistencia parcial no audit trail
- Causa: `upsert` + `insert` separados
- Ficheiro: `app/api/daily-snapshot/route.ts`
- Fix recomendado: transacao/RPC

8. ALTO - `Autonomy` repete o mesmo padrao nao transacional ao fechar dia
- Impacto: estados parciais no operador AI
- Causa: `/api/daily-snapshot` + `/api/journal/log` separados
- Ficheiro: `app/app/tabs/AutonomyTab.tsx`
- Fix recomendado: reutilizar `/api/daily/close`

9. ALTO - Race condition: `broker/sync` e `daily-snapshot` escrevem `daily_snapshots` no mesmo dia
- Impacto: last-write-wins em snapshot/meta
- Causa: ambos fazem upsert por `user_id,mode,day_key`
- Ficheiros: `lib/broker/sync.ts`, `app/api/daily-snapshot/route.ts`
- Fix recomendado: separar `snapshot_kind` ou pipeline unico

10. ALTO - `/api/portfolio-items/reset` e delete+insert sem transacao
- Impacto: perda de holdings em falha no insert
- Causa: delete total e insert posterior
- Ficheiro: `app/api/portfolio-items/reset/route.ts`
- Fix recomendado: transacao/RPC

11. ALTO - `/api/fix-now/run` persiste updates/inserts de `portfolio_items` em loop sem transacao
- Impacto: estado parcial apos erro
- Causa: `persistTargets` escreve por item
- Ficheiro: `app/api/fix-now/run/route.ts`
- Fix recomendado: batch transactional write

12. ALTO - `lib/broker/sync.ts` muta varias tabelas sem transacao
- Impacto: `portfolio_items`, `portfolios`, `daily_snapshots` podem divergir
- Causa: writes em sequencia
- Ficheiro: `lib/broker/sync.ts`
- Fix recomendado: RPC/transacao

13. ALTO - Estado de broker multi-source (settings/journal/memory/localStorage)
- Impacto: `status/connected/proofValid` inconsistentes
- Causa: ordem de leitura/escrita multipla
- Ficheiro: `lib/broker/store.ts`
- Fix recomendado: `user_settings.broker_connection` como source unico

14. ALTO - `QuickHoldingsModal` tem contrato quebrado com `/api/portfolio/save`
- Impacto: se ligado, falha de gravacao
- Causa: payload `holdings[]` vs rota espera `cashEur/valuesBySymbol`
- Ficheiros: `app/app/portfolio/QuickHoldingsModal.tsx`, `app/api/portfolio/save/route.ts`
- Fix recomendado: remover/adaptar para `/api/portfolio-items`

15. ALTO - Duplicacao de fontes de portfolio (`portfolio_items`, `portfolios`, `portfolio_meta`)
- Impacto: UI/engine podem usar snapshots diferentes
- Causa: coexistencia sem contrato canonico
- Ficheiros: `app/api/portfolio-items/route.ts`, `app/api/portfolio/route.ts`, `app/api/portfolio-meta/route.ts`
- Fix recomendado: declarar `portfolio_items` canonico e deprecar legados

16. MEDIO-ALTO - Duplicacao de parsing/scoring de execution proof
- Impacto: score/gates/export divergem
- Causa: logica copiada em UI + APIs
- Ficheiros: `app/api/execution/proofs/route.ts`, `app/api/execution/proofs/export/route.ts`, `app/app/tabs/DailyTab.tsx`
- Fix recomendado: extrair `lib/signalcore/executionProof.ts`

17. MEDIO-ALTO - `AppUI` faz GET extra a `/api/daily-bundle`
- Impacto: custo/latencia duplicados
- Causa: header stats usa `daily-bundle` completo
- Ficheiro: `app/app/ui.tsx`
- Fix recomendado: endpoint leve para header stats

18. MEDIO-ALTO - `DailyTab` faz fanout grande de GETs `no-store` no mount
- Impacto: burst de requests / custo / jitter
- Causa: paines secundarios carregados em paralelo sempre
- Ficheiro: `app/app/tabs/DailyTab.tsx`
- Fix recomendado: lazy-load por seccao/viewport

19. MEDIO - Paywall `starter_pack` reason existe mas nao e usado
- Impacto: analytics/payout funnel enviesado
- Causa: `openPaywall("starter_pack")` nao e chamado
- Ficheiro: `app/app/tabs/DailyTab.tsx`
- Fix recomendado: implementar trigger ou remover reason

20. MEDIO - `portfolio-meta` bypass do helper central Supabase + env `!`
- Impacto: 500 em runtime por env missing/mismatch
- Causa: `createClient` local com `NEXT_PUBLIC_SUPABASE_URL!` e `SUPABASE_SERVICE_ROLE_KEY!`
- Ficheiro: `app/api/portfolio-meta/route.ts`
- Fix recomendado: usar `lib/supabase/admin.ts` ou deprecar endpoint

### Outros riscos relevantes (fora do TOP 20)
- `/api/user-mode` duplica `active_mode` e parece nao utilizado
- `app/api/plan/apply/route.ts` devolve 200 mesmo em erro/unauthorized (masking)
- `ReceiptModal` usa receipt local com `tinyId` (nao e replay persistente)

## 5) Performance / Custo / Rate Limit

### 5.1 Chamadas externas identificadas

Market data:
- Finnhub
- `lib/signalcore/marketData.ts` (quotes)
- `app/api/market/search/route.ts` (search)
- `lib/market/providers/finnhub.ts` (stack paralelo)
- TwelveData
- `lib/signalcore/marketData.ts` (fallback quotes)
- `lib/market/providers/twelvedata.ts` (stack paralelo)

Billing/Auth:
- Stripe (`checkout`, `sync-session`, `webhook`, `customer-portal`)
- Clerk (`/api/me`, `/api/trial/start`, Stripe sync/webhook metadata)

Broker bridge:
- `lib/broker/sync.ts` usa `SIGNALCORE_BROKER_BRIDGE_URL` / `BROKER_BRIDGE_URL`

### 5.2 TTL cache / caching atual

Core quotes (`lib/signalcore/marketData.ts`):
- cache in-memory por processo (`MEM_CACHE`)
- TTL default `60s` (clamp `15..3600`)
- `dynamicStarterPack` usa `ttlSec:120`
- `daily-bundle` / `fix-now` usam `ttlSec:60`

Provider stack legado (`lib/market/providers/*`):
- quote TTL `30s`
- candles TTL `20m`

Sem cache / risco:
- `/api/market/search` chama Finnhub search com `cache: no-store` e sem TTL server

### 5.3 Riscos de rate-limit (codigo)

1. `AppUI` + `DailyTab` duplicam `/api/daily-bundle` no mesmo ecra
2. `DailyTab` faz fanout adicional de analytics/proofs/track-record no mount
3. `offlineSetupClient` pede preview via `/api/daily-bundle` enquanto user mexe no setup (sem debounce)
4. Sem in-flight dedupe de quotes (cache so enche apos fetch acabar)

### 5.4 Custo provavel (estimativa com suposicoes explicitas)

Sem logs reais, so da para estimar por cenario.

Exemplo (hipotetico):
- 100 utilizadores ativos/dia
- 5 aberturas/reloads do `Daily` por utilizador/dia
- 6 holdings medios
- 30% cache misses efetivos

Ordem de grandeza:
- `daily-bundle`: ~1000 req/dia (incluindo duplicado de `AppUI`)
- quotes externas em miss: ~1800 lookups/dia

### 5.5 Otimizacoes prioritarias
- Remover GET duplicado de `/api/daily-bundle` no `AppUI`
- In-flight dedupe de `getQuotes`
- Debounce no preview do `offlineSetup`
- Lazy-load paineis secundarios do `Daily`
- Cache curto server-side para endpoints analiticos

## 6) Paywall & Trial

### 6.1 Comportamento atual (free vs pro)

Fonte canonica do estado de acesso:
- `/api/me` (`app/api/me/route.ts`)
- interpreta Clerk `publicMetadata` com `lib/signalcore/trial.ts`

Free / Pro na UI:
- `AppUI` usa `useAccess()`
- `offline-setup` bloqueia modos nao-Investing para nao-Pro
- `pricing` faz trial/checkout/portal
- `Daily` tem paywall modal contextual (receipts)

### 6.2 Como o trial e disparado
- Nao esta preso a Day 1/Day 2
- Endpoint: `POST /api/trial/start`
- Triggers UI:
- `Pricing`
- `Daily` paywall modal

### 6.3 O que aparece / quando bloqueia
- Setup:
- Modos `Trading/Forex/Crypto` podem redirecionar para pricing se nao-Pro
- Daily:
- Paywall modal usado para `receipts`/history
- `starter_pack` reason existe mas sem trigger real
- Pricing:
- trial start, checkout, portal, sync-session

### 6.4 Pontos de churn (bloqueio antes de confianca)
1. Bloqueio de modo Pro no `Welcome Setup` antes de valor percebido
2. Gating no `Daily` por receipts/history pode surgir cedo demais
3. Falta de enforcement backend consistente de modo
4. Fluxo de upgrade ainda distribuido (nao centralizado pelo "momento de valor")

## 7) Proof Pack / Replay / Journal

### 7.1 Confirmado (o que existe mesmo)

Snapshots sao gravados:
- Sim, em `daily_snapshots` via `/api/daily-snapshot`

Journal entries por execucao:
- Sim, varios tipos:
- `decision_receipt`
- `daily_done`
- `execution_proof`
- `fix_now_run`
- `engine_event`

Proof export:
- Sim, `/api/execution/proofs/export`

### 7.2 Onde esta incompleto

1. Nao existe "Proof Pack" canonico ligado por ID
- snapshot, `daily_done`, `execution_proof` ficam soltos

2. `ReceiptModal` usa receipt local (nao persistente)
- `tinyId()` local no `DailyTab`

3. Replay server-side dedicado nao existe
- ha exports e dados dispersos, mas nao um replay por ciclo

4. Proof parsing/quality esta duplicado
- risco de inconsistencias entre listagem/export/gates/analytics

5. Snapshot e `daily_done` nao sao atomicos
- pode haver timeline sem `daily_done` ou vice-versa

### 7.3 O que falta para um Proof Pack robusto
- `proof_pack_id` por ciclo diario
- endpoint unico `POST /api/daily/close` (atomico)
- endpoint `GET /api/proof-pack/:proofPackId`
- endpoint `GET /api/proof-pack/replay?dayKey=...&mode=...`
- parser/scoring canonico partilhado

## 8) Saida Final Obrigatoria

### A) Mapa do Sistema (1 pagina) com modulos e fontes canonicas

Core de execucao (canonico):
- UI: `app/app/ui.tsx` + tabs (`Daily`, `Portfolio`, `Planning`, `Advisor`, `Autonomy`)
- Engine de decisao: `lib/signalcore/engineV3.ts`
- Orquestracao/payload: `app/api/daily-bundle/route.ts`
- Dados de mercado (core): `lib/signalcore/marketData.ts`
- Valuation: `lib/signalcore/valuation.ts`

Persistencia (canonica pretendida):
- Perfil/setup/modo/broker: `user_settings`
- Planos: `plans`
- Holdings: `portfolio_items`
- Snapshots diarios: `daily_snapshots`
- Journal/auditoria/proofs: `journal_entries`

Modulos operacionais:
- Broker/autonomy: `lib/broker/store.ts`, `lib/broker/sync.ts`, `app/api/broker/*`
- Billing/trial: `app/pricing/page.tsx`, `app/api/stripe/*`, `/api/trial/start`, `/api/me`, `lib/signalcore/trial.ts`

Fontes paralelas/legacy (nao canonicas):
- `lib/signalcore/engine/index.ts`
- `lib/signalcore/engineV2.ts`
- `lib/signalcore/dailyBundle.ts`
- `lib/signalcore/dailyBundle.brain.ts`
- `app/api/portfolio`, `app/api/portfolio/save`, `app/api/portfolio-meta`
- `app/api/plan/apply`
- `app/api/user-mode`
- `app/app/daily/DailyClient.tsx`
- `app/app/portfolio/QuickHoldingsModal.tsx`

### B) Lista de Bugs e Duplicacoes priorizada

Prioridade P0:
1. Plano ativo inconsistente (`daily-bundle` / `fix-now`)
2. Enforcement Free/Pro ausente em `/api/user-settings`
3. `daily-bundle` fallback com `ok:true` mascara falhas
4. Fecho do dia nao transacional
5. Race `broker/sync` vs `daily-snapshot`

Prioridade P1:
6. `portfolio-items/reset` delete+insert sem transacao
7. `fix-now` writes parciais sem transacao
8. `broker/sync` multi-table writes sem transacao
9. Multi-source broker state
10. Duplicacao de proof scoring/parsing
11. Duplicacao de portfolio stores
12. Duplicacao de plan source
13. Duplicacao de paid-state updater Stripe

Prioridade P2:
14. GET duplicado de `/api/daily-bundle` (`AppUI` + tab)
15. Fanout excessivo de endpoints no `Daily`
16. `QuickHoldingsModal` incompatÃ­vel
17. `portfolio-meta` bypass do helper Supabase
18. `/api/user-mode` legacy/duplicado
19. `DailyClient` legacy paralelo
20. Dead code warning (`normalizeStarterAllocations` nao usado)

### C) Plano de Correcao (ordem exata, commits sugeridos e testes minimos)

#### Commit 1 - Unificar selecao de plano ativo
- Criar helper `loadActivePlan(...)`
- Usar em `daily-bundle`, `fix-now`, opcionalmente `/api/plans`
- Testes minimos:
- unit test: escolhe `active` quando ultimo e `draft`
- unit test: fallback para ultimo quando nao ha ativo

#### Commit 2 - Enforcement backend Free/Pro em `/api/user-settings`
- Aplicar `enforceModeAccess`
- Devolver `402 + allowedMode` no contrato esperado pelo client
- Testes minimos:
- free tenta `trading` -> `402`
- paid -> `200`

#### Commit 3 - Endpoint canonico de fecho diario (atomico)
- Criar `POST /api/daily/close`
- Gravar snapshot + `daily_done` + link proof num unico fluxo
- Migrar `DailyTab` e `AutonomyTab`
- Testes minimos:
- integration test sucesso grava tudo
- integration test falha parcial nao deixa estado inconsistente

#### Commit 4 - Canonicalizar proof parsing/scoring
- Extrair `normalizeProof`, `computeProofQuality`, `proofGate`
- Reusar em APIs + UI + track-record
- Testes minimos:
- unit tests para score/gate
- golden test export/list com mesmas pontuacoes

#### Commit 5 - Consolidar fonte de portfolio (deprecar legados)
- Declarar `portfolio_items` como canonico
- Deprecar `/api/portfolio`, `/api/portfolio/save`, `/api/portfolio-meta`
- Remover ou adaptar `QuickHoldingsModal`
- Testes minimos:
- integration test `portfolio-items` GET/POST/DELETE/reset
- QA manual PortfolioTab

#### Commit 6 - Consolidar broker connection source
- `user_settings.broker_connection` como source unico
- `journal_entries` apenas audit trail
- Testes minimos:
- unit tests de load/save precedence
- integration test `connect -> status -> sync -> status`

#### Commit 7 - Performance: reduzir chamadas duplicadas
- Remover GET extra de `/api/daily-bundle` no `AppUI`
- Lazy-load paineis pesados do `Daily`
- Debounce preview do setup
- Testes minimos:
- QA manual network tab (antes/depois)

#### Commit 8 - In-flight dedupe + cache strategy quotes
- Dedupe concorrencia em `getQuotes`
- Testes minimos:
- unit test de chamadas simultaneas por simbolo

#### Commit 9 - Paywall/trial cleanup
- Implementar trigger real `starter_pack` (ou remover reason)
- Harmonizar `usePaid` / `useAccess`
- Centralizar CTA upgrade
- Testes minimos:
- QA manual free/trial/paid
- unit tests de trial normalization

#### Commit 10 - Proof Pack / Replay
- `proof_pack_id`
- endpoint replay por ciclo
- `View receipt` com ID persistente (nao `tinyId`)
- Testes minimos:
- integration test replay consistency
- QA manual "View receipt" apos reload

## Informacao que falta (para auditoria 100% operacional) e onde procurar

1. Schema/constraints do Supabase
- Falta: unique keys, FKs, RLS, RPCs
- Onde ver: SQL editor / migrations reais no Supabase (nao estao no repo)

2. Logs reais de erros/latencia
- Falta: frequencia de 500, timeouts, races
- Onde ver: Vercel Function Logs e Supabase logs

3. Dados reais para trace runtime da NBA
- Falta: payload de `/api/daily-bundle` de utilizador real + rows no Supabase
- Onde ver: browser network + tabelas `daily_snapshots`, `plans`, `portfolio_items`, `journal_entries`

---

Nota de qualidade atual do repo (durante a auditoria):
- `npm test` OK
- `npm run build` OK
- `npm run lint` OK com 1 warning:
- `app/app/tabs/PortfolioTab.tsx:317` (`normalizeStarterAllocations` definido e nao usado)



