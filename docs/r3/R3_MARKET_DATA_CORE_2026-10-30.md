# SYNTRAKE — R3 Market Data / News: estado e plano de execução

**30 outubro 2026 — documento de acompanhamento.** O **ÚNICO documento normativo** da arquitetura e das fases R3 é [R3_CANONICAL_ARCHITECTURE_2026-10-30.md](./R3_CANONICAL_ARCHITECTURE_2026-10-30.md). Se um relatório, PR ou descrição antiga apresentar nomes/etapas diferentes, **prevalece o documento canónico**. As fases estão congeladas na tabela abaixo até uma revisão explicitamente documentada. Não reutilizar o antigo esquema R3-D=UI / R3-E=FX / R3-F=Release.

## Mandato do produto

**Estamos a desenvolver INVESTING.** Market Data, News, Fundamentals e Economics formam uma infraestrutura de dados partilhável futuramente com Trading; o Trading não está em desenvolvimento. O Investing Core deve consumir diretamente os factos canónicos para análise e monitorização autónomas, sem browser aberto. O Research Lab é opcional, **removível** e não pode ser componente obrigatório de qualquer worker/serviço financeiro ou de dados.

- Zero preços inventados, lucros fictícios, dinheiro verificado sem prova, notícias sem fonte, recomendações ou ordens automáticas.
- Um só coordenador de procura/refresh e cache para os consumidores **com os mesmos direitos**; custo/limites/licenças explícitos por fornecedor.
- O News Intelligence é um serviço de acontecimentos estruturados para o Investing, não apenas um feed do UI.
- Controlo de qualidade, fonte, direitos, horário da bolsa, UTC, datas de publicação/primeira observação e versões `as-known-at` obrigatórios.
- R0–R2 e o ledger não podem ser alterados por adapters de mercado; R2 customer launch bloqueado pelo issue #47.

## Fonte da verdade para fases R3

| Gate | Resultado | Estado em 2026-10-30 |
|---|---|---|
| **R3-0** | Arquitetura canónica, fronteiras e direitos previstos | **DESENHO REDIGIDO**, sujeito a revisão; não significa implementação |
| **R3-A** | Identidades independentes da fonte, contratos, Twelve Data adapter isolado e testes | **DRAFT / CORRECTIONS REQUIRED**; só primeira implementação provider-scoped offline testada |
| **R3-B** | Registry + histórico privado PG17, revisões, licença e proveniência | **NOT STARTED** |
| **R3-C** | Coordenador de procura, worker autónomo, leases, quota/reserva e retentativas | **NOT STARTED** |
| **R3-D** | FX, corporate actions, dados fundamentais e económicos, PIT | **NOT STARTED** |
| **R3-E** | News Intelligence factual, eventos/entidades, dedup, correções | **NOT STARTED** |
| **R3-F** | Integração Investing, análise/monitorização auditável, Lab desligado | **NOT STARTED** |
| **R3-G** | Rehearsal cumulativo R0→R3 e documentação de operação | **NOT STARTED** |
| **R3-H** | Release Production com gates e rollout separados | **NOT AUTHORIZED** |

**Nenhuma fase é fechada com build verde apenas; exige evidência operacional e negativa correspondente.** A primeira interface de leitura dos dados de mercado pode surgir por incremento dentro de R3-F; não é um R3-D alternativo.

## R3-A: o que já foi implementado e o que exige correção

**No Draft PR #49 já existe:**
- `market-data-core/identity.ts`: ações/ETFs/FX com validação, mas a chave está erradamente acoplada à Twelve Data.
- `market-data-core/twelveData.ts`: um cliente de série diária `/time_series` com datas de mercado, preços decimais de texto, qualidade básica e respostas de erro sanitizadas; o URL contém a API key como query e deve preferir header autenticado onde disponível.
- `market-data-core/gate.ts`: bloqueio por defeito, exige SHA exata no Preview e **nunca permite Production**.
- `market-data-core/refreshPolicy.ts`: política pura de frescura e orçamento, **não reserva créditos nem recolhe automaticamente**.
- Testes determinísticos e workflow próprios sem qualquer contacto real ao fornecedor. Isto **não** prova compatibilidade de todas as respostas reais, contas de fornecedores ou direitos comerciais.

**Antes do merge:** refatorar identidade em instrumento/listagem/emissor canónicos + aliases de fornecedor; adicionar contratos tipados com direitos/versões e informação de frescura; adaptar os testes, rever `/time_series` contra documentação oficial, credenciais e valores/volume nulos, corrigir o plano de ativação e executar CI. Não publicar nem criar tabelas por antecipação.

## Boundaries e não objetivos atuais

Sem migração remota Supabase, contas/bots de Trading, Research Lab ligado ao pipeline principal, Twelve Data paga/ativada, WebSocket, cron real, broker, notícias sem licença, aconselhamento automatizado, UI com preços inventados ou alteração dos flags de Production. Línguas/i18n ficam para fase posterior conforme decisão do proprietário.

**Fonte vinculativa:** [arquitetura R3 completa](./R3_CANONICAL_ARCHITECTURE_2026-10-30.md) — identidade, data lineage, News, Fundamentals, Economics, coordinator e budgets, PG17 privado, integração Investing, testes, direitos e gates.
