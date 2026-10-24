# SYNTRAKE — Matriz de cobertura / lacunas e gates de execução

**Snapshot:** 2026-10-24, GitHub consultado em leitura. **Predecessor `main@29f1c068769e34a84e87717ac8cc9286dd937938`**.  
**Estado:** proposta para review, **não** prova de deployments/DB atuariais e **não** autorização de merges/migrations.  
**Escopo da verificação:** árvore Git `main`, scripts/tests/migrations versionados, PR metadata + SHA/branch de #20–#28, fonte em PR #28 e PR #24, checks CI associados. **Supabase Production e Vercel não foram consultados diretamente nesta revisão**; resultados operacionais abaixo são apenas histórico documentado (PRs/audits). Actualizações posteriores exigem consultas live.

## Classificações

- **IN_MAIN:** ficheiros do domínio presentes na main, sem implicar funcionamento E2E.
- **ACCEPTED_SCOPED:** gate anteriormente aprovado, no âmbito restrito descrito pela evidência.
- **DRAFT:** implementação em PR não integrado ou não aprovado.
- **MISSING_MAIN:** não foi encontrado o produto/engine na árvore exata `main` (não equivale a provar inexistência noutras branches).
- **BLOCKED:** requisito não demonstrado para aprovação/release.
- **UNVERIFIED_EXTERNAL:** não repetimos leitura do serviço externo nesta análise.

## A. Cobertura da plataforma vs capacidades exigidas

| ID | Capacidade | Evidência verificada no GitHub | Situação / ação antes de chamar «pronto» |
|---|---|---|---|
| P01 | Identity/ownership A/B | `proxy.ts`, `requireVerifiedClerkActor.ts`, `accountsReadHttp.ts`; R0 PR #9 e R1 PR #10–#17 integrados | ACCEPTED_SCOPED para leitura e rehearsals históricos; RPCs/jobs futuros precisam A/B próprios |
| P02 | Entitlements/mandates | Clerk/Stripe routes no `app/api/stripe`, frontend pricing | PARTIAL; autorização financeira por conta, modo e revogação não demonstrada na main; Stripe Live fora de âmbito, não aprovar |
| P03 | Instrument master universal | Não existe diretório/engine de instrumentos na main | MISSING_MAIN; ISIN/MIC no Draft #28 não cobre Forex, cripto e derivados |
| P04 | Market data adapters | Não há Twelve Data/provider adapter na main | MISSING_MAIN; Grow pessoal e rights gate ainda por implementar |
| P05 | Quality/provenance/PIT | Contractos gerais de ledger e metadata; não há market vintage manager | MISSING_MAIN; não inventar suporte a point-in-time |
| P06 | Portfolio/lots/cash lifecycle | Fundação SQL `20261017160000...` e `20261020180000...`, API read own accounts | PARTIAL: schema de fundação, sem percurso financeiro longitudinal E2E |
| P07 | Ledger/financial writer | `investing-core/domain/ledger.ts`, `recordUserReportedContribution.ts`, testes PG17, relatório R0 A/C | ACCEPTED_SCOPED em fundação/rehearsal; writer de produção não presumido |
| P08 | Import/reconciliation | PR #28 R2-A parser; #21 persistência snapshot e #26 legacy reconciliation Draft | DRAFT; não há import→persist→read/reconcile aprovado na main |
| P09 | Goals/suitability | #22 onboarding intent Draft, sem engine suitability na main | MISSING_MAIN para decisão; intencional no Draft, não operação |
| P10 | Portfolio analytics | Não há `valuation/performance/risk` engines na main | MISSING_MAIN |
| P11 | Investing decision | Não há engine de alternativas/decisão na main | MISSING_MAIN; NO ACTION permanece contrato |
| P12 | Trading book separado | Nenhum Trading Core no novo stack main | MISSING_MAIN; não reutilizar Investing ledger |
| P13 | Market state/opportunities | Não há engine na main | MISSING_MAIN |
| P14 | Trading risk/sizing | Não há engine na main | MISSING_MAIN |
| P15 | Decision registry imutável | Não há registo de decisões Investing/Trading na main | MISSING_MAIN |
| P16 | Worker/queue/autonomia | Só app web, scripts de deploy, CI; nenhum worker contínuo na main | MISSING_MAIN; deploy READY não é processamento autónomo |
| P17 | Notifications/explanations | UI e i18n, sem eventos de decisão/notificação no Core | MISSING_MAIN para produto de decisão |
| P18 | Execution adapter & order lifecycle | Não há broker order gateway na main | MISSING_MAIN; Live BLOCKED |
| P19 | Broker sync/reconciliation | Não há ligação de contas externas/broker na main | MISSING_MAIN |
| P20 | Shadow/Paper | Não há broker demo/instrumentação forward na main | MISSING_MAIN |
| P21 | Research/model governance | Research Lab histórico fora do novo stack, intencional | OPTIONAL / MISSING_MAIN; motores Core primeiro |
| P22 | AI explainability | Não há AI decision layer na main | MISSING_MAIN; não é dependência do Core |
| P23 | Security/privacy/DR | Clerk/RLS/fail-closed tests + site privacy + release gates | PARTIAL; segurança de novos RPCs e broker keys exige auditoria por slice |
| P24 | Compliance/serviço/rights | Termos/disclaimer gerais; contrato de produto proposto | BLOCKED para ativação comercial de aconselhamento/execução/dados de terceiros; avaliação externa necessária |
| P25 | Multiuser SaaS operations | Sign-up Clerk, Stripe APIs, pages; R1 own-account reader | PARTIAL; tenancy infra aproveitável, mas customer journeys e entitlement por licença não demonstrados |
| P26 | Release governance | CI `.github/workflows/investing-*.yml`, PR evidence, SQL release candidate & gate | ACCEPTED_SCOPED; candidate→SHA→PG17→review→approval→prod sempre separado |
| P27 | Scalability/DR | Não há worker/drill operacional nem RPO/RTO verificados na main | UNVERIFIED_EXTERNAL / MISSING_MAIN |
| P28 | Product end-to-end UX | `app/start`, `app/investing/accounts`, `app/api/investing/accounts` e marketing | ACCEPTED_SCOPED read-only; não é Investing funcional/Trading UX; #22/#23 Draft |

**Nota crítica:** aceitar registo/login de um terceiro não lhe concede autorização para usar o Twelve Data Grow do fundador, receber aconselhamento personalizado regulado ou executar ordens. O estado correto dessas funcionalidades é `FEATURE_BLOCKED` com motivo; o onboarding e restante produto elegível podem continuar.

## B. Situação dos PRs e efeito no plano de implementação

| PR | Fonte de trabalho | Gate atual e decisão |
|---|---|---|
| **#24** | Roadmap/índice V1, R0/R1 closures documentais, base anterior `d42ecf58...` | Documento ainda não publicado na `main`; reconciliar com main `29f1c068...` e com este contrato antes de o chamar canónico. Não atualizar PR #24 sem writer/gate explícito. |
| **#28** | Import normalizer + 12 testes, `c3f0796fd868f318c54c998c29caf8446e48b82c` sobre main aceite | Diff de 4 ficheiros/4 commits, CI do candidato observado SUCCESS (3 workflows). **DRAFT**, parser de snapshots declarados com ISIN/MIC; ainda não serve como registry multiativos nem integração real. Requer independent technical review antes de merge. |
| #20 | R2-A versão original contra base antiga | Supersedido funcionalmente como candidato de trabalho por #28; não forçar merge em cadeia antiga. |
| #21 | R2-B1 append-only import persist | Draft empilhado sobre #20; reavaliar lineage, schema, retries, ownership, imports correctivos em nova base. |
| #22 | R2-C onboarding duas entradas | Draft empilhado sobre #21; reconciliar acesso, UX, suitability e persistência de intenções. |
| #23 | R2-C2 primeira conta/portfolio RPC | Draft; `SECURITY DEFINER`, actual owner JWT, schema grants, replay/concorrência e verdadeiro Clerk A/B exigem gate antes de Production. |
| #25 | Read-only Clerk A/B harness | Draft; testes sintéticos não equivalem a duas sessões Clerk reais. |
| #26 | Existing-account reconciliation read-only | Draft; evita duplicação, mas precisa integração e caso A/B efetivos. |
| #18/#19 | Scripts/release evidência R1 | PRs históricos ainda abertos; não concluir que produção deve incorporar todo o código Draft. |

**Fontes:** repositório `syntrakehq-byte/syntrake`, branch `main`, PRs #9–#28 e logs de CI. Estados de Supabase/Vercel de 24/10 descritos noutros registos são HISTÓRICO DOCUMENTADO, não reauditoria live desta matriz.

## C. Dependências de produto (não confundir com sequência rígida)

| Entregável | Depende obrigatoriamente de | Pode avançar independentemente |
|---|---|---|
| Entrada de novo utilizador | Auth + server ownership + feature access | Market Data, broker, pagador |
| Primeiro portfolio vazio | R0 + R1 schema/account ownership | Market Data/valorização/execução |
| Import declarações equities/ETFs | R0/R1 + parser de contratos limitados + provenance | Broker/reconciliation e market values |
| Import global multiativos | Instrument Master com classe/contrato, token/venue/currency | Market feed em tempo real; valores podem ficar UNAVAILABLE |
| Ledger e posições reais | Fonte financeira verificada ou declarada bem marcada, idempotência, event lineage, correções | AI/Lab |
| Valorização | Financial snapshot + instrument master + prices/FX rights and as-of | Broker live |
| Suitability/decisão Investing | Objetivos + portfólio e provenance + market/custos + validação de âmbito legal/serviço | Trading Core |
| Trading decisão | Trading book/mandato isolado + state/market + risk/sizing/costs | Investing R4 |
| Worker autónomo | Service identity + queue/lease/retry + scoped authority | Market Data e ordens (primeiro teste inofensivo) |
| Paper broker | Trading/Investing decision + broker adapter + risk/authority/reconciliation | Live/Research Lab |
| Live do próprio utilizador | Paper/shadow evidence + broker approval/contract + mandato + risk + kill switches + controls | Licença comercial para redistribuição a terceiros |
| Nova pessoa usa dados/preços do sistema | Direito de provider para a finalidade e tipo de exposição + isolamento/entitlement | Twelve Data Grow do fundador, que não pode ser sublicenciado |
| Comercialização de decisões/execução de terceiros | Análise regulatória por país e tipo de serviço + broker/data contracts | Feature desenvolvimento e testes internos |

## D. Primeiras tarefas *sem recomeçar R0/R1*

**G0 — Contrato (esta alteração):** revisar contrato operacional e matriz de cobertura; definir se a arquitetura pertence à referência V1 do PR #24 ou futura V2. Documentação não é autorização de merge.

**G1 — R2-A review exato:** `main@29f1c068... → #28@c3f0796f...`. Verificar normalização determinística, precisão, custo desconhecido, integridade datas, limites, instrumentos duplicados, no authority injection, e explicitar que o parser não é Instrument Master. O próprio PR não adiciona UI, persistência, broker nem market feeds. Não alargar gratuitamente o parser a todas asset classes neste slice.

**G2 — R2-B write contract:** zero confiança em actor IDs do cliente; transação idempotente, ledger separado do snapshot, immutable/correctable financial truth; confirmar PostgreSQL 17 A/B antes de Preview e de qualquer migrate. Reconciliar history SQL Preview/Production antes do gate.

**G3 — Dois percursos Investing:** abrir conta estrutural vazia de forma segura para novo utilizador; caso existente importa e relê; nunca escrever test cash real em Production para demonstrar funcionamento.

**G4 — R3-A worker inofensivo & R3-B provider adapter pessoal:** são workstreams separados; documentar escopos de custos antes de recursos pagos; operam sem liberar execução financeira.

**G5 — Motores e teste E2E:** só após fontes e estado relevantes existirem, implementar R4/R5 com golden vectors e decisões `NO ACTION/NO TRADE`.

## E. Segurança operacional desta proposta

- GitHub changes somente em branch candidata baseada no SHA exato aceite.
- **Sem merge, Production deploy, Supabase schema changes, Vercel env changes, broker/API financial operations nem custo cloud novo.**
- CI de docs não demonstra veracidade financeira, isolamentos A/B reais nem licenciamentos; exige auditoria do diff, fontes e requisitos na altura certa.
- Se houver divergência entre evidência em PR, DB e deployment real, a fonte operacional é o provider **no instante reconsultado**, nunca este snapshot estático.

