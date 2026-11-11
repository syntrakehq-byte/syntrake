# SYNTRAKE — News Intelligence Core / N0
## Contrato canónico e auditoria técnica — v1.0-candidate

**Data:** 2026-11-11
**Base verificada:** \`main\` @ \`47f68c2515611c8b5b458a19a31f232ab4b35383\`
**Estado:** \`N0_CANDIDATE_FROZEN\` — aguardando auditoria independente; **não** é \`N0_APPROVED\`
**Âmbito:** especificação, sem implementação, deploy, alteração de base de dados ou alterações aos motores existentes.

### 0. Bases confirmadas e limites de integração

- O Market Core na \`main\` é um serviço de mercado consumer-neutral, com consulta *on-demand*. Os mecanismos temporários de cache não são um arquivo histórico de notícias.
- \`market-data-core/identity.ts\` distingue uma descrição de instrumento (\`symbol\`, \`mic\`, \`currency\`) de identidade canónica comprovada (\`issuerId\`, \`instrumentId\`, \`listingId\`). Não converter descrições em identidades confirmadas.
- \`market-data-core/consumerMarketService.ts\` estabelece a separação entre consumidores INVESTING/TRADING e serviço de mercado. O News Core mantém uma fronteira equivalente, mas **não** modifica nem usa indevidamente a API de preços.
- Os contratos avançados do resolver/warehouse/workers em branches Draft não são dependência obrigatória desta fase nem podem ser considerados integrados na \`main\`. A integração futura exige uma ponte versionada e provas de compatibilidade.
- O N0 não declara qualquer fornecedor operacional, infraestrutura de vigilância ativa ou comportamento 24/7 já comprovado.

### 1. Mandato e invariantes

**Mandato:** adquirir, normalizar, relacionar, verificar e consultar publicações e acontecimentos financeiros, com proveniência e histórico *point-in-time* (PIT), de forma independente de sessões e utilizadores online.

**Fronteiras:** o News Core não calcula preços, não altera o Ledger, não atualiza carteiras, não executa ordens e não produz recomendações automáticas. Investing, Trading e Research Lab são consumidores que aplicam as suas próprias regras.

**Invariantes:**
- \`N0-I01\`: nenhuma notícia, relação, identidade, evidência ou evento é inventado quando uma fonte falha ou está incompleta;
- \`N0-I02\`: publicação != acontecimento; associação muitos-para-muitos, temporal e auditável;
- \`N0-I03\`: símbolo/ticker isolado não confere identidade canónica \`EXACT\`;
- \`N0-I04\`: informação derivada (evento, classificação, identificação, fusão e correção) tem revisão e \`asKnownAt\` próprios;
- \`N0-I05\`: consultas PIT não incluem publicações, revisões ou relações com \`asKnownAt > asOf\`;
- \`N0-I06\`: ingestão repetida e concorrente é idempotente; sem revisões ou eventos artificiais;
- \`N0-I07\`: publicidade, UI e sessões de utilizadores não são triggers necessários à vigilância;
- \`N0-I08\`: erros de fonte, degradação e ausência de resultados são distinguíveis;
- \`N0-I09\`: afirmações factuais e decisões dos consumidores permanecem separadas;
- \`N0-I10\`: todas as operações internas são autenticadas por identidade de serviço e os dados privados de contas não são expostos a fornecedores.

### 2. Terminologia e modelo de persistência

Os identificadores internos são opacos, imutáveis e não derivados de tickers. São necessárias entidades e revisões separadas:

| Tipo lógico | Campos obrigatórios | Campos opcionais e semântica |
|---|---|---|
| \`NewsSource\` | \`sourceId\`, \`providerKey\`, \`sourceType\`, \`retrievalMode\`, \`enabled\` | \`publisherKey\`, \`canonicalDomain\`; distinguir fornecedor de publicador |
| \`NewsPublication\` | \`publicationId\`, \`sourceId\`, \`originFingerprint\`, \`firstSeenAt\` | \`externalId\`, \`originalUrl\` |
| \`NewsPublicationRevision\` | \`publicationRevisionId\`, \`publicationId\`, \`revisionNo\`, \`ingestedAt\`, \`asKnownAt\`, \`sourceRefs\` | \`title\`, \`language\`, \`publishedAt\`, \`contentFingerprint\`, \`supersedesRevisionId\`, \`qualityFlags\` |
| \`NewsEvent\` | \`eventId\` | Identidade persistente do acontecimento; não equivale a uma publicação |
| \`NewsEventRevision\` | \`eventRevisionId\`, \`eventId\`, \`eventType\`, \`statement\`, \`confirmationStatus\`, \`lifecycleStatus\`, \`asKnownAt\`, \`evidenceIds\` | \`occurredAt\`, \`scheduledFor\`, \`supersedesRevisionId\`, \`qualityFlags\` |
| \`NewsEvidence\` | \`evidenceId\`, \`publicationRevisionId\`, \`claimRef\`, \`evidenceType\`, \`independenceGroup\`, \`asKnownAt\` | \`sourceDocumentRef\`, \`verificationStatus\`, \`qualityFlags\` |
| \`NewsEntityLinkRevision\` | \`entityLinkId\`, \`eventId\`, \`linkRevisionId\`, \`targetScope\`, \`identityStatus\`, \`relationType\`, \`asKnownAt\`, \`evidenceIds\` | \`issuerId\`, \`instrumentId\`, \`listingId\`, \`sectorKey\`, \`countryCode\`, \`macroKey\`, \`candidateRef\`, \`validFrom\`, \`validTo\` |
| \`NewsEventPublicationLinkRevision\` | \`linkId\`, \`eventId\`, \`publicationId\`, \`linkRevisionId\`, \`asKnownAt\`, \`relation\` | \`supersedesRevisionId\`, \`qualityFlags\`; vínculo muitos-para-muitos |
| \`NewsCollectionCursor\` | \`sourceId\`, \`checkpoint\`, \`updatedAt\` | Estado recuperável por fonte; não é cursor de paginação da API |
| \`NewsJobExecution\` | \`executionId\`, \`jobKey\`, \`state\`, \`attempt\`, \`startedAt\` | \`finishedAt\`, \`failureCode\`, \`lastHeartbeatAt\`; sem payloads sensíveis nos logs |

Campos textuais publicados não são tratados como instruções executáveis. Armazenamento concreto (tabelas, constraints, índices) fica para desenho N1, preservando estas invariantes.

**Categorias iniciais:** \`EARNINGS\`, \`GUIDANCE_CHANGE\`, \`DIVIDEND_ANNOUNCEMENT\`, \`MERGER_ACQUISITION\`, \`MANAGEMENT_CHANGE\`, \`LEGAL_REGULATORY\`, \`CENTRAL_BANK_DECISION\`, \`MACROECONOMIC_RELEASE\`, \`ETF_FUND_CHANGE\`, \`OPERATIONAL_DISRUPTION\`, \`GEOPOLITICAL_EVENT\`, \`OTHER_REPORTED_EVENT\`.

**Estados ortogonais:**
- Disponibilidade de consulta: \`AVAILABLE\`, \`PARTIAL\`, \`STALE\`, \`UNAVAILABLE\`; uma lista vazia com consulta bem-sucedida é \`AVAILABLE\`, não um erro.
- Identidade: \`EXACT\`, \`AMBIGUOUS\`, \`UNRESOLVED\`, \`REVIEW_REQUIRED\`.
- Confirmação factual: \`PRIMARY_CONFIRMED\`, \`CORROBORATED\`, \`REPORTED\`, \`UNVERIFIED\`, \`DISPUTED\`.
- Ciclo de vida: \`ACTIVE\`, \`CORRECTED\`, \`RETRACTED\`.
- O estado \`CORRECTED\` não é nível de confiança; uma notícia pode ser revista sem desmentido.

### 3. Tempo, versões e garantia PIT

Usar instantes UTC ISO 8601 com timezone explícito e precisão consistente. Distinguir:
- \`occurredAt\`: momento em que o facto aconteceu, quando conhecido;
- \`scheduledFor\`: data de evento futuro anunciado, não confundida com ocorrência;
- \`publishedAt\`: alegação da origem sobre publicação, não momento em que o SYNTRAKE já sabia;
- \`firstSeenAt\`: primeira observação efetiva desta publicação pelo serviço;
- \`ingestedAt\`: quando esta revisão foi recebida e registada de forma durável;
- \`asKnownAt\`: quando a revisão/associação passou a estar disponível depois de persistida/validada.

**Regra temporal:** para cada revisão, \`asKnownAt >= ingestedAt\` e nunca se antecipa \`asKnownAt\` para a data alegada de publicação. \`firstSeenAt <= ingestedAt\` para a primeira observação. Os relógios externos podem estar incorretos: uma data de publicação futura ou incongruente gera \`qualityFlags\`/revisão de qualidade, em vez de ser silenciosamente corrigida.

**Consulta PIT:** selecionar a última revisão **conhecida** de cada objeto no cutoff \`asOf\`, aplicar também cutoff a evidências, classificações, links e operações de fusão/separação, devolver informação insuficiente quando só haja dados posteriores. Reprocessar arquivo antigo não altera o conhecimento passado. Qualquer backtest distingue \`ocorreu\`, \`foi publicado\`, \`ficou acessível ao SYNTRAKE\`.

**Exemplo:** fonte publica 14:00, sistema recebe 14:05, classificou 14:07, correção chega 14:20. Em 14:03 nada é conhecido; em 14:10 apenas versão/etiquetas já existentes; em 14:30 correção aparece, sem apagar versões anteriores.

### 4. Identidade e relação financeira

A identificação inicia-se na entidade emissora, quando o acontecimento diz respeito ao emissor; a relação a instrumentos/listings só é criada com evidência adicional apropriada. Usar IDs reais e verificáveis do Market Core, ou \`null\` enquanto a correspondência não puder ser comprovada. Não fabricar issuerId a partir de um símbolo da API.

As relações válidas incluem \`DIRECT\`, \`MENTION\`, \`SUBSIDIARY\`, \`SECTOR\`, \`INDIRECT_EXPOSURE\`. ETF não é automaticamente afetado diretamente por um evento numa participada. Correspondências por LEI/CIK/ISIN/FIGI são evidência com âmbito e validade temporal; não são prova absoluta fora do respetivo âmbito.

Para \`AMBIGUOUS\`, \`UNRESOLVED\` ou \`REVIEW_REQUIRED\`, guardar a origem e as candidaturas, **não** entregar como correspondência canónica confirmada. A ponte para o Market Core tem um contrato versionado e não requer que os contratos Draft sejam promovidos.

### 5. Fontes e adaptadores

**Candidatos N1:** SEC/EDGAR, BCE, AMF (fontes primárias), GDELT (descoberta internacional), Marketaux (adaptador opcional sujeito a medição). A escolha final depende de testes reais de cobertura, formatos, latência e qualidade. Nenhum fornecedor é indispensável à identidade ou ao contrato interno.

Cada adaptador deve normalizar: \`sourceId\`, \`providerKey\`, \`originalSourceId\`, \`publisher\`, \`publicationTime|null\`, \`firstObservedAt\`, \`retrievedAt\`, \`canonicalUrl|null\`, \`title|null\`, \`sourceDocumentRef|null\`, \`providerRevision|null\`, \`qualityFlags\`.

Tratamento explícito de: resposta vazia válida, indisponibilidade, throttling, payload inválido, alterações de esquema, origem secundária e conflitos de relógio. O adaptador não decide compras, não altera identidades canónicas e não classifica rumores como factos.

### 6. Deduplicação e evidências

- Publicação: identidade composta por origem e referência estável; fallback com URL canónico/fingerprint, sempre com confirmação de compatibilidade.
- Evento: aproximações e evidências de entidade, categoria, local, momento, declaração factual; sem fusões por mera semelhança de título.
- A mesma reportagem reproduzida noutros sites pode pertencer a uma única \`independenceGroup\`; múltiplos links não contam automaticamente como várias confirmações.
- Fusões, separações, correções, contestações e retrações são revisões e relações temporais, nunca operações destrutivas sobre o passado.
- As gravações e checkpoints devem ser transacionais e idempotentes; em concorrência, apenas um resultado lógico.

### 7. API interna canónica

**Envelope comum:** \`schemaVersion\`, \`requestId\`, \`status\`, \`asOf\`, \`servedAt\`, \`data\`, \`sourceRefs\`, \`qualityFlags\`, \`nextCursor|null\`. Separar erro operacional de consulta bem-sucedida sem resultados. Nunca devolver uma identidade resolvida se o estado não for \`EXACT\`.

Operações:
1. \`discoverNews({query, filters, asOf, limit, cursor})\`: publicações e descoberta; fonte de entrada não precisa ser holding do utilizador.
2. \`getNewsEvents({targets, eventTypes, from, to, asOf, limit, cursor})\`: eventos e relações PIT, classificados.
3. \`getEventEvidence({eventId, asOf})\`: versões e evidências disponíveis no cutoff.
4. \`getNewsHistory({targets, from, to, asOf, limit, cursor})\`: histórico de eventos e revisões historicamente visíveis.

**Regras:** paginação estável com chave de ordenação e \`asOf\` fixados no cursor; \`asOf\` fornecido pelo servidor quando não indicado; limites definidos por operação em N1, nunca paginação ilimitada; filtros validados em runtime; autenticação de serviço independente de cookies; isolamento de dados privados de contas; mensagens de erro sem credenciais, corpos externos ou detalhes internos.

### 8. N0-AUT-001 — AUTONOMIA 24/7 OBRIGATÓRIA

O News Core **tem de trabalhar sem ninguém no site**, mesmo durante horas ou dias: recolher, detetar, normalizar, classificar, deduplicar, persistir e disponibilizar factos. Não basta responder quando alguém abre uma página.

A arquitetura exige:
- executor/scheduler independente de sessões web, com ciclos e intervalos por fonte;
- recolha incremental por checkpoint durável, backfill após paragens e tolerância a falhas de fontes;
- leasing/idempotência por tarefa, retomada após crash e limites de repetição/backoff;
- supervisor ou equivalente com heartbeat, métricas de último sucesso, atraso, número de novas publicações, erros e trabalho pendente;
- vigilância configurável para fontes macroeconómicas e entidades/instrumentos/temas acompanhados, sem varrer indiscriminadamente todo o mundo em cada ciclo;
- armazenamento durável distinto do cache efémero de mercado; workers já existentes só são reutilizados após auditoria da interface e estado real de integração.

**24/7 designa independência de utilizadores e operação contínua do serviço quando a infraestrutura está disponível; não implica latência zero nem promessas absolutas de uptime dos fornecedores.** As metas exatas de latência serão estabelecidas por medição real em N1/N4.

**Prova obrigatória de aceitação:** com **zero sessões**, executar pelo menos dois ciclos de recolha e provar que uma publicação real nova é recolhida, processada, persistida e consultável pela API interna. Interromper deliberadamente um executor entre descoberta e persistência, reiniciar, recuperar a tarefa, não criar duplicados e recuperar o intervalo perdido. Falhar o teste impede o encerramento operacional do News Core.

**Roadmap:** N0 define a obrigação; N1 implementa a primeira recolha sem sessão; N2/N3 completam tratamento e histórico; N4 audita provas; N5 valida ponta a ponta a operação autónoma com consumidores. Vigilância 24/7 **não é opcional**.

### 9. Segurança operacional

- Tratamento de feeds e documentos externos como conteúdo não fiável; nunca executar instruções extraídas de notícias.
- Validar URLs, DNS/resolução e destino de redirecionamentos; bloquear acesso a endereços privados, loopback e metadata de infraestrutura.
- Isolar segredos de fornecedores e credenciais internas; não registar corpos de erro externos em logs.
- Rejeitar resultados malformados; não inventar notícias para compensar falhas.
- Não enviar inventários de carteiras ou dados de utilizadores a provedores sem necessidade técnica justificada.
- Contratos e testes desde N0 compatíveis com múltiplas contas; vigilância global/partilhada separada da seleção privada de ativos de cada conta.

### 10. Matriz canónica de testes

| ID | Cenário | Critério objetivo |
|---|---|---|
| N0-T01 | Mesma publicação duas vezes | Uma identidade lógica |
| N0-T02 | Publicação corrigida | Revisão nova, anterior preservada |
| N0-T03 | 25 jornais mesmo facto | Um evento com publicações distintas verificadas |
| N0-T04 | Títulos parecidos, eventos diferentes | Não fundir |
| N0-T05 | Empresas com nomes semelhantes | Não atribuir identidade arbitrária |
| N0-T06 | Mesmo ticker em bolsas diferentes | Resolução segura ou ambiguidade |
| N0-T07 | Empresa com várias cotações | Evento associado primeiro ao emissor quando adequado |
| N0-T08 | Empresa detida por ETF | Relação \`INDIRECT_EXPOSURE\`, não direta |
| N0-T09 | Rumor não confirmado | Não promover a facto confirmado |
| N0-T10 | Republicações de uma mesma fonte | Não contar como independência |
| N0-T11 | Publicação recebida depois do cutoff | Não aparece no passado |
| N0-T12 | Correção depois do cutoff | Não aparece antes da correção |
| N0-T13 | Identity link criado depois do cutoff | Não aparece historicamente |
| N0-T14 | Fusão/split posterior | Histórico anterior reproduzível |
| N0-T15 | Reprocessamento/idempotência | Sem efeitos duplicados |
| N0-T16 | Fornecedor offline | Falha explícita, sem dados inventados |
| N0-T17 | Resposta externa malformada | Rejeitada |
| N0-T18 | SSRF/redirect para IP interno | Bloqueado |
| N0-T19 | Prompt injection num artigo | Nunca executado |
| N0-T20 | Duas contas distintas | Isolamento de dados privados |
| N0-T21 | Investing e Trading | Mesmos contratos, sem dependências reversas |
| N0-T22 | Paginação + PIT | Sem omissões, duplicados ou informação futura |
| N0-T23 | Classificação sem evidência | Não confirmar sem suporte |
| N0-T24 | Falha transacional de revisão | Sem metade do estado gravado |
| N0-T25 | Zero sessões, dois ciclos | Recolha e consulta reais provadas |
| N0-T26 | Crash entre fetch e persistência | Recovery sem duplicação |
| N0-T27 | Período de indisponibilidade | Backfill/checkpoint correto |
| N0-T28 | Conflito de relógio do fornecedor | Flag, sem falsificar \`asKnownAt\` |
| N0-T29 | Duas tarefas concorrentes mesmo item | Uma única revisão/evento lógico |
| N0-T30 | Lista vazia com fonte funcional | \`AVAILABLE\` com \`data=[]\`, não erro |
| N0-T31 | Evento futuro agendado | \`scheduledFor\` não é \`occurredAt\` |
| N0-T32 | Recuo temporal de evidência derivada | Consulta PIT exclui classificação futura |

N0 valida a **definição e consistência** dos testes; N1–N5 executam as provas conforme o alcance de cada fase. Não reportar \`PASS\` sem execução concreta.

### 11. Caminho de implementação

- **N0** — contrato, auditoria e especificação canónica versionada.
- **N1** — adaptadores reais, cursor de recolha e execução autónoma mínima, com armazenamento durável.
- **N2** — identidade e deduplicação com correspondências seguras.
- **N3** — classificação factual, evidências, revisões PIT e consultas históricas.
- **N4** — testes reais, recuperação, segurança e auditoria independente.
- **N5** — API de consumo, observabilidade e ensaio end-to-end com **zero sessões**. Depois disto o serviço pode ser classificado como operacionalmente concluído.

Sem novas subfases por defeito. Alterações ao contrato exigem revisão explícita, nova versão e provas de regressão.

### 12. Auditoria N0 — registo de alterações à proposta anterior

| Questão | Correção adotada | Estado |
|---|---|---|
| Vigilância autónoma tratada como futura/opcional | Passa a requisito N0-AUT-001 inegociável | Resolvido na especificação |
| Identidade inferida por símbolos | Separação entre descrições e registo canónico \`EXACT\` | Resolvido na especificação |
| Falta de PIT nas relações e classificações | Revisões e cutoffs independentes para entidades/eventos/evidências/links | Resolvido na especificação |
| \`CORRECTED\` misturado com confirmação | Separação de confirmação e ciclo de vida | Resolvido na especificação |
| Cache de mercado confundível com armazenamento | Armazenamento durável próprio; sem dependência de cache de 30s | Resolvido na especificação |
| Histórico de eventos com N:N não explícito | Ligação publication-event própria e versionada | Resolvido na especificação |
| Consulta sem resultados confundida com falha | \`AVAILABLE\` com lista vazia | Resolvido na especificação |
| Fontes externas como instruções/URLs de confiança | Fronteira SSRF e prompt injection | Resolvido na especificação |
| Compatibilidade com PRs Draft presumida | Integração apenas com contrato comprovadamente disponível | Resolvido na especificação |
| Auditoria independente executada | Ainda não existe validação externa independente | **Pendente** |

**Gate:** esta versão fica congelada **como candidata**; \`N0_APPROVED\` requer auditoria independente da especificação e correção de eventuais bloqueios. Nenhum teste N1–N5 foi executado, nenhum feed foi integrado e não se pode declarar News Core funcional ou 24/7 neste momento.

### Fontes de compatibilidade no repositório
- \`market-data-core/identity.ts\` (main);
- \`market-data-core/consumerMarketService.ts\` (main);
- \`market-data-core/contracts.ts\` (main);
- \`market-data-core/dynamicMarketGateway.ts\` (main);
- \`docs/market-data/PERSONAL_RELEASE_READINESS.md\` (main).
