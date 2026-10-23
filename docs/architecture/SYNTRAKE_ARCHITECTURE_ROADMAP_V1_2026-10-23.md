# SYNTRAKE — Arquitetura & Roadmap R0–R7

**Versão:** V1.0 — CANDIDATE FOR REVIEW  
**Data do snapshot:** 2026-10-23  
**Estado:** **DECISÕES ARQUITETURAIS D1–D7 APROVADAS PELO RESPONSÁVEL EM 2026-10-23; DOCUMENTO CANDIDATO A REFERÊNCIA CANÓNICA — REVIEW E MERGE PENDENTES; SEM AUTORIZAÇÃO PARA MIGRATION/DEPLOY/EXECUÇÃO FINANCEIRA**  
**Repositório de referência:** `syntrakehq-byte/syntrake`  
**Predecessor de proposta:** `SYNTRAKE_Auditoria_Arquitetura_Roadmap_v0_2026-10-23(1).md` (auditoria read-only V0)  
**Aprovação arquitetural:** D1–D7 aprovadas explicitamente pelo responsável do projeto em 2026-10-23. Revisão independente, SHA de candidato e gate de publicação permanecem separados.  
**Alterações em sistemas externos nesta preparação:** nenhuma.

> **Princípio de controlo:** Este documento é um *candidato a contrato canónico*. Até haver revisão, candidate commit SHA, aprovação e integração controlada, a fonte de verdade operacional é o estado observado dos sistemas reais e os seus artefactos historicamente aceites, não este texto.

---

## 1. Objetivo, produto e âmbito

**Pergunta central do SYNTRAKE:** «Dada a situação real deste utilizador, os seus objetivos e o que sabemos agora, existe algo que deva fazer — e conseguimos provar porquê?»

O SYNTRAKE é um sistema **longitudinal de acompanhamento e apoio à decisão** para dois domínios isolados:

- **Investing:** construir/importar portfolios, preservar histórico financeiro, confrontar situação real e objetivos, acompanhar posições/cash/mercados e justificar `BUY`, `ADD`, `REDUCE`, `SELL`, `REPLACE`, `REBALANCE`, `APPLY NEW CAPITAL`, `HOLD CASH` ou `NO ACTION`.
- **Trading:** acompanhar mercados e trading book, identificar oportunidades, avaliar custos/risco/sizing e produzir propostas auditáveis de `TRADE` ou `NO TRADE` e, apenas quando autorizado, intenções de execução.

**Labs, backtests e simulações são opcionais.** A remoção de Research Lab não pode quebrar os fluxos essenciais de Investing ou Trading. Nem AI, nem scoring, nem backtesting são autoridade para criar saldos, preços, ordens ou confiança estatística artificial.

**Fora do âmbito desta V1:** escolha definitiva de cloud/queue/provider/broker, implementação, contratação de serviços, certificação regulatória, prova de performance de estratégias, aprovação de live trading, reinterpretação retroativa de evidências antigas. Essas decisões terão contratos e gates próprios quando forem necessárias.

## 2. Regras inegociáveis (invariantes)

1. **Autoridade derivada no servidor.** Identidade, tenant, account, portfolio, trading book, plan, entitlement e mandate não podem ser comprovados por IDs fornecidos pelo cliente. `service_role` é capacidade técnica, não autorização de operação financeira.
2. **Separação financeira Investing / Trading.** Não partilhar ledger, capital, posições, ordens, risk mandates, decisões ou autoridade de execução entre domínios. Apenas serviços de plataforma comprovadamente neutros podem ser partilhados.
3. **Financial truth explícita.** Distinguir estado `USER_REPORTED` / `UNVERIFIED` / `BROKER_CONFIRMED` ou equivalentes com proveniência. Nunca converter ausência de dados em €0, 0%, lucro, cash disponível, exposição ou retorno. Contribuição não é performance; capital planeado não é cash realizado.
4. **Ledger íntegro.** Montantes em unidades monetárias menores inteiras quando apropriado, moeda explícita, invariantes double-entry por moeda, operações atómicas e idempotentes. Nunca criar movimentos efetivos a partir de um formulário sem evento/suporte verificável e estado correto.
5. **Market truth reproduzível.** Identidade do instrumento, exchange, moeda, calendários, corporate actions, missing/stale, adjusted/raw, FX, proveniência/licença e as-of; sem look-ahead ou survivorship bias em evidência histórica.
6. **Decisões determináveis e auditáveis.** Expor dados, momento, fontes, pressupostos, versões, custos, limitações, alternativas e regras de risco. `NO ACTION` e `NO TRADE` são resultados legítimos. Nunca gerar trading por aparência de produtividade.
7. **Autonomia operacional != autorização financeira.** Jobs funcionam sem browser; ordens só dentro do mandato verificável por domínio/conta/instrumento/capital/risco/modo. Falha ou ambiguidade material => `BLOCKED`/`UNAVAILABLE`.
8. **Automação por gates.** `ADVISORY → SHADOW → PAPER/DEMO BROKER → LIVE`; nenhum salto para Live por CI verde, backtest ou opinião de AI. Kill switches, reconciliação e obrigações legais são critérios separados.
9. **Estado verificado, não memória.** Git commit exato + migration aplicada + deployment + testes + evidência externa, cada qual no seu ambiente. Não confundir `READY` da Vercel com scheduler/worker 24/7.
10. **Um writer por slice e auditoria independente.** `accepted predecessor SHA → candidate SHA`, diff real, testes proporcionais ao risco, auditoria e gate antes de merge/produção. Sem autorização expressa, nenhuma alteração a production DB, deploy, merge, rollback destrutivo ou capital real.

## 3. Arquitetura deliberada — publicação canónica pendente

```text
                       WEB / EXPERIENCE (Next.js / Clerk / billing)
                                     |
                           API / AUTHORITY GATE
                                     |
            +------------------------+------------------------+
            |                        |                        |
      SHARED PLATFORM           INVESTING CORE            TRADING CORE
      - identity verifier       - accounts/portfolios     - accounts/trading book
      - instrument registry     - positions/ledger/cash   - book/ledger/capital
      - market data adapters    - flows/holdings/income   - market state/opportunity
      - FX/data provenance      - goals/suitability       - sizing/risk/costs
      - jobs/queues/scheduler   - valuation/performance   - decision/intent
      - observability           - risk/decision           - mandate/execution
      - notifications           - mandate/execution       - reconciliation
            |                        |                        |
            +------- typed event/job contracts --------------+
                                     |
                    ADVISORY → SHADOW → PAPER/DEMO → LIVE

    Research Lab (optional consumer of Core evidence; never Core dependency)
```

**Decisão A1 — monólito modular + processos autónomos separados.** Um repositório nesta fase, com *bounded contexts*, interfaces, testes e permissões separados. Workers podem executar noutra infraestrutura/processo sem exigir repos ou microserviços distintos. Rever a topologia apenas por necessidade demonstrada (escala, isolamento, falhas ou gestão de equipas).

**Decisão A2 — compartilhamento mínimo.** Platform pode providenciar mercado/infra de jobs/logs e verificação de identidade; não pode conter um «ledger genérico partilhado» que torne capital de Investing acessível a Trading, nem transformar `service_role` numa superautorização funcional.

**Decisão A3 — backend independente da Web.** A Web apresenta e recebe intenções. Não é relógio, fila durável, autoridade de execução ou motor de cálculo financeiro contínuo.

**Decisão A4 — provider/broker adapters.** Interfaces tipadas e versionadas; falha ou substituição de fornecedor não obriga a refazer decisões históricas nem apagar proveniência.

**Estado:** A1–A4 são a formulação técnica das decisões arquiteturais aprovadas; não constituem autorização de mudanças de código, merge, migrations ou deployments.

## 4. Contratos de fronteira mínimos (sem overdesign)

### C-ID — Identity / Ownership / Entitlements / Mandates

- **Entrada:** sessão ou identidade de serviço verificada; issuer/audience/expiry/assinatura JWT verificados pela camada competente; pedido tipado.
- **Saída:** `actor`, domínio, recursos autorizados, âmbito do mandato, tipo de operação permitida ou recusa explícita.
- **Proibição:** `owner_id`, `account_id`, `tenant_id`, `plan`, `mandate` ou role vindo do browser não é prova de acesso. Claims mutáveis pelo utilizador não sustentam autorização.
- **Workers:** service identity mais autorização derivada server-side para o domínio/recurso e ação, com registo de causa e limites.
- **Testes:** sessões distintas A≠B; allow/deny e cross-tenant/cross-domain; JWT inválido/expirado/issuer errado; ausência de membership; forged identifiers; rotas/RPC/SQL diretos; função privilegiada auditada.

### C-FIN — Financial State / Ledger / Portfolio

- **Estado:** contas e portfolios vivos; posições/lot, cash por moeda, transações, cash flows, fees/taxes, FX, income, contribuições realizadas e planeadas, restrições/objetivos, decisões e alterações.
- **Proveniência:** origem, identificador externo quando disponível, estado de confirmação, timestamp/as-of, evento/versão, correções por novos movimentos auditados (não apagar história).
- **Sem fontes reais:** guardar declarações como declarações; não criar operações broker-confirmed nem cash investível presumido.
- **Contabilidade:** balanço double-entry por moeda, atomicidade, idempotência e concorrência comprovadas; tratamento explícito de inconsistências e reconciliação.
- **Testes:** golden vectors de money/FX/flows; operações concorrentes; replay; invariantes contabilísticos; A/B isolation; não confundir depósitos com retorno; reconciliação negativa.

### C-MKT — Market Data / Instruments

- **Contrato de entrada:** instrumento canónico (identificador+exchange+moeda+tipo), provider, instante de observação, hora/mercado/sessão, frequência, raw/adjusted e metadados.
- **Contrato de saída:** série ou observação com preço/FX validado, qualidade, provider, `as_of`, licença, versão e estado `REAL | STALE | ESTIMATED | SIMULATED | DEMO | UNAVAILABLE`, conforme aplicável.
- **Sem invenção:** `UNAVAILABLE` não vira preço zero; dados stale não são fresh; diferentes bases de ajustamento não se misturam silenciosamente.
- **Histórico Investing:** preferencialmente 1D; 1W/1M deriváveis; intraday quando necessário. Point-in-time e custos nos estudos históricos.
- **Testes:** instrumentos homónimos, timezone/calendars/feriados, FX em falta, split/dividend, delisting, buracos, retries/limites, legal/licenciamento, as-of e ausência de look-ahead.

### C-JOB — Continuous Operations

- **Contrato:** `job_type`, recurso autorizado, payload validado e versionado, `idempotency_key`, schedule/due-time, lease/attempt, estado e rastos, correlação, versão executável.
- **Sem browser:** agendamento/execução/retry funcionam mesmo sem sessão web e recuperam após falha ou restart; filas duráveis e observáveis.
- **Safety:** workers não ganham propriedade sobre portfolios por terem acesso à base; queue payloads não são mandatos; barreiras anti-duplicação e concorrência definidas para efeitos materiais.
- **Primeira prova:** tarefa inofensiva com execução persistida, falha induzida, retry, replay e recuperação, depois prova A/B de isolamento; nenhuma ordem, saldo ou preço artificial.

### C-DEC — Decisions / Recommendations

- **Input mínimo:** snapshot financeiro ou trading-book validado, objetivos/risco/restrições, mercado com as-of e qualidade, universo elegível, custos, versão e assumptions explícitos.
- **Output:** `action | NO_ACTION | NO_TRADE | BLOCKED | UNAVAILABLE`, alternativas consideradas, razões, efeitos previstos sem falsas probabilidades, fontes, limitações, validade temporal e gate de adequação/mandato.
- **AI:** pode interpretar e explicar; cálculos financeiros/risk/authority determinísticos permanecem verificáveis sem AI.
- **Registo:** decisões imutáveis/versionadas e ligação inequívoca aos inputs utilizados; não reescrever decisões anteriores quando os dados mudam.

### C-EXEC — Execution Modes / Broker

- **Separar:** recomendação, intenção, ordem enviada, acknowledge/reject, fill parcial/final, fees, posição reconciliada e falha operacional.
- **Paper/demo:** broker sandbox verdadeiro (quando disponível), idempotência, rates/limits, reconciliação, falhas e diferenças esperado/observado; dados de demonstração nunca confundidos com fundos reais.
- **Live:** mandato expresso e revogável, limites quantitativos, instrument/account allowlists, kill switch, controls pré e pós trade, auditoria e requisitos regulatórios. Ambiguidade => não emitir ordem.

## 5. Roadmap R0–R7: entregáveis e gates

> Os rótulos R0–R7 são **IDs de capacidades nesta V1**, não renomeações retroativas dos PRs, migrations ou contratos históricos. Uma fase pode ter vários slices e gates específicos. `PASS CI` não é `ACCEPTED`.

| ID | Capacidade / resultado verificável | Dependências técnicas mínimas | Gate de saída | Estado ao snapshot |
|---|---|---|---|---|
| **R0** | Identidade, autorização e isolamento financeiro | Clerk, auth gate, RLS, ownership derivado | A≠B real, caminhos legítimos e acessos indevidos negados, regressão HTTP/RPC/SQL | **PARTIAL global** (login básico provado) |
| **R1** | Fundação Investing account/ledger/read-only | R0 ownership + PG17 | Invariantes money/ledger/atomicidade/idempotência, grants/RLS; deployment e schema por SHA | **ACCEPTED só escopo técnico readonly** |
| **R2** | Portfolios vivos, onboarding, import, posições/cash/flows/objetivos/provenance | R0/R1; C-MKT instrument identity na valorização | `import → persist → read`, reconciliação e distinção UNVERIFIED/BROKER_CONFIRMED; A/B real e histórico correto | **CANDIDATE / PARTIAL** |
| **R3-A** | Scheduler/queue/worker autónomo, leases, retries, alarmes | C-ID service authority + storage de jobs | Execução offline, crash/restart/retry/idempotência, logging e A/B, sem intervenção web | **MISSING no stack auditado** |
| **R3-B** | Market Data Core + adapters, instruments/1D/FX/provenance | C-MKT + credenciais/limites/licenças verificadas | Preços/FX reais, as-of, stale/missing, limits, calendar/splits, sem look-ahead | **MISSING no stack auditado** |
| **R4** | Investing allocation/valuation/performance/risk/suitability/decision | R1, R2 relevante, C-MKT; C-JOB para modo contínuo | Golden vectors, cash-flow≠retorno, alternativas e `NO ACTION` fundamentados, rastos e processamento agendado | **MISSING** |
| **R5** | Trading book, market state, opportunity, risk/sizing/costs/decision | R0, C-MKT; C-JOB para modo contínuo; **não depende de R4 nem do ledger Investing** | Estados/riscos negativos, `NO TRADE`, limites, intent sem ordem real e isolamento de mandato | **MISSING** |
| **R6** | Advisory→Shadow→Paper/Demo, por domínio | R4 **ou** R5 aprovado no respetivo domínio, C-JOB, C-EXEC | Forward runs, rejects, fills, idempotência, recovery, reconciliation, custos e rastreabilidade | **MISSING** |
| **R7** | Live controlado, por domínio/mandato | Gate R6 do domínio, C-EXEC, conformidade aplicável | Segurança, mandato explícito, kill switches, reconciliations, recovery, evidência operacional e autorização de release | **BLOCKED por design** |

### 5.1 Dependências como grafo, não sequência rígida

```text
R0 ──> R1 ──> R2 ────────────────> R4 Investing ──┐
 │          │                         ^            │
 ├──> R3-A Continuous Operations ───┤            ├─> R6 (por domínio) ─> R7 (por domínio)
 │                                   │            │
 └──> R3-B Market Data Core ─────────┘            │
             └───────────────> R5 Trading ────────┘

Nota: R5 depende de R0 e C-MKT; modo operacional contínuo de R5 requer C-JOB/R3-A.
R3-B adapter pode ser desenvolvido/testado sem worker; R3-A worker inofensivo sem Market Data.
```

**Implicação de execução:** fechar R0/R1/R2 candidatos em segurança é prioridade de release, mas contratos e slices isolados R3-A/R3-B podem ser preparados independentemente, sem promover as migrations de R2 e sem bloquear desnecessariamente o Trading. R4 e R5 não precisam de começar ao mesmo tempo.

### 5.2 Provas de produto (não só infraestrutura)

**Investing — já possui portfolio:** importar/declarar, validar titularidade e proveniência, identificar lacunas, reconciliar quando possível, acompanhar movimentos/valor/risco, decidir e justificar `NO ACTION` quando apropriado. Até verificação real, mostrar claramente estado declarado.

**Investing — ainda não possui portfolio:** caracterizar capital disponível **confirmado ou declarado distintamente**, objetivos, horizonte, tolerância/capacidade de risco, restrições e contribuições planeadas; construir alternativas; explicar suitability e custos; apresentar proposta não executada; persistir e acompanhar a evolução quando o utilizador autoriza.

**Trading:** mercado e book com truth diferenciada; oportunidade e sizing determinísticos; custos/risk; capacidade de não negociar; Shadow/Paper antes de Live. Ganho financeiro ou edge não se presume pela existência de engines.

## 6. Registo do estado operacional — snapshot 2026-10-23

Os dados nesta secção são históricos e **não atualizam automaticamente**. Toda utilização futura exige refrescar os sistemas externos. Estados referem-se ao âmbito efetivamente observado.

### 6.1 GitHub e release lineage

| Elemento | Estado observado | Evidência / restrição |
|---|---|---|
| `main` | `d42ecf58ca46c0e33d866cced2cdf14aa36eced0` | baseline aceite no âmbito anterior; PRs seguintes ainda Draft |
| PR #20 / R2-A | Draft; `ed8c30a3a25d03fbba1f27009f21c4772034b549` | base `main@d42ecf…` |
| PR #21 / R2-B1 | Draft; `d3cc2022b5ee9acd3012888cc85c2627f1ce0a9d` | base `#20@ed8c30…` |
| PR #22 / R2-C | Draft; `2f6467065a854ff90c08783a347b01eb0b81672a` | base `#21@d3cc20…` |
| PR #23 / R2-C2 | Draft; `26170947e4a126ef898de857f6ee2e13ae657f22` | base `#22@2f6467…`; 7/7 GitHub workflows success; sem aprovação independente total |

**Regra stacked:** auditar diff de cada PR contra a base exata e diff cumulativo contra o predecessor aceite. Uma alteração de base/merge/rebase muda o SHA auditável e invalida as aprovações que dependiam da árvore anterior até à devida revisão. Não promover uma migration só porque uma branch sucessora tem CI verde.

### 6.2 Supabase

- **Production:** `vbazzxqyuqcrmjytaboc`; migrations registadas `20261017191056 remote_schema`, `20261020180000 investing_first_readonly_release`. Relatório V0: 9 tabelas Investing; sem registos de contas/portfolios/ledger observados nesse instante. Esta contagem **não significa cash zero**.
- **Preview:** `zkqgpejlkgootkvkebhd`; 12 migrations (incluindo R2-B1/R2-C/R2-C2 e respetivas correções forward-only); relatório V0: 15 tabelas e dados sintéticos/de ensaio.
- **Security finding confirmado em leitura:** `authenticated_security_definer_function_executable` para `investing.provision_first_portfolio(...)`; severidade WARN. EXECUTE intencional para `authenticated` pode ser necessário para o onboarding, mas **warning não é prova de vulnerabilidade nem prova de segurança**. Até auditoria de assinatura/claims/owner/search_path/ACL/RLS/Data API e A/B negativo: **BLOCKED para promover R2-C2**.
- **Drift de environments:** Preview e Production não têm a mesma história de migrations. Exige plano explícito, rehearsal e auditoria de PG17/RLS para qualquer promoção. Não editar versões já aplicadas, não `db push` indiscriminado.
- Diferença de acesso material segundo V0: `authenticated` possui SELECT sobre ledger entries em Preview, não em Production. Avaliar intenção e impacto antes de igualar; não propagar grants por cópia.

### 6.3 Vercel

- Projeto `syntrake` (`prj_JLOTCtdLdHfFDCj7GhUaf9NdVQEC`): deployment Production `dpl_2Lh5ZP2iEViPtb3ikjdoVFTTpbV3` **READY**, SHA `d42ecf58…`, com alias `www.syntrake.com`.
- Preview R2-C2 `dpl_3VhuWt4yQvu7RZkRewqVzcvy1Vuo` **READY**, SHA `26170947…`.
- `READY` comprova resultado de build/deployment, não prova pagamento Stripe Live, broker, motor financeiro ou processos autónomos 24/7. Relatório V0 não encontrou scheduler/queue/workers nem integração Twelve Data neste stack.

### 6.4 Ledger de capacidades (registo provisório)

| Capacidade | Estado | Condição decisiva que falta |
|---|---|---|
| Login UI/Clerk básico | ACCEPTED (escopo limitado) | Isolamento real integrado ainda por provar |
| Autorização e RLS A≠B | PARTIAL | Sessões reais distintas e vias negativas incl. RPC |
| Ledger/fundação readonly R1 | ACCEPTED (escopo limitado) | Não representa portfolio vivo reconciliado |
| First-account/first-portfolio RPC R2-C2 | CANDIDATE / BLOCKED promotion | finding SECURITY DEFINER, A/B, lineage e migration rehearsal |
| Onboarding R2-C | CANDIDATE | evidência funcional completa e integração segura |
| Import parser R2-A e snapshots R2-B1 | PARTIAL / CANDIDATE | ligação end-to-end, correções, reconciliação e read |
| Market Data Core/Twelve Data | MISSING no stack | implementação e prova de provider/qualidade |
| Worker/scheduler/queue | MISSING no stack | execução independente + recuperação e isolamento |
| Investing analysis/decision | MISSING | motor + market/financial truth + provas |
| Trading Core/decision | MISSING | book e risk próprios + provas |
| Research Lab | OUT OF SCOPE intencional | não é dependência |
| Shadow/Paper | MISSING | broker e forward verification |
| Live | BLOCKED por design | provas/mandatos/legal/gates específicos |

**Estados controlados:** `ACCEPTED` (sempre com escopo), `CANDIDATE`, `PARTIAL`, `MISSING`, `BLOCKED`; distinguem-se de qualidade dos dados (`REAL`, `STALE`, `ESTIMATED`, `SIMULATED`, `DEMO`, `UNAVAILABLE`) e de status operacional do sistema. O registry é **append-only na evidência histórica**, mas o apontador `current` poderá evoluir com revisão e SHA.

## 7. Gates — definição de terminado

### G0 — Contrato mínimo por slice

Um candidate só segue para implementação quando tem ID estável, objetivo/exclusões, predecessor SHA, invariantes afetadas, fronteiras auth/financial/market, riscos irreversíveis, outputs verificáveis e plano de testes proporcional. Não exigir especificação exaustiva de módulos inofensivos.

### G1 — Implementação candidata executável

Código, types/validadores, migrations versionadas quando necessárias, fixtures/golden vectors, testes unit/integration e falhas negativas. Um único writer por slice. Não fazer correções ad hoc em ambientes externos fora da cadeia Git→review→release.

### G2 — Auditoria independente

Verificar lineage real, diff, fontes, controlo de privilégios, RLS/tenant, matemática/ledger/FX conforme escopo, CI, mudanças de baseline, evidência positiva e negativa, estado do Preview e limitações. Codex pode construir mas não autoaprovar.

### G3 — Gate de merge (Git)

Revisor aceita **candidate SHA exato**, riscos mitigados, documentação `current` atualizada, PR não Draft segundo processo acordado, nenhum failure novo. Merge só após autorização pertinente; mudança de SHA implica nova verificação proporcional.

### G4 — Gate de Production, separado

Revisão migration/source SQL exata, plano de impacto e rollback operacional (sem falsificar histórico), rehearsal em PG17/RLS, comparação grants/policies/functions, confirmação destino, versão e backups, deployment vinculado a SHA aceite, testes pós-release e autorização explícita. Falhas/contradições => **BLOCKED**.

### G5 — Gate financeiro/execução

Antes de Paper: autoridade de domínio, precisão/risk, idempotência/reconciliation, negative/recovery tests e provider confirmado. Antes de Live: evidência forward suficiente, mandato explícito, controlos e obrigações legais; aprovação separada por domínio e ambiente.

## 8. Plano de execução proposto — autorização de cada slice separada

| Prioridade | Slice / tarefa | Resultado verificável | Bloqueia |
|---|---|---|---|
| **H1.1** | Rever V1 e criar **um** índice `current` no Git | referência versionada com decisões, SHA, estados, supersedes e links para evidência | Governo canónico de novos slices |
| **H1.2** | Revisão R2-C2 RPC/security | relatório técnico: grants, owner, SECURITY DEFINER, JWT, SQL injection/search_path, A/B neg., bypass, Data API e remediação/risco residual | Aprovar PR #23/DB promotion |
| **H2.1** | R0 identidade real A≠B | duas sessões Clerk independentes; assert allow own e deny other por UI/API/RPC/DB | Fecho global R0 e R2 |
| **H2.2** | PRs #20–#23 por lineage | auditoria de cada diff e cadeia; matriz migration Preview→Production; estado de provas exato | Qualquer merge/Production |
| **H2.3** | Revisão readonly Production / docs | reconciliar grants, rota e gates R1 Production; indexar docs históricos sem os alterar retroativamente | Release safe e terminologia |
| **H3.1** | R3-A worker inofensivo | job durável agendado, execução/restart/retry idempotente e alertas, sem browser, sem financial mutation | Automação contínua |
| **H4.1** | R3-B primeiro adapter de mercado | instrumento+1D+FX+as-of+source/quality, missing/stale/retry/licença | Valuation e market-state fiáveis |
| **H5** | R2 financial truth viva + R4/R5 separados | portfolios e motores auditáveis, iniciando pelos contratos mínimos e provas | R6 e R7 |

**Sequência imediata escolhida:** terminar H1.1 (revisão humana desta V1) e preparar o gate H1.2 em read-only. **Não abrir novo desenvolvimento enquanto a governança e as decisões materiais não estiverem fixadas.** H3/H4 são os próximos slices de capacidade depois de estabilizar os bloqueios de segurança/release existentes.

## 9. Governança documental e compatibilidade com trabalho histórico

1. **História imutável:** V0, provas anteriores, nomes de migrations e PRs permanecem tal como ocorreram. Documentos antigos não são «corrigidos» para fingir que já previam fases atuais.
2. **Índice `current`:** aponta para (i) roadmap aprovado e SHA, (ii) estado por capacidade+escopo, (iii) candidato e predecessor, (iv) dados externos verificados/as-of, (v) gate e blockers. Só o índice vigente se apresenta como estado atual.
3. **Supersession explícita:** qualquer versão futura declara quais contratos/decisões substitui. Nunca substituir silenciosamente evidência ou identificadores históricos.
4. **Mudanças arquiteturais:** registrar uma decisão curta e material (ADR) quando alterar isolamentos, financial/market truth, concorrência/idempotência, hashing/provenance, migrações, brokers ou mandatos. Evitar ADRs burocráticas sobre detalhes reversíveis.
5. **Uma verdade para chats e builders:** instruções de execução citam `document version + approved SHA + current accepted predecessor SHA`, nunca «segundo o outro chat» nem um screenshot como substituto de source real.

## 10. Decisões arquiteturais D1–D7 aprovadas — publicação canónica pendente

| Código | Decisão | Proposta V1 | Estado |
|---|---|---|---|
| D1 | Estrutura de código | Monorepo modular com fronteiras e workers independentes da Web | APPROVED — architectural scope, 2026-10-23 |
| D2 | Isolamento | Auth/market/ops partilháveis; financial state/mandates/decisions/execution separados | APPROVED — architectural scope, 2026-10-23 |
| D3 | Fases | R0–R7 como DAG; R3-A/R3-B separadas; R6/R7 por domínio | APPROVED — architectural scope, 2026-10-23 |
| D4 | Verdade financeira | Ledger longitudinal; importação `UNVERIFIED` não equivale a cash/portfolio broker-confirmed | APPROVED — architectural scope, 2026-10-23 |
| D5 | Autonomia | Primeiro provar worker inofensivo; depois produção de dados, análise e ações dentro de mandatos | APPROVED — architectural scope, 2026-10-23 |
| D6 | Governança | Registry único por SHA/ambiente/gate; Codex builder≠reviewer; Production separada | APPROVED — architectural scope, 2026-10-23 |
| D7 | Risco pendente | PR #23 SEC DEFINER e R0 real A/B devem ser auditados antes da promoção | APPROVED — architectural scope, 2026-10-23 |

**Critério para tornar a V1 canónica:** as decisões D1–D7 já foram aceites explicitamente pelo responsável em 2026-10-23; faltam candidato versionado no Git, review independente de conteúdo/compatibilidade, gate de publicação e aprovação de merge pelo SHA exato. A aceitação arquitetural **não** autoriza merges de PRs anteriores, migrations, deploys, trading ou Live.

## 11. Evidência e limites do snapshot

**Fonte primária:** Relatório `SYNTRAKE — Auditoria de arquitetura, dependências e proposta de roadmap R0–R7`, snapshot 2026-10-23, auditoria em leitura, classificado V0 não canónico. A presente V1 preserva a distinção entre **factos observados no relatório** e **decisões arquiteturais aqui propostas**.

**Read-only revalidado através dos conectores em 2026-10-23:**

- GitHub: PRs #20/#21/#22/#23 abertos Draft sem merge, bases e heads conforme V0; `main` mais recente no histórico consultado `d42ecf…`; candidate #23 7/7 workflow runs `success`.
- Supabase: migrations Production (2), Preview (12); Advisor Preview `authenticated_security_definer_function_executable` para `investing.provision_first_portfolio` (WARN).
- Vercel: Production e Preview deployments específicos `READY` nos SHAs indicados.
- GitHub `README.md` em `main` descreve prioritariamente landing/account; `investing-core/README.md` contém afirmações de release históricas que requerem um índice `current` (não apagar nem reinterpretar).

**Não revalidado nesta preparação:** auditoria integral do SQL/código de todos os PRs, ensaios Clerk A/B reais, execução de workers, provas Stripe Live, brokers, licenciamento Twelve Data, conteúdo integral de dashboards/performance advisors e todas as claims de estado operacional de V0. Não converter estes limites em afirmações absolutas de inexistência global.

**Referências GitHub:**

- [`main@d42ecf58`](https://github.com/syntrakehq-byte/syntrake/commit/d42ecf58ca46c0e33d866cced2cdf14aa36eced0)
- [PR #20](https://github.com/syntrakehq-byte/syntrake/pull/20) · [PR #21](https://github.com/syntrakehq-byte/syntrake/pull/21) · [PR #22](https://github.com/syntrakehq-byte/syntrake/pull/22) · [PR #23](https://github.com/syntrakehq-byte/syntrake/pull/23)
- [`#23@26170947`](https://github.com/syntrakehq-byte/syntrake/commit/26170947e4a126ef898de857f6ee2e13ae657f22)
- [Supabase Security Advisor lint 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

---

### Registo de revisão V1

- **Autor da proposta:** arquitetura técnica em sessão de preparação de 2026-10-23.
- **Review independente V1:** PENDENTE.
- **Decisão do responsável:** D1–D7 aprovadas em 2026-10-23, com autorização para criar branch e PR documental **sem merge**.
- **Candidate Git commit SHA:** consultar o head SHA do PR documental, que é a fonte de verdade; não fixar um SHA autorreferencial dentro do próprio ficheiro.
- **Canonical approved SHA:** NÃO EXISTE para esta V1.
- **Alterações autorizadas após a elaboração original:** criação de branch, commit e PR exclusivamente documentais no GitHub; sem merge, Supabase DDL/DML, deploy ou execução financeira.

**Estado do candidato:** `DOC_PR_REVIEW_REQUIRED` — nenhuma autorização de merge/deploy/financial execution decorre deste documento.