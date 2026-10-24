# SYNTRAKE — Contrato operacional do produto (candidato V1)

**Data:** 2026-10-24 (Europe/Paris)  
**Estado:** CANDIDATE / REVIEW ONLY. Não é documento canónico, não autoriza merge, Production, migrações, operações financeiras, brokers nem subscrições.  
**Predecessor Git aceite:** `main@29f1c068769e34a84e87717ac8cc9286dd937938`.  
**Documento relacionado:** arquitetura proposta em PR #24; este documento **complementa**, não altera retroativamente nem publica, D1–D7.  
**Âmbito:** plataforma multiutilizador desde o início, inicialmente utilizada pelo fundador, com Investing e Trading completos e autónomos no sentido *operacional*. O uso de market data Grow continua **restrito ao uso pessoal autorizado**. A comercialização de serviços/dados/execução de terceiros depende de direitos e autorização aplicáveis.

## 0. Contrato do produto e princípio de verdade

Pergunta operacional: «Com base na situação real deste utilizador, nos seus objetivos, nas condições atuais e na qualidade dos dados, deve fazer alguma coisa — e conseguimos demonstrar porquê?»

- **Investing**: importar/construir portfolios, preservar património e histórico financeiro, acompanhar capital e movimentos, adequação, risco, custos e mercado; concluir `BUY / ADD / REDUCE / SELL / REPLACE / REBALANCE / APPLY NEW CAPITAL / HOLD CASH / NO ACTION / BLOCKED`. 
- **Trading**: observar mercado/book próprio, oportunidades, sizing/risco/custos, concluir `TRADE / NO TRADE / BLOCKED`; execução só no modo e mandato expressamente permitidos.
- **Novo utilizador**: pode ser autenticado e iniciar onboarding com isolamento real. A conta **não** é condicionada a ser o fundador; as funcionalidades condicionadas por licença de dados, autorização financeira, broker e entitlement ficam fechadas individualmente, sem bloquear todo o produto.
- **Sem dados / sem prova**: `UNAVAILABLE` (não 0). `USER_REPORTED`, `UNVERIFIED`, `BROKER_CONFIRMED`, `DEMO` e `SIMULATED` nunca são sinónimos. Os números do broker não são confiáveis só porque chegaram por HTTP; têm provenance e reconciliação.
- **Autonomia**: funcionamento sem browser não significa autoridade financeira. Um worker não pode aumentar risco, alterar estratégia aprovada ou enviar ordens por possuir acesso técnico a um token/DB.
- **Core não depende de Lab**. O Lab pode consumir evidência do Core. AI é intérprete/auxiliar de pesquisa, nunca ledger, fonte de mercado, authority ou engine matemático.

## 1. Percursos de ponta a ponta obrigatórios

### I-A — Investing com portfolio existente

1. Clerk identifica o ator; servidor resolve contas **próprias** e acesso Investing; não confia em account/portfolio/user ID da request.
2. Seleção de fonte `MANUAL` / ficheiro / provider / broker quando autorizado; guardar origem, período e estado de verificação. Formatos de ficheiro distintos têm parsers versionados.
3. Resolver instrumento contra um **Instrument Master** tipado, inclusive conflitos ticker/venue/currency/asset class; entradas ambíguas aguardam intervenção, não valorização fictícia.
4. Importar como snapshot **declarado** com cash por moeda, posições, custo conhecido ou `UNKNOWN`, histórico/flows quando fornecidos. Sem movimento fictício nem alteração de saldo broker.
5. Normalizar + validar + persistir sem eliminar raw original, com idempotência, owner e versionamento. Reimportações iguais não criam history duplicado; correção gera novo evento.
6. Reconciliar quando a fonte é adequada: contas, cash settled/unsettled, posições, quantidades, fills, income, fees, transferências, corporate actions, FX; discrepância material mantém estado `UNVERIFIED` ou `BLOCKED`.
7. Derivar estado financeiro longitudinal por eventos e lotes, não por editar posições «correntes». Distinguir capital novo, cash flow externo, receita, custos e P&L.
8. Validar preço/FX (data as-of, ajustamentos, timezone/venue, licença, qualidade), valorizar quando possível, senão `UNAVAILABLE` por componente.
9. Calcular NAV, allocation, concentração, TWR/MWR, risco e cenários conforme dados suficientes, com golden vectors independentes.
10. Comparar carteira atual, objetivos, horizonte, risco, custos, restrições e alternativas, incluindo novo capital antes de vendas; decisão versionada, `NO ACTION` permitido.
11. Registar fonte/dataset/snapshot, engine/param/version, assumptions, input hash, rationale, custos estimados com natureza explícita e validade temporal.
12. Notificar ou publicar decisão. Execução é outro gate: intent autorizado → broker → reports/fills → reconciliação, nunca dedução de execução pelo retorno HTTP.

### I-B — Investing sem portfolio

1. Onboarding próprio: objetivos, capital disponível **declarado/confirmado**, liquidez, horizonte, experiência, capacidade/tolerância ao risco, restrições e plano de contribuições.
2. Os dados em falta mantêm `UNKNOWN` e podem impedir recomendações; capital futuro não entra em cash nem retorno.
3. Construir e comparar alternativas elegíveis e adequadas, com riscos/custos e limites legais/produto. Não prometer retorno.
4. Propor portfolio inicial **não executado**, ou `NO ACTION/BLOCKED`. Criar estado estrutural vazio não comprova saldo €0 ou depósito.
5. Após investimento/importação/ligação broker autorizada, integrar os mesmos eventos financeiros e engine longitudinal do percurso I-A.

### T-A — Trading

1. Validar identidade, tenant, trading account/book/mandato/risco próprios (nunca reutilizar estado financeiro nem execution authority Investing).
2. Market Data Core fornece preço/quote/bar/FX com freshness, calendário, venue, custos conhecidos ou `UNKNOWN`.
3. Market State + Opportunity avaliam hipóteses e estratégias versionadas com evidência; sem score AI usado isoladamente.
4. Risk/Sizing verifica capital, exposição, leverage, liquidez, perda admissível, correlações, custo, limites e ordens pendentes.
5. Decision emite `TRADE` com condições e validade, `NO TRADE` quando não compensa, `BLOCKED` quando falta informação ou autoridade.
6. Advisory → Shadow → Paper/Demo → Live, **por domínio, broker, conta e mandato**. As decisões e controlos são comuns; enviar ordem é capacidade adicional distinta.
7. Ordem: `INTENT → VALIDATED → SUBMITTED → ACCEPTED/REJECTED → PARTIAL/FILLED/CANCELLED/EXPIRED/UNKNOWN → RECONCILED`, com eventos broker verificáveis, reentrada idempotente e falha fechada.
8. Reconciliation e monitoring continuam após restart; divergência entre intenção, broker e book bloqueia novas ordens quando material. Performance líquida de custos, regime e deriva monitorizados sem assumir edge.

### O-A — Operação contínua

Mesmo sem utilizador ligado: schedule/event → job durável com ator/autoridade resolvidos server-side → data quality → snapshot → engine → decisão imutável → alerta → eventual intent (quando autorizado) → broker report → reconciliação. Retry/restart/lease/timeout/outage são situações normais, não exceções omitidas.

## 2. Fronteiras de responsabilidade (monorepo modular)

| Boundary | Responsabilidade e state | Não pode fazer |
|---|---|---|
| Identity/Authority | Clerk session/JWT validado, subject, ownership de recursos e regras de autorização server-side; personal accounts B2C por omissão | confiar em IDs do cliente ou igualar subscription a mandato |
| Commercial/Entitlements | Estado subscrição/plan/features, quotas, permissões de utilização de dados; não guarda capital | conceder financial authority pelo pagamento |
| Market Data Core | instrument identity, aliases/venue, providers, preços/FX, qualidade, provenance, licenças, corp actions/calendars | definir posições/cash do utilizador, alimentar terceiros com Grow |
| Investing Core | conta, portfolio, ledger, cash/flows/income/positions/lots, objetivos, risco, decisões e histórico | usar book/mandato/ledger Trading |
| Trading Core | trading account/book, capital, ordens, estratégias, risk/sizing/decisions | usar ownership/capital Investing |
| Operations | scheduler/queue/worker/outbox/alertas/observability, leases/retries | elevar autoridade por service_role |
| Execution (adaptadores distintos por domínio) | broker sessions, intent, order events, fills, cancel, reconciliação | submeter ordens sem authority/mandate; assumir exactly-once do broker |
| Intelligence / optional Lab | hipóteses, modelos candidatos, simulações/backtests, análises explicativas | criar financial truth ou promover modelo diretamente a Live |
| Web/API | interface/validação e acesso autenticado a serviços do Core | ser worker durável ou fonte de verdade financeira |

**Tenant B2C:** Clerk Organizations não são pré-requisito para pessoa física; no futuro podem existir entidades de equipa se um caso real exigir. Uma conta pessoal pode ter várias contas Investing/Trading e portfolios/books. JWT `sub` válido não substitui validação de ownership sobre cada recurso. Worker identity ≠ autorização do cliente.

## 3. Contratos transversais que evitam reconstruções

### C-AUTH: autoridade e perfis

- Todas as operações têm `actor/source/tenant-or-user/resource/domain/operation` resolvidos no servidor; verificam ownership e entitlement distinto do mandato.
- `service_role`/DB credential apenas habilita uma chamada técnica; autorização financeira é verificada pela aplicação e/ou RLS/SQL.
- Conta A nunca lê/escreve B, mesmo conhecendo IDs de B; teste no HTTP, RPC, SQL, jobs e object storage. Login de terceiros permitido não ativa por defeito serviços regulados ou dados sem licença.
- Funções `SECURITY DEFINER` são excecionais e requerem revisão de owner, grants, search_path, exposed schema, JWT verificado, RLS e negative A/B.

### C-INSTRUMENT: identidade de mercado, sem hardcode de uma asset class

- Registro canónico possui `asset_class` e identidade de contrato; aliases por provider e broker separados e versionados no tempo.
- Equities/ETF: ISIN/FIGI quando aplicável + venue/MIC + currency/listing. Forex spot: par base/quote, venue/provider, contract terms. Crypto: venue/par/network/token address conforme produto. Derivativos: underlying, tipo, expiry, strike, multiplier, settlement, venue e contract ID.
- Um parser de ISIN é **subconjunto válido**, não implementação universal do Instrument Master. Instrumento desconhecido não recebe ticker «mais parecido». Ambiguidade ⇒ `NEEDS_MAPPING`.
- Dinheiro por moeda respeita expoentes/rounding; quantidades/preços/taxas têm precisão específica. Nunca Float JS como verdade financeira.

### C-MARKET: preços e direitos

- Cada bar/quote/FX preserva `instrument_id`, venue, quote currency, provider, raw/adjusted basis, event time, publish/observation time, ingest time, expiry/freshness, calendário, source version e licença/escopo de utilização.
- Os fornecedores estão atrás de adapters; Trading intraday quando suportado, Investing preferencialmente 1D; histórico sem survivorship ou look-ahead; correções não apagam vintages usados em decisões passadas.
- `DATA_RIGHTS` é gate separado de plan/billing: Twelve Data Grow somente no uso pessoal permitido; outro utilizador pode registar-se/onboardar sem acesso a feeds Grow. Não redistribuir raw nem derived quando vedado. Direitos dos dados comerciais exigem validação antes da ativação.
- Outage/429/licença vencida ⇒ qualidade `STALE/BLOCKED/UNAVAILABLE`; não inventar preço, spread, FX, cotações executáveis nem valor de portfolio.

### C-FIN: eventos financeiros, portfolio e reconciliação

- Estados distintos: carteira **estrutural vazia**, declaração **unverified**, import **persistido**, broker **observado**, finance **reconciliado**; não elevar confiança sem evidência.
- Ledger append-only e balanced por moeda, idempotência, tx/concorrência, reversals/adjustments versionados; transfers internal vs external, contribution planned/realized, settlement, income, fees/taxes e corp actions.
- Posições/cash são **derivados** de eventos e/ou snapshots externos associados, com source lineage. Conflict/difference preservada, não apagada.
- TWR/MWR, FX conversion e valuation apenas com fluxo temporal e preços adequados. Missing ≠ 0. Mesmo «read-only» pode expor dados financeiros sensíveis; sempre authorization.

### C-DEC: decisão reproduzível

- Engine determinístico recebe snapshot financeiro/book + market vintage + objectives/mandates + risk + costs + eligible alternatives + engine version.
- Saída: ação/`NO ACTION`/`NO TRADE`/`BLOCKED`/`UNAVAILABLE`, razões, alternativas, custos, fontes, limites, validade, hashes/versionamento. Nunca criar actividade apenas para mostrar utilidade.
- Backtests são evidência histórica; candidato de estratégia separado de versão aprovada. Aprendizagem/promoção passa por avaliação OOS/forward, drift, registos e gates.

### C-OPS/EXEC: funcionamento e ordens

- Jobs duráveis, retries at-least-once e **efeitos** idempotentes, locks/leases com fencing, DLQ, correlação, limites de tenant e circuit breakers. Não prometer exactly-once remoto.
- Execução só após pre-trade gate em cada ordem e a cada alteração material de mandato/estado. Cancel, timeout e reconnection consultam estado broker antes de retry; partial fills e cash reserved tratados.
- Kill switch e reconciliation por conta/domínio; modo Live sem mandato inequívoco ou broker sem permissão ⇒ `BLOCKED`.

## 4. Não-funcionais que são parte do produto

1. Segurança: least privilege, secrets por ambiente, cifragem de broker credentials, logs redigidos, RLS, MFA conforme riscos, auditoria e resposta a incidentes.
2. Resiliência: backups/restores provados; `RPO/RTO` definidos antes de capital real; sem eliminar logs financeiros por limpeza de dados.
3. Operação: observabilidade por job/dataset/decision/order/tenant, alerts e orçamento operacional (API calls, broker rate limit, DB, queues).
4. Privacidade e direitos: data minimization/retention/export, direitos do utilizador, plano de incidentes, fontes contratualmente permitidas.
5. Regulação: classificação concreta do serviço por jurisdição e instrumento; aconselhamento/gestão/terceiro broker só após confirmação jurídica e contratual. Utilização própria não prova autorização para terceiros.
6. Produto: PT/FR/EN com estados explícitos, audit trail legível, onboarding de dois percursos e acessibilidade. Não vender `READY` deployment como portfolio funcional.

## 5. Roadmap R0–R7 — critérios de saída, sem renomear histórico

| Gate | Prova de resultado; não apenas presença de código |
|---|---|
| **R0** | Login, personal accounts multiuser, ownership server-side e A/B real em UI/API/DB, ACL/RLS, workers futuros sem autoridade implícita. Mantém scope de R0 já aceite. |
| **R1** | Account/portfolio/ledger foundation, money e invariantes PG17, idempotência, leitura própria protegida, migrações auditadas. Preservar o R1 aceite no SHA anterior. |
| **R2** | **Ambos** os percursos Investing E2E: entrada → import/construção → persist → reload → correção → cash/positions/flows com qualidade e owner; reconciliação não inventada. Instrument Master mínimo antes de aceitar instrumentos sem ISIN. |
| **R3-A** | Worker real sem browser: schedule, queue, crash/retry/recovery, lease/idempotency, observabilidade e A/B; inicialmente tarefa inofensiva. |
| **R3-B** | Market Data Core: provider Twelve Data pessoal com capability/data-rights, aliases multiativos, 1D/FX, as-of, calendars, corp actions, stale/missing/retry; intraday quando necessário. |
| **R4** | Investing valuation/performance/risk/scenario/suitability/alternatives/decision com golden vectors e casos `NO ACTION/BLOCKED`, sem confundir cash flows com retorno. |
| **R5** | Trading book/risk/state/opportunity/sizing/costs/decision **isolados**, `NO TRADE`, read/replay e dados de mercado; não depende do R4. |
| **R6** | Advisory → Shadow → broker Paper/Demo com forward results, idempotência, rejects, fills, reconciliação e kill switch; por domínio. |
| **R7** | Live por mandato específico, approvals, broker/contract/legal, risk, observabilidade, recovery, limites e kill switches; bloqueado até gates reais. |

**Dependências não-lineares:** R2 usa identidade mínima de Instrument Master antes da implementação integral R3-B; R3-A e R3-B podem avançar em paralelo sem operar financeiramente. R5 não depende de R4. Paper cedo, mas após decisão/risco mínimos. Não bloquear desenvolvimento pessoal por requisitos futuros comerciais; bloquear **exposição** a terceiros quando faltarem direitos.

## 6. Matriz de testes anti-regressão obrigatória, por capacidade relevante

- Dois Clerk users independentes (A/B) com contas de cada domínio; próprio permitido, outro negado nos caminhos UI/API/RPC/DB/jobs; mesmo com ID legítimo de B introduzido por A.
- Tokens inválido/expirado/issuer errado; `SECURITY DEFINER`, service_role, grupos e plano adulterados; fail closed.
- Novo utilizador sem portfolio, sem cash declarado, sem subscrição e sem direitos de dados: onboarding permitido, recomendação/broker bloqueado conforme contrato, sem `€0` falso.
- Reimportação idempotente, documento duplicado, ficheiro incompleto, erro de timezone, correction/reversal, import com 2 moedas e cost-basis desconhecido.
- Corporate actions/FX em falta, instrumento ambíguo, symbol change/delisting e múltiplas listings; evitar survivorship/look-ahead.
- Contribuições planeadas não entram no NAV realizado nem em retorno; P&L e TWR/MWR com fluxos externos contrastados por vetores independentes.
- Worker restart e corrida entre duas execuções; replay sem efeito duplicado; dead-letter e recovery observados.
- Limites de provider, mercados fechados, quotes stale, provider sem licença, outage e dataset vintage incompatível ⇒ `BLOCKED/UNAVAILABLE`.
- Broker rejects/partial fill/cancel/timeout/reconnect, ordens desconhecidas, risco alterado e kill switch; nenhuma duplicação de execução em retry.
- Estrategia candidata/AI falha, drift/out-of-sample inadequado ⇒ versão aprovada não muda nem há ordem.
- Falhas de deploy e migration drift, backup restore, secrets; nenhum Production SQL sem autorização e SHA gate.
- Utilizadores A/B não conseguem ver subscrição, dados, broker keys, trade reports ou alertas do outro.

## 7. Rehearsal obrigatório no fecho de cada fase

Cada Rn **só é aceite** após **dois** relatórios de rehearsal Supabase, além da auditoria independente: (1) `R<n>_PHASE`, específico da capacidade Rn, e (2) `R0_TO_R<n>_CUMULATIVE`, reexecutando regressões de todas as fases aceites até Rn e os fluxos integrados. Em especial **R2 requer `R2_PHASE` seguido de `R0_TO_R2_CUMULATIVE`**. A ordem entre R3-A e R3-B é independente; registar a cobertura efetivamente aceite. Rehearsals necessitam branch Supabase isolada e **autorização explícita do custo antes da criação**; limpeza da branch com readback depois do ensaio e condições de segurança verificadas. Nunca declarar rehearsal realizado por ter CI verde ou aplicar SQL à Production. Consultar [Contrato de rehearsal R0–R7](./REHEARSAL_GATES_R0_R7_20261024.md), candidato até aprovação.

## 8. Sequência concreta após aceite do contrato

1. **Reconciliar documentação PR #24** com este contrato/índice e com a `main` aceite, sem o promover automaticamente. Clarificar qual é a referência canónica antes de merges.
2. **Auditar PR #28 R2-A** contra o âmbito do parser: deterministic e sem persistência; declarar limites (ISIN-only, no active reconciliation), testes negativos e compatibilidade futura com Instrument Master. Só aceitar o SHA exato após evidence gate.
3. **Resolver segurança de R2-C2 #23** antes de qualquer RPC/migration. Tratar #21/#22/#25/#26 por lineage e contratos; não promover o stack Draft sem rebase/auditoria.
4. Executar o primeiro slice funcional de R2 `import → persist → own read` em PG17/Preview com dois utilizadores, provenance, zero financial writes em Production.
5. Em paralelo, preparar R3-B adapters (instrument master + Twelve Data Grow restrito + historical 1D/FX) e R3-A worker inofensivo com leases/retries, sem tocar em capital.
6. Desenvolver R4/R5 engines em isolamento, progressão R6 e apenas depois autorização específica R7.

### Evidência e referências externas (verificar vigência antes de decisões comerciais)

- Twelve Data commercial/personal use: https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage
- Twelve Data terms: https://twelvedata.com/terms
- Clerk B2C vs B2B: https://clerk.com/docs/guides/how-clerk-works/multi-tenant-architecture
- Clerk + Supabase third-party JWT: https://supabase.com/docs/guides/auth/third-party/clerk
- Supabase database functions/`SECURITY DEFINER`: https://supabase.com/docs/guides/database/functions
- Supabase Queues & Cron: https://supabase.com/docs/guides/queues ; https://supabase.com/docs/guides/cron
- ESMA MiFID II suitability Art. 25: https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mifid-ii/article-25-assessment-suitability-and
- IBKR third-party access: https://www.interactivebrokers.eu/campus/ibkr-api-page/web-api-trading/

**Não aprovado por autoavaliação:** este ficheiro é contrato candidato, não auditoria independente de produção, nem revisão jurídica, nem garantia de lucro. Cada feature exige diff/testes/evidência de providers e autorização própria para alterações materiais.
