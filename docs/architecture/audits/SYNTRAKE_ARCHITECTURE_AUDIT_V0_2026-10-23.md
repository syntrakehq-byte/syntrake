# SYNTRAKE — Auditoria de arquitetura, dependências e proposta de roadmap R0–R7

**Snapshot:** 23 de outubro de 2026  
**Classificação:** AUDITORIA READ-ONLY / PROPOSTA PARA DISCUSSÃO / **NÃO CANÓNICO NEM APROVADO**  
**Âmbito:** novo repositório `syntrakehq-byte/syntrake`, Supabase Preview `zkqgpejlkgootkvkebhd`, Supabase Production `vbazzxqyuqcrmjytaboc` e projeto Vercel `syntrake`.  
**Exclusões:** repositório legado `122n4/signalcore`, execução real de uma sessão Clerk A/B entre *dois utilizadores distintos*, segredos, serviços externos não identificados, prova end-to-end de pagamentos Stripe e brokers, auditoria exaustiva de cada linha de código e reexecução local independente dos testes CI.  
**Alterações efetuadas:** **nenhuma** ao GitHub, Vercel ou Supabase. Consultas e inspeções exclusivamente em leitura.

## A. Conclusão executiva

**Não há evidência suficiente para declarar SYNTRAKE operacional como produto financeiro autónomo.** Há uma fundação importante de identidade/segurança e persistência Investing. Há capacidades executáveis em PRs Draft e em Supabase Preview. **Não existe na árvore de código inspecionada um Market Data Core, Trading Core ou sistema de workers/scheduler/queue com continuidade 24/7 demonstrada.**

**Não recomendamos recomeçar do zero.** Recomendamos preservar o que foi provado, resolver o *gate* de segurança/lineage dos candidatos e formalizar contratos e dependências antes de novos motores. A divisão correta é por *bounded contexts* e autoridade financeira, não necessariamente por quatro repos ou quatro microsserviços.

### Etiquetas de estado

- **ACCEPTED (escopo estrito):** capacidade já incorporada no baseline, com evidência identificável e limites expressos. Nunca significa “todo o domínio acabado”.
- **CANDIDATE:** implementação em Git/Preview, com gates ainda por cumprir.
- **PARTIAL:** existe uma parte da capacidade, mas falta a cadeia operacional ou integrações essenciais.
- **MISSING:** nenhum componente correspondente identificado no **novo** repositório/ambientes inspecionados. Não prova inexistência global fora deste âmbito.
- **BLOCKED:** aceitação, promoção ou operação não autorizada enquanto faltar evidência material.

## B. Fontes de verdade verificadas

### GitHub

- Repositório: [`syntrakehq-byte/syntrake`](https://github.com/syntrakehq-byte/syntrake); branch canónica `main` no **SHA `d42ecf58ca46c0e33d866cced2cdf14aa36eced0`**.
- A árvore recursiva de `main` contém **113 ficheiros**; o candidato R2-C2 no **SHA `26170947e4a126ef898de857f6ee2e13ae657f22`** contém **143 ficheiros**. Nenhuma árvore foi truncada pela API.
- Cadeia *stacked* integralmente Draft e não merged:

| PR | Slice | Head SHA exato | Base SHA exato | Estado |
|---|---|---|---|---|
| [#20](https://github.com/syntrakehq-byte/syntrake/pull/20) | R2-A — normalizador de importações não verificadas | `ed8c30a3a25d03fbba1f27009f21c4772034b549` | `d42ecf58ca46c0e33d866cced2cdf14aa36eced0` | Draft |
| [#21](https://github.com/syntrakehq-byte/syntrake/pull/21) | R2-B1 — persistência de snapshots de importação | `d3cc2022b5ee9acd3012888cc85c2627f1ce0a9d` | `ed8c30a3a25d03fbba1f27009f21c4772034b549` | Draft |
| [#22](https://github.com/syntrakehq-byte/syntrake/pull/22) | R2-C — onboarding | `2f6467065a854ff90c08783a347b01eb0b81672a` | `d3cc2022b5ee9acd3012888cc85c2627f1ce0a9d` | Draft |
| [#23](https://github.com/syntrakehq-byte/syntrake/pull/23) | R2-C2 — primeiro portfolio via Clerk JWT/RPC | `26170947e4a126ef898de857f6ee2e13ae657f22` | `2f6467065a854ff90c08783a347b01eb0b81672a` | Draft |

- Para o **SHA exato do PR #23**, GitHub Actions apresenta **7/7 workflows `success`**: Investing Core, R0-A Quality Gates, R2-B1 PG17, R2-C PG17, R2-C2 PG17, release readonly PG17 e release Supabase CLI PG17. **Isso é evidência de execução CI, não uma aprovação independente ou prova de integração completa.** Nenhuma review formal foi devolvida pelo GitHub para o PR #23.
- `README.md` da raiz ainda caracteriza o produto como *commercial landing and account experience*; `investing-core/README.md` contém histórico de R0-A/R1-A e afirmações temporais que já não descrevem integralmente a situação atual. O contrato R2-A refere um futuro R2-C com outra função, enquanto os PRs atuais nomeiam R2-C como onboarding. **Achado de governança: a documentação e a nomenclatura de fases estão parcialmente desatualizadas**. Não corrigir retroativamente provas históricas; versionar as decisões futuras.

### Supabase

**Production — `vbazzxqyuqcrmjytaboc`**

- **2** entradas no registo de migrations: `20261017191056 remote_schema` e `20261020180000 investing_first_readonly_release`.
- Schema `investing`: **9 tabelas**, as 9 com RLS e 8 com FORCE RLS. Sem tabelas `investing.initial_portfolio_receipts`, import snapshots ou onboarding intents.
- Contagens observadas: **0 contas, 0 portfolios, 0 movimentos/entradas ledger**. São contagens deste ambiente, **não uma declaração de cash €0 ou ausência de capital do utilizador**.
- `anon` sem USAGE no schema Investing; `authenticated` pode ler `investment_accounts` sujeito a membership RLS, mas não tem INSERT em accounts ou ledger entries; SELECT de ledger entries está sem GRANT para `authenticated` em Production.
- Security Advisor: **1 INFO** (`rls_enabled_no_policy`); Performance Advisor: **7 avisos `auth_rls_initplan`**, 7 FK sem índice (INFO), entre outros. Não convertidos em bloqueios automáticos sem análise de risco e plano concreto.

**Preview — `zkqgpejlkgootkvkebhd`**

- **12** migrations registadas. Além das bases e ensaios, inclui R2-B1, R2-C e múltiplas migrations *forward-only* de R2-C2 e respetivas correções de ACL/JWT.
- Schema `investing`: **15 tabelas**, todas com RLS, 14 com FORCE RLS. Sem tabelas próprias identificadas nos schemas `trading` ou `market_data`.
- Contagens observadas: **7 contas, 5 portfolios, 3 onboarding intents, 3 receipts de criação inicial, 2 snapshots de importação não verificada, 2 ledger transactions e 4 ledger entries**. Existem dados de ensaio; as entradas do ledger não provam transferências reais nem cash broker-confirmed.
- RPC `investing.provision_first_portfolio`: SECURITY DEFINER detida pelo role restrito `investing_initial_provisioner` (**NOLOGIN**, não `postgres`). EXECUTE de `authenticated`: **sim**; `anon`/`service_role`: **não**; sem delegação temporária `postgres → provisioner` persistente, conforme testes read-only anteriores.
- `authenticated` não tem INSERT direto em contas ou ledger; SELECT de ledger entries **existe no Preview**, ao contrário da Production: **diferença material de superfície de acesso, que exige revisão antes de qualquer promoção.**
- Security Advisor: **1 WARN** — `authenticated_security_definer_function_executable`. Tratar como finding real até auditoria da função, assinatura/issuer JWT, claims, search_path, privilégios do owner e Data API, embora exista restrição de dono, de identidade e ACL. [Remediação Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Performance Advisor: **38 avisos `auth_rls_initplan`**, 17 FKs sem índices (INFO), 1 unused index (INFO) e 1 auth DB connections (INFO). Não executar otimizações sem profiling e revisão.

**Separação entre ambientes:** Production e Preview **não têm a mesma sequência de migrations**. Isso é aceitável numa fase candidata, mas **impede promoção por simples cópia, alteração de versões existentes ou `db push` sem plano de reconciliação e ensaio.**

### Vercel

- Projeto `syntrake`: `prj_JLOTCtdLdHfFDCj7GhUaf9NdVQEC`.
- `www.syntrake.com` aponta para o deployment **Production READY** `dpl_2Lh5ZP2iEViPtb3ikjdoVFTTpbV3`, com o mesmo SHA de `main` acima.
- O branch candidato R2-C2 tem Preview **READY**, `dpl_3VhuWt4yQvu7RZkRewqVzcvy1Vuo`, no SHA exato `26170947e4a126ef898de857f6ee2e13ae657f22`.
- Existem variáveis `INVESTING_R1_PRODUCTION_READ_MODE=enabled` e `INVESTING_R1_PRODUCTION_APPROVED_SHA` igual ao SHA de `main`. O acesso read-only em Production é **condicional** a outros gates do código; **não foi reexecutada nesta auditoria uma sessão Clerk real em Production**.
- Existem flags de Preview para R2-C e R2-C2. `INVESTING_R2C2_DATABASE_URL` continua configurada apenas para o branch Preview, mas o fluxo atual no código usa o JWT PostgREST e o papel antigo continua NOLOGIN. Rever oportunamente a remoção/rotação de credenciais obsoletas — **não removidas nesta auditoria**.
- **Nenhuma variável Twelve Data/Market Data identificada** entre as variáveis do projeto consultadas. Não se infere daqui inexistência de subscrição externa.
- `vercel.json` não define crons e desativa auto-deployment da `main`. Nenhum worker, scheduler ou queue dedicado identificado na árvore do repo; **não há prova de processamento autónomo 24/7 no stack auditado**. Não confundir Vercel deployments READY com um processo persistente sempre ativo.

## C. Inventário canónico de capacidades

| Domínio / capacidade | Evidência real localizada | Estado | Principal lacuna / gate |
|---|---|---|---|
| Web / landing / sign-in | Next.js/Clerk, Production READY e sessões observadas em anteriores testes | **ACCEPTED — escopo UI/auth básico** | Teste completo de logout/domínios e cross-account em duas identidades reais |
| Identity / autorização / isolamento Investing | RLS, membership/owner, PG17 A/B e gates JWT | **PARTIAL** | Dois utilizadores reais Clerk A/B; auditoria de funções privilegiadas e vias de acesso |
| Fundação financeira Investing | `investing-core/domain/{money,ledger}.ts`; ledger PG17; schema de Production | **ACCEPTED — escopo técnico R0-A/R1 readonly** | Ainda não é um portfolio vivo nem registo de cash confirmado |
| First-account provisioning | RPC restrita, Preview, conta real de teste do utilizador e reentrada com mesma identidade | **CANDIDATE — R2-C2** | PR #23 Draft, warning SECURITY DEFINER, A/B real e promoção controlada |
| Onboarding sem/ com portfolio | R2-C UI/API, `onboarding_intents` em Preview | **CANDIDATE** | Persistência de perfil e suitability completa; estados/fluxos finais |
| Importação declarativa | Parser R2-A e snapshots R2-B1 no Preview | **PARTIAL / CANDIDATE** | Ligação HTTP ao portfolio real, reconciliação, correções e distinção UNVERIFIED vs broker truth |
| Posições / cash / movimentos longitudinais | Estruturas iniciais de ledger, snapshots de importação não verificados | **PARTIAL** | Instrument master, lotes, corporate actions, valorização, ledger reconciliado, income, FX, contribuições realizadas vs planeadas |
| Market Data Core | Nenhum módulo/provedor na árvore auditada | **MISSING** | Adapter/provider, normalização, armazenamento histórico 1D, identity, calendário, FX, provenance, custos |
| Twelve Data | Sem credencial nem integração no novo Vercel/GitHub | **MISSING no stack auditado** | Plano/limites reais, segredo no servidor, adapter, testes contra dados reais |
| Scheduler / workers 24/7 | Sem executáveis de jobs/workers, filas ou infraestrutura operacional provada | **MISSING** | Contratos de jobs, ownership de workers, retries, leases, idempotency, heartbeat, dead letter, alarms, prova com browser fechado |
| Investing valuation/allocation/performance/risk/suitability | Sem engines correspondentes na árvore do novo projeto | **MISSING** | Dependem de financial truth e market truth; deterministic engines, testes e snapshots |
| Investing Decision | Sem motor de decisões longitudinal | **MISSING** | BUY/ADD/REDUCE/SELL/REBALANCE/HOLD CASH/NO ACTION auditáveis; custos e suitability |
| Trading Core | Nenhum bounded context/trading book/motor no novo repo ou schema Trading identificado | **MISSING no novo projeto** | Fundar isoladamente capital, posições, mandatário, estados, risco e decisões NO TRADE |
| Research Lab | Intencionalmente não incorporado no novo repo | **FORA DO CORE** | Opcional; não pode ser pré-requisito de Investing/Trading |
| Shadow / Paper/Demo Broker | Não identificados no novo repo | **MISSING** | Forward validation de execução, risco, idempotência, rejeições e reconciliação |
| Live execution | Sem autoridade/broker runtime no novo repo | **BLOCKED por design** | Evidência operacional, mandato explícito, segurança, kill switches e requisitos legais |
| CI / audit trail / release governance | CI em sete workflows no PR #23; migrations separadas; SHA/provas em docs | **PARTIAL** | Fases não aprovadas; documentação desatualizada; aprovação independente e gate coerente entre Git/DB/Vercel |

### D. Achados materiais que justificam a mudança de processo

**F1 — CRÍTICO de produto (não incidente confirmado): execução 24/7 ainda não demonstrada.** O site e as APIs HTTP não são o scheduler. Antes de market analysis contínua, provar um worker server-side independente do browser, com identidade de serviço autorizada, jobs duráveis, recuperação e observabilidade.

**F2 — ALTO de release: quatro PRs empilhados Draft + Preview com migrations próprias.** O canónico aceito mantém-se `main@d42ecf58…`; é proibido declarar os candidatos terminados ou migrar Production sem análise de lineage, diff, SQL, RLS e SHA exato.

**F3 — ALTO de segurança: RPC SECURITY DEFINER exposta a `authenticated` com aviso do Advisor.** Não confundir testes positivos e owner NOLOGIN com uma auditoria completa de privilégio / auth. Abrir gate técnico específico; não apagar simplesmente o aviso.

**F4 — ALTO de verdade financeira: staging não é portfolio reconciliado.** `USER_REPORTED`, `UNVERIFIED` e `STRUCTURE_CREATED_UNFUNDED` não podem originar fake cash, fake P&L ou recomendações. Dinheiro planeado não é realizado; contribuições não são retorno.

**F5 — MÉDIO/ALTO de processo: desatualização de nomenclatura e documentação.** O documento R2-A antecipava um R2-C distinto do PR #22; outros relatórios dizem “NOT APPLIED” para releases agora aplicadas. Manter documentação histórica imutável como evidência, mas colocar um **índice de estado atual** separado, com `supersedes` e SHA.

**F6 — RISCO FUTURO de acoplamento: capacidades centrais ainda sem contratos de fronteira.** Criar interface estável entre market data e engines, e entre scheduler/jobs e domínios; Trading nunca consulta ledger/mandato Investing nem vice-versa. Monólito modular + workers isolados é uma opção proporcional, não um compromisso com microservices.

**F7 — Mercado / automação:** dados e engines não existem no novo stack, portanto não há base para afirmar edge, capacidade de gerar lucros, rentabilidades ou execução autónoma de ordens. `NO ACTION`/`NO TRADE` só podem ser conclusões fundamentadas, não defaults fictícios.

## E. Arquitetura mínima proposta (não aprovada)

```text
                          WEB (Next.js / Clerk / billing)
                                       |
                               API / AUTH GATE
                                       |
    +----------------------------------+--------------------------------+
    |                                  |                                |
SHARED PLATFORM                 INVESTING CORE                    TRADING CORE
- verified identity             - Investing identities/accounts    - Trading identities/accounts
- market-data contracts         - portfolios / ledger / cash       - trading book / ledger / capital
- provider adapters             - objectives / suitability         - strategies / risk mandates
- durable job infrastructure    - position, valuation, risk        - opportunities / sizing
- logging/provenance            - decision / decision history      - decision / decision history
- notifications                 - Investing execution authority   - Trading execution authority
    |                                  |                                |
    +------> jobs/event contracts <----+------ separate execution ------+
                                       |
                           ADVISORY → SHADOW → PAPER/DEMO → LIVE
```

**Invariantes:**

1. A Web nunca executa o processamento contínuo; o sistema continua sem sessão de utilizador nem dispositivo ligado.
2. Shared Platform partilha infraestrutura segura, **não contas, cash, posições, risco, ledger, ordens ou mandatos entre Investing e Trading**.
3. `service_role` é capacidade, não prova de autorização do utilizador; workers operam com identidades e *mandates* explícitos, derived server-side.
4. O Core não importa dependências do Research Lab.
5. Market data preserva identidade de instrumentos, moeda/bolsa, calendários, corporate actions, adjusted/raw, as-of, fonte, licença, FX, qualidade e ausência de dados.
6. Ledger e modelos de posições distinguem declaração, execução, confirmação, income, retorno, contribuição e fonte. Nenhuma operação financeira presumida.
7. Concurrency/retries/idempotency são requisitos de jobs financeiros, não implementações ad hoc na UI.
8. Sem dados/mandato/ownership suficientes: **BLOCKED/UNAVAILABLE**, não zeros, probabilidades inventadas, trades ou saldos fictícios.

## F. Roadmap R0–R7 — PROPOSTA, NÃO CANÓNICA

Os IDs abaixo são preservados por conveniência, mas **não substituem automaticamente as denominações, commits ou migrations históricos**. A aceitação será por subfases com contratos executáveis, não por grandes releases indivisíveis.

| Fase | Entrega operacional | Dependências mandatórias | Gate de saída | Situação atual |
|---|---|---|---|---|
| **R0 — Auth / isolation** | Login Clerk, identificação de actor, RLS e permissões negativas entre contas | Web + Clerk + contrato de ownership | A/B real com duas sessões distintas, acessos indevidos negados, regressão | **PARTIAL para fecho global**; login básico comprovado |
| **R1 — Financial base Investing** | Account/portfolio/ledger, atomicidade, idempotency, currency/owner | R0 ownership + PG17 | Reconciliar versão aceite de schema, invariantes e grants; Production estritamente scope readonly | **ACCEPTED no escopo de base readonly**; portfolio vivo por fazer |
| **R2 — Living portfolios** | Onboarding; importação declarativa; posições/cash/flows/objetivos e histórico com provenance | R0 + R1; instrument identity quando aplicável | A/B real; import→persist→read de contas reais; distinção verificado/não verificado; sem movimentos inventados | **CANDIDATE/PARTIAL** em PRs #20–#23 |
| **R3-A — Continuous Operations** | Durable scheduler/queue/worker, leases, idempotência, falhas, recuperação e observabilidade | R0 identidade de serviço + persistência de jobs | Processamento sem browsers ligados, eventos persistidos, recover/retry/alert, prova de isolamento | **MISSING** |
| **R3-B — Market Data Core** | Instrument master, Twelve Data adapter, 1D/FX/history, normalização e provenance | Provider credentials + contracts estáveis | Dados reais com as-of/provider/licença; falhas/stale/missing/FX/splits; sem lookahead | **MISSING** |
| **R4 — Investing Analysis/Decision** | Valuation, allocation, P&L/performance, risk, suitability, alternatives e decisão | R1, R2, R3-A/B | Golden vectors; reconciliação; `NO ACTION`; decisão auditável + scheduled processing | **MISSING** |
| **R5 — Trading Core/Decision** | Trading account/book, market state/opportunity, risk, sizing, costs, NO TRADE | R0, R3-A/B; **não** depende de R4 ou de Investing ledger | Positivo/negativo do motor, isolation, broker intent de ensaio, costes e risk mandates | **MISSING** |
| **R6 — Modes/Forward Validation** | Advisory → Shadow → Paper/Demo, broker adapters, rejects/reconciliation/recovery | Domain engines aprovados + R3-A; autoridade separada por domínio | Histórico forward com erros, idempotência e reconciliação demonstrados | **MISSING** |
| **R7 — Live Controlled** | Operação Live sujeita a mandato, kill switch, reconciliations, observabilidade e legal | R6 + autorização/regulação onde aplicável | Gate de segurança, execução/rejeição/reconciliação/rollback operacional, mandato explícito | **BLOCKED por design** |

**Dependências como DAG, não mera fila linear:**

```text
R0 → R1 → R2 ───────────────────→ R4 (Investing)
  \       \                       ↑
   └─────→ R3-A (ops) ──────────┤
   └─────→ R3-B (market) ───────┤
            │                   └────────────→ R5 (Trading; sem dependência de R4)
            └────────────────────────────────→ R5
R4 ou R5 (cada domínio, separadamente) + R3-A → R6 → R7 (somente após gate específico)
```

O **primeiro worker de R3-A não necessita de preços reais nem de decisão**: deve executar, gravar, falhar e recuperar de forma controlada. A ligação Twelve Data pode ser desenvolvida em slice R3-B autónomo. R2 pode guardar snapshots `UNVERIFIED` antes de haver valuation, mas não pode fingir que são posição/cash reconciliados.

## G. Contrato mínimo de aceitação por slice

1. **ID estável da capacidade** e relação com o roadmap; objetivo e exclusões explícitos.
2. **Accepted predecessor SHA → Candidate SHA**; diff real; um writer por slice.
3. **Contratos materialmente necessários**: auth/tenant/mandate, integridade e finance/market truth, provenance, concurrency/idempotency, migrations quando aplicável.
4. **Prova executável** adequada ao risco: unit/determinism, PG17/RLS isolado, integração real e, para workers, execução sem sessão e recovery/alert.
5. **Verificação independente** de fonte, CI e estado externo, incluindo a versão do database e deployment; falhas novas ou contradições **BLOCKED**.
6. **Gate separado de Production** com autorização explícita; nunca promover o candidato baseado só em PASS ou texto do PR.
7. **Registry de estado** (`ACCEPTED/CANDIDATE/PARTIAL/MISSING/BLOCKED`) atualizado por SHA, evidência, data, reviewer e ações restantes. Índice aponta para relatórios históricos imutáveis, não os reescreve.

## H. Ordem do trabalho seguinte recomendada

**H0 — Congelar novas funcionalidades durante a discussão de arquitetura.** Manter Production intocada e PRs Draft; não descartar nem renumerar migrations.

**H1 — Fechar o índice canónico de estado e os contratos de fronteira.** Um artefacto Git versionado, *sob revisão*, contendo grafo de dependências, autoridade dos serviços, identidade e propriedade de contas, market truth e estado de cada candidate; evitar documentação paralela contraditória.

**H2 — Gate R0/R1/R2 existente.** Auditar e corrigir o finding SECURITY DEFINER de R2-C2, provar Clerk A≠B em sessões distintas e acessos negativos, verificar lineage/migrations Preview→Production, R1 Production readonly e documentação desatualizada. Não dar merge/deploy só por ter feito o inventário.

**H3 — Primeiro slice executável R3-A.** Job único e inofensivo sem decisões financeiras que persiste execução, heartbeat e retry; validar idempotência e *recovery* real em infraestrutura cloud, sem browser aberto. Provar ausência de cruzamento entre utilizadores.

**H4 — Slice independente R3-B.** Adapter Twelve Data com contratos/provider credentials server-only, identity, 1D/FX, as-of e proveniência; ensaiar missing/stale/limits e licenças antes de ligar valuation.

**H5 — R2 living financial truth + R4/R5 por caminhos independentes.** Ligar importação ao portfolio depois de aprovar e verificar os dados; motores e decisões separados. R6/R7 apenas após evidência suficiente.

### Critérios de aceitação deste próprio relatório

Este documento é uma **proposta V0 com observações técnicas**. Ainda falta validação arquitetural humana e um candidate commit/review para existir uma política canónica no GitHub. **Não é um roadmap aprovado, uma autorização de migração ou uma aceitação de PRs.**

## I. Evidência e referências auditáveis

- `main` exacto: [commit d42ecf5](https://github.com/syntrakehq-byte/syntrake/commit/d42ecf58ca46c0e33d866cced2cdf14aa36eced0).
- R2-C2 candidato exacto: [commit 2617094](https://github.com/syntrakehq-byte/syntrake/commit/26170947e4a126ef898de857f6ee2e13ae657f22), [PR #23](https://github.com/syntrakehq-byte/syntrake/pull/23).
- [PR #20](https://github.com/syntrakehq-byte/syntrake/pull/20), [PR #21](https://github.com/syntrakehq-byte/syntrake/pull/21), [PR #22](https://github.com/syntrakehq-byte/syntrake/pull/22): dependências stacked e mudanças por ficheiro inspecionadas.
- Código central: `investing-core/domain/{money,ledger}.ts`, `investing-core/server/{accountsReadHttp,onboardingTransport,initialPortfolioRuntime,savePortfolioImport}.ts`, `supabase/release-candidates/`.
- Vercel Production deployment: `dpl_2Lh5ZP2iEViPtb3ikjdoVFTTpbV3`; Vercel Preview: `dpl_3VhuWt4yQvu7RZkRewqVzcvy1Vuo`.
- Supabase Production: `vbazzxqyuqcrmjytaboc`; Preview: `zkqgpejlkgootkvkebhd`. Consultados catálogo PG (schemas, RLS, owners, grants, funções, policies), contagens, migrations e advisors, sem DML/DDL.

**Fim da auditoria READ-ONLY.**