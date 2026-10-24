# SYNTRAKE — Contrato de rehearsal Supabase por fase R0–R7

**Data:** 2026-10-24. **Estado:** CANDIDATE — revisão necessária antes de integrar na `main`.  
**Regra solicitada pelo proprietário:** após completar cada fase Rn, executar **dois ensaios independentes por âmbito** antes de aceitar a fase: (1) rehearsal de Rn e (2) rehearsal cumulativo R0→Rn. Não confundir PASS de CI com rehearsal remoto.  
**Predecessor da proposta:** `main@29f1c068769e34a84e87717ac8cc9286dd937938`.  
**Repetir apenas fases novas:** R0 e R1 mantêm as aceitações técnicas anteriores; serão reexercitados no rehearsal cumulativo de R2. Não se exige reabri-los automaticamente sem risco novo.

## 1. Fases, ordenação e condições para executar

| Quando o slice/fase está candidato a fecho | Rehearsal específico (Rn) | Rehearsal cumulativo |
|---|---|---|
| **R2** (portfolios vivos) | R2-E2E: `import/construir → persistir → ler → corrigir → reconciliar quando possível`, ownership, precisão, transações/isolamento e financial truth | **R0→R2:** Clerk A/B JWT efetivos no endpoint/SQL autorizado + R1 ledger/ACL/RLS + R2 ambos os percursos financeiros, concorrência, regressões negativas |
| **R3-A** (operations) | Jobs sem browser, leases, crash, replay, retry, alerta e isolamento de autoridade | R0→R3-A: R0/R1/R2 + R3-A; não simular que R3-B já existe |
| **R3-B** (market data) | Instrument Master/adapter, 1D/FX, quality, quotas, corp actions, rights e as-of sem leakage | R0→R3-B: fases/capacidades realmente aceites, incluindo R3-A caso aceite; verificar integração R2 e preço/cash sem inventar |
| **R4** (Investing analysis/decision) | Golden vectors de valuation/performance/risk/suitability e `NO ACTION`, faltas/stale/custos | R0→R4: reexecutar gates aceites e journey Investing end-to-end |
| **R5** (Trading decision) | Trading book isolado, sizing/custos/risco, `NO TRADE`, provenance; testar sem depender de Investing R4 | R0→R5: regressões de todos os gates aceites até R5, mais cross-domain isolation |
| **R6** (Advisory/Shadow/Paper) | R6 por domínio, provider sandbox verdadeiro, order events, rejects/fills, reconciliação e kill switch | R0→R6: regressão de identidades/ledger/dados/engines/ops/execução; nenhum capital real |
| **R7** (Live readiness) | **Ensaio sem envio de ordens reais**, mandato, acesso broker, fail-closed, recovery, kill switches, compliance; autorização Live separada | R0→R7: regression integrada de tudo que foi aceite; rehearsal não autoriza ativação Live |

**Não-linearidade:** R3-A/R3-B são independentes e podem ser aceites em ordem diferente. Um ensaio cumulativo só declara cobertura de capacidades efetivamente implementadas e aceites na fotografia do SHA; nunca afirma que R5 é dependência de R4 nem que R7 Live foi exercido com dinheiro.

## 2. Definição rigorosa dos dois ensaios

### A. Rehearsal específico da fase — `R<n>_PHASE`

- Carrega **baseline técnico real exigido** pela fase, por exemplo R0/R1 para testar R2; «específico» significa que as asserções principais são próprias de R2, não que R2 executa sobre DB vazia.
- Exercita happy paths e negativos com as mesmas interfaces de produção, sem mocks onde o gate exige verdade externa.
- Separa claramente `POSTGRES_17_ISOLATED`, `SUPABASE_BRANCH_REAL`, `SYNTHETIC_TEST_FIXTURE`, `REAL_CLERK_JWT`, `BROKER_DEMO` e `PRODUCTION_READ_ONLY` nos resultados.
- Produz relatório imutável associado a candidate SHA, migration set/sums, fixture version, provider/ref, instante de execução, evidence, cleanup e falhas residuais.

### B. Rehearsal cumulativo — `R0_TO_R<n>_CUMULATIVE`

- Exercita **novamente** gates R0/R1/.../Rn relevantes ao SHA candidato, não apenas «aproveita PASS do rehearsal R2».
- Valida **interações entre fases**: autenticação→persistência→readback, ledger→cash/positions→valuation→decision→notification; broker/ordem apenas nos modos aprovados.
- Inclui A/B **real com duas identidades independentes** para as rotas/RPCs cujo gate o requer; testes SQL com `SET request.jwt.claim...` são testes sintéticos, **não** substitutos da assinatura Clerk.
- Garante regressões de autorização, grants, RLS, `SECURITY DEFINER`, integridade, idempotência, concorrência e dados `UNKNOWN` em todos os contextos que toca.
- O gate é **separado** do de Rn: `R<n>_PHASE=PASS` e `R0_TO_R<n>_CUMULATIVE=PASS` devem existir ambos, ou Rn continua `BLOCKED/PARTIAL`.

## 3. Segurança, custo e ciclo de vida do Supabase

1. Antes de qualquer Supabase branch computacional, verificar project-ref e **organização de destino real**, migration registry Production/Preview, estado de branches existentes e a estimativa **atual** de custo indicada pela própria plataforma.
2. **Pedir autorização explícita do custo antes de criar branch/consumir novos recursos**. Uma autorização passada não serve para branches futuras ou novo preço; indicar compute/hora + custos adicionais potenciais. Caso o serviço exija confirmação interativa própria, aguardar essa confirmação.
3. Criar ambiente **descartável, isolado, sem dados pessoais de Production**, preferencialmente branch temporária vinculada ao projeto certo. Fixar PG major (PG17), schema/extension roles e migrations específicas.
4. Reconciliar **histórico e hashes de migrations** do Git aceite vs Production; não usar `db push` cego, não aplicar migrations sobre o projeto errado e não «corrigir» migration drift silenciosamente.
5. Fazer rehearsals **sem effects financeiros reais**. Só dados sintéticos na branch. Nunca provar uma contribuição criando transação real do utilizador.
6. Produzir relatório `phase` e depois relatório `cumulative`. Entre suites, limpar **apenas fixtures sintéticas e isoladas** ou recriar ambiente, preservando prova de cleanup, sem alterar Production.
7. Executar verificações negativas de falha parcial, rollback, replay, race e ownership. Integrações externas não ensaiáveis (Clerk JWT real, broker demo, licenças) ficam `UNVERIFIED/BLOCKED` em vez de PASS.
8. Depois das provas e com as condições de teardown autorizadas, **apagar a branch descartável**, fazer readback que confirma ausência e registar compute/custo conhecido. Se a branch já existia e pode ter outras dependências, **não** a apagar sem identificar ownership/finalidade; não criar limpeza destrutiva «automática» em Production.
9. Se uma das suites falhar, Rn **não é aceite**; corrigir em novo candidate SHA, repetir gates afetados e os dois rehearsals desse SHA. A documentação histórica conserva os resultados anteriores, não os reescreve.
10. **Production é outro gate**: rehearsal PASS não executa DDL/DML de Production, deploy, broker live nem merge; cada mudança exige diff, revisão independente, autorização explícita e readback.

## 4. Invariantes comuns obrigatórios

- `actor_A` não lê/escreve contas, imports, posições, ledger, broker credentials, books ou dados do `actor_B`, mesmo com IDs de B.
- `service_role` ou job capability não equivale a ownership/mandato; definer RPC não pode ignorar authority. Claims SQL artificiais não são logins reais.
- `UNAVAILABLE` nunca vira 0; import `UNVERIFIED` não cria saldo broker; dividendos, cash flows, FX e retornos não misturados.
- Migrations aplicadas no ambiente correto, atomicidade, unique keys, data races, fail closed, retries e reconciliação.
- Falha do provedor/preço obsoleto, contrato de licença ou mandato = decisão `BLOCKED` (não uma ordem, transação ou valor inventado).
- O mais pequeno erro material novo face à baseline anterior impede promoção; não há passagem por «quase tudo verde».

## 5. Evidência exigida em cada fecho

Registo versionado na PR/repo com, pelo menos:

| Campo | Obrigatório |
|---|---|
| Gate IDs | `R<n>_PHASE`, `R0_TO_R<n>_CUMULATIVE` |
| Candidate SHA e predecessor SHA | Sim, exactos e consultados em GitHub |
| Supabase source project-ref, branch-ref e IDs | Sim, com ambiente exato e sem segredos |
| Postgres version, release schema, registry e migration checksums | Sim |
| Actor A/B source real/synthetic | Sim, distinguir claramente |
| Fixtures e evidência de financial/market truth | Sim, sem declarar €0 por falta de dados |
| Test vectors, comandos invocados, CI e external proof | Sim, com resultados e limitações |
| Costs | Custo autorizado, preço hora confirmado, custo final observado ou `UNAVAILABLE` |
| Teardown | Delete/readback da branch isolada ou motivo documentado para retenção |
| Gate reviewer e owner authorization | Sim, sem autopromoção de builder |

**Regra de saída:** `ACCEPT_Rn = audited_candidate_sha ∧ existing_gates ∧ phase_rehearsal_PASS ∧ cumulative_rehearsal_PASS ∧ cleanup_verified ∧ explicit_acceptance`. Para release Production, aplicar gate de produção adicional. Estas expressões são política proposta, não triggers reais já instaladas.

## 6. Estado em 2026-10-24 (leitura de Supabase, sem writes)

- Projeto Production encontrado: `vbazzxqyuqcrmjytaboc`, região `eu-west-3`, PostgreSQL 17.11.
- Migrations Production presentes: `20261017191056 remote_schema` e `20261020180000 investing_first_readonly_release`.
- Branch **pré-existente** `investing-r0a-rehearsal`, ref `zkqgpejlkgootkvkebhd`, reportada `ACTIVE_HEALTHY`, não persistente. **Não apagar automaticamente**: pode conter estado Preview de outros PRs; identificar dependências e custos primeiro.
- **Não foi criada** nenhuma branch e **não houve** execução SQL ou custo de rehearsal nesta alteração.
- Em 24/10/2026 a documentação Supabase indica branch Micro a partir de US$0.01344 por hora **mais outras utilizações**; é exemplo informativo, **não preço personalizado nem autorização**. Verificar novamente no momento de cada rehearsal.

**Fonte de política Supabase:** https://supabase.com/docs/guides/platform/manage-your-usage/branching .  
**Fonte de funcionamento de branches:** https://supabase.com/docs/guides/deployment/branching .

Este contrato serve o requisito «após cada R, rehearsal da fase + rehearsal completo R0→R» sem inventar resultados antecipados e sem desrespeitar autorizações de custo e Production.
