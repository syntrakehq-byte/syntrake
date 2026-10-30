# SYNTRAKE — R3 CANONICAL ARCHITECTURE v1
**30 outubro 2026 · desenho de engenharia · PR #49 (Draft) · INVESTING em desenvolvimento**

> **ESTADO:** documento de arquitetura, **não** implementação completa nem autorização de deploy. R3-A é apenas um adaptador Twelve Data e contratos em Draft. R3-B…R3-H abaixo são trabalho por executar. Production R0–R2 permanece protegida. Nenhuma integração externa, migração de base de dados ou consumo de créditos foi autorizado por este documento.

## 0. Decisões vinculativas do produto

1. **Produto atual: INVESTING.** Market Data e News são infraestrutura transversal, projetada para poder servir Trading no futuro, **sem desenvolver Trading agora**. Nenhum sinal de execução, bot, ordem, estratégia ou broker real faz parte do R3.
2. **Investing Core é o consumidor operacional.** Preços, FX, acontecimentos, informação fundamental e económica chegam ao Investing Core por contratos estáveis e verificáveis; não ficam confinados a páginas de visualização.
3. **Research Lab é opcional/removível.** Pode futuramente consumir históricos e executar backtests/paper em broker demo, mas **não é dependência do Investing Core**, do News, do Market Data ou dos serviços autónomos. Remover o Lab não interrompe os processos principais.
4. **Uma recolha, múltiplos consumidores permitidos.** Agregação de procura, cache e deduplicação centralizados reduzem chamadas redundantes. Partilha só quando a licença, mercado, frequência e direitos do dado o autorizam. **Não há promessas de chamadas gratuitas.**
5. **Os fornecedores são substituíveis; os factos não são inventados.** Nunca confundir um símbolo de um fornecedor com a identidade de um instrumento; nunca apresentar dados ausentes como zero, atrasados como live, reportados pelo utilizador como verificados, opinião de IA como facto ou notícias duplicadas como acontecimentos independentes.
6. **Autonomia em segundo plano, nunca no browser.** Ingestão, validação, atualização e monitorização são jobs server-side recuperáveis. Uma sessão Clerk/browser não é necessária para os workers; identidade de utilizador continua obrigatória para acesso a dados privados.
7. **Sem operações financeiras automáticas no R3.** Adaptadores públicos não escrevem no ledger R0–R2, não alteram posições nem criam transações; as declarações de capital e posições importadas mantêm o respetivo estado UNVERIFIED/PARTIAL até existir verificação externa.
8. **Fail closed e orçamento por fonte.** Falta de autorização, dados contraditórios, licença não aprovada, orçamento esgotado ou erros de fornecedor → estado explícito de indisponibilidade, não extrapolação silenciosa.

## 1. Arquitetura lógica — fluxo de dependências

```text
FONTES EXTERNAS (contratos e permissões próprias)
├─ Preços/FX/corporate actions ─ Twelve Data; outros adapters futuros
├─ Informação fundamental  ───── SEC/filings; dados ESEF/XBRL ou licenciados
├─ Economia e calendários  ───── ECB, Eurostat, FRED/ALFRED; outros
└─ Notícias/comunicados ──────── fontes oficiais e fornecedores licenciados
                         │
                         ▼
            DATA PLATFORM  (núcleo comum)
 ┌──────────────────────────────────────────────────────────────────┐
 │ Source Catalog + License Policy + Provider Adapters              │
 │ Instrument & Issuer Registry (identidade CANÓNICA própria)       │
 │ Demand Coordinator / Scheduler / Credit Reservation / Retry     │
 │ Market Data   │ Fundamentals   │ Economics   │ News Intelligence │
 │ Validation + Provenance + PIT Versions + Quality + Storage      │
 │ Read API interna versionada + outbox de acontecimentos          │
 └──────────────────────────────────────────────────────────────────┘
                         │
              Observações canónicas
              com evidência e direitos
                         │
                         ▼
                 INVESTING CORE
 ┌──────────────────────────────────────────────────────────────────┐
 │ associação segura aos instrumentos e portefólios do proprietário│
 │ exposição, acompanhamento, objetivos, horizonte e risco         │
 │ análise factual, hipóteses, incerteza e alertas auditáveis        │
 │ snapshots e recuperação de jobs; SEM escrita no ledger por feeds│
 └──────────────────────────────────────────────────────────────────┘
          │                                 │
          ▼                                 ▼
   Investing UI e notificações       Market Data / News UI
      (Clerk + RLS)                  (apenas direitos permitidos)

FUTURO, NÃO IMPLEMENTAR NO R3:
  Trading Core ──> lê contratos canónicos, exigirá frequências/licenças próprias.
  Research Lab ──> lê históricos (opcional); removível sem interromper acima.
```

### Fronteiras de responsabilidade
- **Fonte/provedor:** entrega uma observação; nunca determina a verdade final do portefólio de um cliente.
- **Data Platform:** resolve identidade, valida, versiona, preserva proveniência, rege direitos/frescura e publica apenas factos de qualidade conhecida. Não decide compras/vendas.
- **Investing Core:** interpreta essas observações no contexto de investimentos e objetivos **já associados ao utilizador**. Não pede diretamente APIs de fornecedores nem executa feeds externos dentro de transações do ledger.
- **Interface:** apresenta o resultado e a sua evidência; desligar a interface não pára o pipeline.
- **Lab/Trading:** leitores futuros independentes, não partilham credenciais de clientes nem escritor financeiro.

## 2. Identidades canónicas: instrumento, emissão, cotação e emissor

**Problema a eliminar no R3-A Draft:** `instrumentIdentity()` inclui `provider: TWELVE_DATA` dentro da chave principal. Isto é uma identidade da fonte, não a identidade financeira canónica. **É uma incompatibilidade conhecida que deve ser corrigida antes de aprovar/mergear o PR #49 ou construir R3-B.**

Entidades e identificadores:
- `instrument_id` **interno estável** (UUID): a segurança/instrumento económico, com `asset_class`, moeda de denominação, estado e validade.
- `issuer_id`: empresa/emissor ou instituição, separado do instrumento; um emissor pode ter várias classes de ações, obrigações e listagens.
- `listing_id`: cotação concreta em bolsa/mercado, associada a `instrument_id`, MIC ISO 10383, moeda de negociação, ticker, datas de validade e estado.
- `provider_alias`: `provider_id` + identificador de fornecedor + `valid_from/to` → `listing_id` (ou instrumento onde aplicável). Ticker não é chave universal; mudanças de ticker e delistings preservam histórico.
- `instrument_identifier`: quando disponível e validado, ISIN, CFI, FIGI/CIK/LEI conforme **tipo, fonte, licença e papel**; ISIN não identifica por si só uma bolsa; CIK/LEI identificam emissores, não necessariamente uma listagem.
- FX: `BASE/QUOTE` dirigido e moeda de cotação explícita. Inversão nunca implícita sem um operador de transformação identificado e auditável.
- ETFs: instrumento + listagem, benchmark/index, moeda, classe de distribuição/acumulação, TER, composição publicada **com data de referência** e cobertura/limitações.
- Suporte futuro a obrigações, fundos, índices, commodities e outros ativos deve usar extensões tipadas, **não enums forçados** nem inferências por ticker.

**Matching:** `EXACT`, `REVIEW_REQUIRED`, `AMBIGUOUS`, `UNRESOLVED`. Sem autojoin de homónimos. Resolução humana/administrativa para conflitos; mappings com fonte, versão e histórico. Testar tickers repetidos em bolsas distintas, FX EUR/USD vs USD/EUR, cisões e ticker descontinuado.

## 3. Catálogo de dados e contratos com o Investing

| Família | Conteúdo mínimo | Consumo no Investing | Cuidados essenciais |
|---|---|---|---|
| **Market** | OHLCV diário, última cotação disponível, estado sessão, histórico | acompanhar preço e variações com frescura | fuso da bolsa, feriados, fechos antecipados, dados atrasados, intervalos e moeda |
| **FX** | pares dirigidos, taxa, instante, fonte, método e tipo de taxa | converter valores apenas sob política explícita | base/quote, triangulação, horário de referência e falta de taxa |
| **Corporate actions** | dividendos, splits, direitos e distribuições | rendimento total e integridade de histórico | datas ex/record/payment, ajuste, revisão e evitar double-counting |
| **Fundamentals** | receitas, lucro, dívida, cash flow, margens, ações diluídas, filings | avaliar negócio, crescimento e risco | período vs data de publicação, moeda, unidade, GAAP/IFRS, reexpressões |
| **Economics** | juros, inflação, emprego, PIB, calendários | contextualizar cenários e risco macro | vintage e revisões; sazonalidade/periodicidade/unidade |
| **News / events** | evento, entidades ligadas, fontes, factos, incerteza e datas | mudanças materiais, risco contextual e alertas | duplicados, direitos, rumor, atribuição, difusão e manipulação |

**Contratos internos de leitura (proposta, NÃO rotas HTTP públicas):**
- `resolveInstrument(identityHint) -> Resolved | Ambiguous | Unknown`
- `getMarketSeries({listingId, interval, from, to, adjustment, asKnownAt, rightsContext}) -> DataEnvelope<Series>`
- `getFX({base,quote,asOf,ratePolicy,rightsContext}) -> DataEnvelope<Rate>`
- `getFundamentals({issuerId,metrics,asKnownAt}) -> DataEnvelope<FactSet>`
- `getEconomicSeries({seriesId,asKnownAt}) -> DataEnvelope<Vintages>`
- `listRelevantEvents({issuerIds,instrumentIds,asKnownAt}) -> DataEnvelope<Events>`
- `getChangesSince({cursor,scope})` e outbox versionada para monitorização idempotente.
- `DataEnvelope`: `status = AVAILABLE|STALE|PARTIAL|UNAVAILABLE|LICENSE_BLOCKED|AMBIGUOUS`, `source_refs`, `as_of`, `observed_at`, `ingested_at`, `coverage`, `quality`, `license_scope`, `revision_id`, `schema_version`, `diagnostics` redigidos. **Nem todos os estados têm value; nunca usar 0 por defeito.**

**Sem acoplamento a um fornecedor:** adaptadores convertem `ProviderPayload` → `NormalizedObservation`. Os consumidores não conhecem códigos de erro, IDs ou formatos do Twelve Data; o nome da fonte permanece em proveniência, não na identidade. Versões e semântica de ajuste são parte obrigatória da chave de série; dados incompatíveis não podem ser unidos só porque têm a mesma data.

## 4. Tempo, qualidade e proveniência (PIT: point-in-time)

Cada observação deve distinguir, quando aplicável:
- `event_time` ou `market_session_date` (data da bolsa) e `exchange_timezone`;
- `source_published_at` (quando a informação foi publicada), `source_updated_at`;
- `first_seen_at` (primeira vez observada pelo SYNTRAKE), `ingested_at`;
- `valid_from`, `superseded_at`, `revision_id`; `as_known_at` para reconstruir a informação conhecida numa data;
- `provider_id`, `original_source_id`, `request_id` e `source_document_uri` quando licenciado;
- `adjustment`, `quote_currency`, `unit`, `period`, `frequency`, `market_state`, `latency_class`;
- `quality_flags`, `coverage`, `freshness_policy`, `rights_policy_id`, `parser_version`.

**Sem usar timestamps de ingestão como se fossem timestamps de negociação.** Citações de preços em tempo real exigem direito e prova de latência; preço de fecho diário não é preço negociável agora. Controlar fuso/DST, feriados, horários de negociação e suspensão. Dados antigos podem permanecer úteis historicamente, mas devem ser marcados `STALE` para usos que exijam maior frescura.

**Histórico não destrutivo, condicionado por licenças:** correções criam novas versões e ligações `supersedes`; nunca sobrescrever silenciosamente a série usada num relatório anterior. Se a licença impõe eliminação/TTL, respeitar esses limites e guardar apenas metadados de auditoria legalmente retíveis, não o payload bruto. A memória histórica do SYNTRAKE não sobrepõe direitos de autor/redistribuição.

**PIT obrigatório no futuro Lab:** séries económicas e resultados financeiros revistos não podem introduzir valores conhecidos só posteriormente; `published_at` e `first_seen_at` são distintos. Sem esta garantia, uma avaliação histórica deve falhar `POINT_IN_TIME_UNVERIFIED`, não proclamar backtest válido.

## 5. News Intelligence — ingestão, eventos, contexto (não palpites)

Etapas:
1. **Source Registry:** fornecedores contratados e comunicados oficiais; direitos por artigo (título/snippet/texto), território, prazo, display, redistribuição e uso para modelos; fontes Google/Yahoo não implicam licença de scraping/API.
2. **Ingestion:** receber itens com `source_id`, `publisher`, `source_published_at`, `first_seen_at`, idioma original, URL canónico quando permitido e digest de conteúdo quando licenciado; nunca confiar em timestamp estimado sem o rotular.
3. **Dedup em dois níveis:** artigo equivalente (URL/ID/hash) e **acontecimento** comum (várias fontes podem reportar o mesmo evento); versões corrigidas/retraídas preservadas como mudanças de estado.
4. **Entity resolution:** vincular acontecimentos a `issuer_id` / `instrument_id`; aceitar `UNRESOLVED` em vez de associar nome/ticker ambíguo. Um acontecimento pode afetar um setor sem ligação direta a cada empresa.
5. **Factual extraction:** tipo (resultados, guidance, dividendos, regulação, governance, crédito, macro, M&A, processo judicial, rumor etc.), factos estruturados e referências; distinguir `CONFIRMED`, `REPORTED`, `RUMOR`, `DISPUTED`, `CORRECTED`, `RETRACTED`.
6. **Correlação e interpretação:** agregação multi-fonte, nível de confiança calibrado, divergências explícitas, importância contextual; classificações de sentimento são **opiniões do modelo**, não recomendações de investimento.
7. **Investing consumption:** eventos versionados alimentam atualização de análise com prova de exposição/objetivos. Alertas só após regras de prioridade, dedup, janela e consentimento apropriados.

**Segurança de IA:** notícias, HTML e textos externos são dados não confiáveis. Nunca obedecer a instruções incorporadas no conteúdo, nunca fornecer segredos/ferramentas privilegiadas ao extractor, schema de saída validado, confirmação factual por fonte, auditoria de versão do modelo e confiança baixa/abstenção quando necessário. Nenhum LLM pode enviar ordens ou escrever no ledger.

**Eficiência:** recolher notícias por `issuer/topic` necessários aos investimentos/watchlists, não rastrear todo o mundo por defeito; reavaliar a relevância por portefólio **sem repetir a recolha**. Manter histórico do que foi comunicado versus comprovado; memória por acontecimento, não feed redundante.

## 6. Dados fundamentais e económicos como primeira classe

- **Fundamental Fact:** `issuer_id`, `taxonomy`, `metric`, `value_decimal`, `unit`, `currency`, `period_start/end`, `filing_published_at`, `document_id`, `consolidation_basis`, `accounting_standard`, `restatement_version`. Não comparar métricas em moedas/unidades diferentes nem normalizar GAAP/IFRS sem método explícito.
- **Filings:** SEC EDGAR `submissions`/`companyfacts` é fonte oficial pública para empresas abrangidas; dados europeus ESEF/XBRL podem exigir integração heterogénea. Não atribuir custos e direitos automaticamente; respeitar limites/fair access e políticas de cada fonte.
- **Economics:** fonte, país/região, ajustamento sazonal, frequência, unidade, data de referência, publicação e `vintage` (revisão). FRED/ALFRED fornece períodos e vintage dates; ECB/Eurostat têm APIs SDMX. Não comparar observações de frequência ou base diferente como equivalentes.
- **Calendário:** distinguem-se datas anunciadas, estimadas, confirmadas, realizadas e alteradas. Os anúncios futuros não são factos já publicados; emissor/fornecedor e confiança têm de aparecer.

## 7. Modelo de dados PG17 proposto (NÃO CRIAR TABELAS AINDA)

**Schema privado `market_core`** (nome final sujeito a revisão de migrações):
```text
providers, provider_capabilities, license_policies, rights_grants
issuers, instruments, listings, instrument_identifiers, provider_aliases
market_series, market_observations, market_observation_revisions, trading_calendars
fx_observations, corporate_actions, dividends
fundamental_facts, fundamental_filings, economic_series, economic_vintages
news_sources, news_items, news_item_versions, news_events, event_entity_links
ingest_requests, ingest_jobs, job_leases, quota_reservations, source_health
quality_issues, ingestion_runs, consumer_outbox, consumer_cursors
```
Estas são **entidades lógicas**, não 25 ordens SQL para executar já. Normalizar/escalonar tabelas por necessidade; evitar engenharia excessiva no MVP. `news_items` pode armazenar somente metadados permitidos e não o artigo integral.

**Restrições de persistência:**
- Identidade e versions com PK/UK de verdade, `provider_id + listing_id + interval + session_date/time + adjustment + release_version` e idempotência de replay.
- Correção de dados fonte cria uma revisão, com acesso `as_known_at`; conflito não deve sobrescrever provas antigas.
- Exposição Data API do Supabase: preferir schema privado e leitores internos por roles mínimos, RLS como defesa adicional. Nunca `anon`/chave `service_role` num cliente; todas as leituras privadas de portefólio continuam com autorização Clerk server-side e RLS por proprietário.
- Dados comuns de mercados **não contêm owner_id nem posições**; as pontes com portefólios privados são executadas no Investing Core sob identidade autenticada. É proibido contaminar cache pública com dados privados ou inferir outras carteiras a partir das prioridades/telemetria.
- Permissões de escrita separadas por provider/ingest/read e ledger, sem credencial genérica com privilégios de proprietário; transações SQL curtas e sem fetch HTTP dentro delas.
- Índices/particionamento apenas a partir de projeção mensurável de volume e queries; retenção por licença e backups.

## 8. Coordinator / Scheduler — custo, disponibilidade e capacidade 24/7

**Uma única procura lógica por dado partilhável.** `Demand Registry` agrega necessidades: posições reais e watchlists do Investing, mais adiante consumidores adicionais. A chave de recolha inclui `instrument/listing + source capability + intervalo + janela + adjustment + rights scope + quality/freshness class`; não partilhar indevidamente feeds real-time/delayed ou mercados diferentes.

**Workflow atómico:**
```text
Investing demand ──> read cache/data rights policy
      ├─ válido e permitido ──> devolver snapshot versionado
      ├─ stale/hard invalid ──> fila de refresh com dedup
      └─ rights denied / budget exhausted ──> erro explícito
fila ──> lease/lock + reserva de crédito na BD ──> adapter ──> validação
     ──> versioned commit + quality/rights ──> outbox ──> Investing
                     └─ 429/timeout: backoff com jitter, sem retry infinito
```

- Reservas atómicas para pedidos concorrentes, por provider/chave e período; contabilizar créditos estimados vs consumo confirmado, reconciliar reservas expiradas, limites por dia/minuto e alarmes. Sem supor que 1 endpoint = 1 crédito.
- Cooldowns, circuit breakers e limites de orçamento; `stale-while-revalidate` só quando explicitamente seguro/permitido. Sem fallback não equivalente ou oculto.
- Workers independentes de utilizador online; fila persistente, `lease_until`, `attempts`, `next_run_at`, `dead_letter`, idempotência, observabilidade, recuperação de crash e concorrência. Scheduler apenas dispara jobs; worker faz tarefas curtas/limitadas; escolher infraestrutura após medir limites de execução/custo.
- **Prioridades:** 1) instrumentos e FX com posição efetiva; 2) eventos materiais ligados; 3) watchlist; 4) backfill não urgente. Prioridade **não** autoriza gastar além do orçamento.
- **No primeiro utilizador:** começar só com 1–N instrumentos necessários, históricos diários e feeds oficiais selecionados; sem WebSocket, 1m, notícia em massa ou planos pagos só para demonstrar funcionamento.

## 9. Seleção/failover entre fornecedores

`ProviderCapability` deve declarar `asset_class`, `market`, `symbol coverage`, `precision`, `latency`, `adjustment`, `history depth`, `timezone`, `rights`, `TTL`, `quota`, `cost`, `status`, `quality_history`.

Política:
1. Verificar identidade exata e requisitos do consumidor.
2. Filtrar fornecedores sem cobertura, licença ou quota.
3. Preferir dado existente autorizado e suficientemente fresco.
4. Selecionar a fonte primária por política configurada e comprovada, não por ticker/fornecedor aleatório.
5. Falha → usar alternativa **apenas se a equivalência necessária for demonstrada**; manter origem, diferenças e incerteza. Se ajuste/moeda/frequência diferir, devolver `UNAVAILABLE` ou `PARTIAL`.
6. Dados de fontes diferentes são **observações concorrentes**, não uma média financeira arbitrária. Não escolher “verdade” por maioria quando a origem/definição diverge.

**Twelve Data v1:** adapter único inicial, não centro da arquitetura. Preferir `Authorization: apikey ...` server-side onde endpoint o suporta (documentação oficial recomenda header) para evitar o segredo no URL/logs. Se query key for inevitável, sanitizar totalmente URL, traces, erros e proxy. `/time_series` aceita `adjust=all|splits|dividends|none`; não depender do default; distinguir respostas do plano e comportamento de ajustes. Atual adapter Draft requer revisão de permissões do plano e testes de tipos instrumentais/valores válidos antes de ativar. **Não ativar no Preview ainda.**

## 10. Integração operacional com Investing Core

**Ciclo sem intervenção do utilizador:**
1. Portfolio/holdings do próprio utilizador fornecem `instrument_id` e parâmetros de monitorização sem expor contas ou chaves ao Data Core.
2. Demand Coordinator mantém dados comuns atualizados sob orçamento e direitos.
3. Data Platform publica revisões de preços/FX/corporate actions, novos factos e eventos News.
4. Investing Core lê envelopes canónicos com autorização adequada, associa ao portefólio e objetivos/horizonte/perfil de risco (dados declarados continuam declarados).
5. Investing calcula **observações e hipóteses auditáveis** e atualiza estado de monitorização; avaliação do portefólio em R4/R5 terá política definida de preços, cashflows e FX. Ausência de preço/capital verificado → não inventa performance.
6. Alertas por regras de materialidade + relevância + janela anti-duplicados; transparência de fontes, grau de confiança, mudanças e justificações. Sem aconselhamento personalizado/execução automática até análise regulatória separada.
7. Workers continuam após logout, replays/crashes; desligar Research Lab não muda nenhuma etapa.

**Exemplo de aceitação, com dados sintéticos:** utilizador A tem portefólio com instrumento `X`; nova divulgação de resultados está corretamente ligada ao emissor de `X`; Investing regista evento, fontes, publicação e exposição e gera uma análise sinalizada como hipótese. Utilizador B sem `X` não recebe exposição de A. Remover/desligar Lab → pipeline inalterado. Dado ambíguo/contraditório → não atribuir, não gerar falsa conclusão.

## 11. Segurança, licenças e privacidade — bloqueios de lançamento

- Licença **por fonte, mercado, dado, utilização e audiência**: armazenamento e cache, uso comercial interno, texto integral/snippets, exibição a clientes, derived data, non-display, redistribuição, atribuição, validade e obrigação de apagar. Não equiparar conta pessoal Grow/Pro com licença comercial de redistribuição.
- Twelve Data: termos contratuais variam por plano/exchange e distinguem uso pessoal/comercial, retenção, dados derivados e redistribuição. Antes de exibir dados no produto comercial, obter permissão concreta e guardar prova/versão do contrato; toda a cache e retention obedecem à licença.
- Notícias: direitos de autor, paywalls e políticas de scraping; guardar apenas o que for autorizado, usar links/fontes verificáveis, prevenir reutilização ilícita do artigo completo.
- Segredos server-only em env com mínima permissão, expurgar de logs; fixed hosts, timeouts, limite de tamanho e conteúdo, sem SSRF/redirects; rate limit e quotas.
- Gestão de sessão/identidade Clerk; acessos de cliente sempre owner-scoped. `source_data` global não autoriza leitura de posições. R2 security issue **#47** permanece **NO-GO para onboarding comercial externo**.
- Para conclusões que possam aproximar-se de recomendações personalizadas, obter revisão regulatória EU/França antes de ativar; factos e informação contextual não são garantia de retornos.
- Falhas de IA e conteúdo malicioso nunca podem chegar a ações financeiras.

## 12. Observabilidade e recuperação

Instrumentar sem dados pessoais/segredos:
- cobertura por ativo/exchange e `last_good_observation`; idade do dado e percentagem `STALE`;
- parsing/rejection rate, fonte, versão, causa, divergência entre fornecedores;
- créditos reservados/consumidos por endpoint e custo estimado; cache-hit/dedup rate;
- jobs atrasados, retry/backoff, leases expirados, dead-letter, tempos de recuperação;
- eventos duplicados, entidades não resolvidas, afirmações corrigidas e falsos positivos nas notificações;
- direitos/TTL pendentes, violações preventivas de acesso e audit trails por release.

SLOs definidos **após** conhecer cobertura e plano contratados, não inventar percentagens. Testes de falha de fornecedor, concorrência, retenção/expiração, reset de workers, feriados/DST, reprocessamento de notícias e remoção do Lab.

## 13. Entrega R3 por gates (sem loops)

| Fase | Resultado comprovável | Evidência / bloqueio |
|---|---|---|
| **R3-0 — arquitetura** | Este documento, inventário de requisitos, fonte e direitos; decisão de scope Investing | revisão humana, nenhuma migração |
| **R3-A — contratos e identidade** | Identidade canónica independente do fornecedor; adapter TD isolado; qualidade, timestamps, erros, schema version; fake HTTP | unit + contract + TypeScript + regressões R0–R2; **corrigir Draft atual** |
| **R3-B — registry e histórico PG17** | private schema com instrumentos, aliases, market observations + revisions + source rights; no financial ledgers | migração candidata, PG17 descartável, duplicate/conflict/owner RLS e rollback; Production bloqueada |
| **R3-C — ingestão autónoma económica** | worker + job leases + atomic credit quota + backoff + coverage + data health | teste concorrência/custo/crash; Preview sem provider real por defeito |
| **R3-D — fundamentals/economics/corporate actions/FX** | contratos e dados históricos verificáveis, as-known-at e calendário | fixtures oficiais, revisões, sem informação futura; direitos |
| **R3-E — News Intelligence básico** | ingestão licenciada/oficial, entidade/evento, dedup, PIT, correções, direitos e resultados explicáveis | testes de rumores, fontes contraditórias, prompt injection, sem false link |
| **R3-F — ligação Investing** | consumo por Investing Core, contexto de posição/objetivo, análise/alerta auditável sem Lab | E2E com A/B e Lab desativado; nenhum dado falso/ledger write |
| **R3-G — rehearsal cumulativo** | R0→R3 PG17 + quality regressions, source gating, license/cost gate, documentação de operação | CI e Preview + evidências. Custos reais só após autorização |
| **R3-H — Production controlada** | source SHA reviewed, migrações e flags autorizadas separadamente, monitorização/rollback | NO-GO sem todas provas relevantes e #47 para clientes externos |

**Ajuste de sequência:** para manter valor incremental, R3-D pode ser dividido em D1 (FX/corporate actions) e D2 (fundamentals/economics). R3-E News não deve bloquear o primeiro consumo Investing de preços (R3-F1), mas o R3 não deve ser declarado totalmente concluído enquanto o âmbito de News acordado ficar pendente. Nenhuma fase é aceita por “build verde” apenas: cada uma exige teste de comportamento real no ambiente permitido.

**Orçamento e decisão de pagamento:** até ao primeiro teste de fornecedor com chave real, zero calls externas e zero custos; apresentar sempre plano, estimativa e limites antes de consumir créditos/ramo pago. Dados de terceiros e licensing revistos por fonte.

## 14. Matriz mínima de testes determinísticos e reais

1. **Identity:** mesmo ticker em mercados diferentes, mudanças históricas, ETF vs ação, ISIN/FIGI/CIK diferentes, FX inverso.
2. **Market:** OHLC decimal/exact, moeda/ajuste, holiday/DST, invalid/null, 429, 200 error, payload grande, timeouts, fonte falsa, timestamp não verificado.
3. **PIT:** preço/resultado/indicador revisto depois da data não aparece em `asKnownAt` anterior.
4. **Provider:** falha TD sem fallback compatível → `UNAVAILABLE`; fonte substituta com comparação de direitos e proveniência.
5. **Budget:** dois pedidos iguais simultâneos → no máximo uma reserva/fetch por direito e janela; crash conserva cobrança/idempotência; quota esgotada bloqueia.
6. **News:** cinco títulos → um evento, mantendo fontes; rumor/retração, texto instrucional malicioso, entidades homónimas.
7. **Rights:** licença pessoal não permite client display; TTL elimina conteúdo quando exigido; auditoria legal permitida.
8. **Security:** user A não vê dados de portefólio B; data pública global não revela procura/posições do B; secret não sai do servidor; fail closed.
9. **Investing:** preço+news+fundamental ligados à posição certa → análise traceável; sem holdings verificadas não se declara valor/performance confirmada.
10. **Autonomy:** navegador fechado, job ainda executa; desligar/remover Lab ou UI não pára; reinício reprocessa sem duplicar; sem Trading deploy.
11. **Cumulative:** PostgreSQL 17 real e isolado, regressões R0–R2, release gates; Production sem migração/ativação sem consentimento separado.

## 15. Decisões já tomadas vs pendências explícitas

**DECIDIDO:** Investing primeiro; dados/News reutilizáveis; Lab removível; identidade independente do fornecedor; custo controlado; períodos e fontes verificáveis; não misturar conteúdo editorial com recomendações; dados privados isolados; worker independente da sessão.

**PENDENTE ANTES DE R3-B:** fornecedor/mercados concretos de primeiro lançamento, licença de uso/retention/cache por fornecedor, definição inicial de universo (ex.: ações/ETFs UE/EUA + FX), schema privado e migrations baseline, política de avaliação/adjustment/FX e custo máximo mensal. Não presumir coberturas/preços.

**PENDENTE ANTES DE NEWS OPERACIONAL:** fornecedores autorizados, direitos dos textos, taxonomia de eventos, cobertura, idioma, orçamento de IA e limites de confidencialidade.

**PENDENTE ANTES DE CLIENTES:** issue #47 signed Clerk R2-D A/B, validação jurídica/comercial aplicável, privacy controls e ensaios de acesso reais.

**NÃO FAZER AINDA:** migrar Supabase Production, ativar provider pago, ligar broker, gerar sinais de trading, criar Research Lab como dependência, prometer atualização em tempo real sem licença, publicar notícias sem direitos ou inventar métricas.

## 16. Fontes técnicas verificadas (2026-10-30)

- Twelve Data docs: https://twelvedata.com/docs (time_series, adjust, autenticação header e limites)
- Twelve Data usage/licenciamento: https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage
- Twelve Data termos: https://twelvedata.com/terms (retenção/redistribuição)
- SEC EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces (submissions, companyfacts, XBRL)
- SEC fair access: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
- FRED/ALFRED revisões e PIT: https://fred.stlouisfed.org/docs/api/fred/realtime_period.html
- Eurostat SDMX: https://ec.europa.eu/eurostat/en/web/user-guides/data-browser/api-data-access/api-introduction

---

**Critério de sucesso do R3:** o Investing Core recebe dados e eventos **reais, datados, licenciados, atribuíveis e validados**, reage autonomamente quando apropriado, sem Browser, Research Lab ou Trading, sem inventar valores, sem violar R0–R2 e com consumo de APIs dentro de limites demonstráveis. **Desenho aprovado não equivale a componente implementado.**
