# News Core N2-B — ponte canónica read-only

Estado: candidato em Draft, empilhado sobre PR #93 / N2-A congelado.

## Compatibilidade verificada

A `main` efetiva expõe `market-data-core/identity.ts` e
`market-data-core/instrumentDiscovery.ts`. Esses módulos distinguem descrições
de mercado de identidade canónica e reservam `EXACT` para identidades com
`issuerId`, `instrumentId` e/ou `listingId` comprovados. Ticker, nome, MIC ou
domínio isolados não são suficientes. A `main` não contém um resolver de
produção integrado ao News Core.

N2-B usa por isso `MarketCoreIdentityResolverV1`, uma interface injetável,
versionada e read-only. O News Core não copia o Market Core, não escreve no seu
registo e não cria IDs canónicos quando o resolver está indisponível.

## Contrato da ponte

`market-core-identity-v1` recebe apenas a publicação/revisão e a referência do
documento. Devolve um estado (`EXACT`, `AMBIGUOUS`, `UNRESOLVED` ou
`REVIEW_REQUIRED`), uma versão do resolver, candidatos e evidência.

`EXACT` exige seleção explícita e IDs compatíveis com o âmbito:

- `ISSUER`: apenas `issuerId`;
- `INSTRUMENT`: `instrumentId`;
- `LISTING`: `instrumentId` e `listingId`.

Os estados não-EXACT conservam candidatos e evidências, mas os campos canónicos
da ligação ficam nulos. Relações aceites: `DIRECT`, `MENTION`, `SUBSIDIARY` e
`INDIRECT_EXPOSURE`. Uma notícia sobre um emissor não cria automaticamente uma
ligação a todas as cotações.

## Persistência e PIT

`entity_link_revisions` é append-only e versiona cada resultado do resolver.
`entity_link_candidates` guarda alternativas; `entity_link_evidence` guarda a
proveniência de cada candidata. A chave de idempotência é o fingerprint do
resultado completo, por publicação/revisão e versão do resolver.

As ligações entram `PENDING`, recebem uma fronteira própria e só passam a
`COMMITTED` após a mesma finalização transacional N1/N2-A. A finalização impõe
um limite mínimo igual ao `asKnownAt` da revisão de publicação dependente.
Consequentemente, uma ligação criada depois não aparece num cutoff anterior.
Falhas antes do commit fazem rollback; falhas depois do commit são recuperadas
por `recoverPending()` sem duplicação.

A leitura passa exclusivamente pela função PIT
`news_core.read_entity_links_as_of`; as tabelas brutas não são concedidas a
`news_reader`.

## Fora de âmbito

Não há matching automático entre fornecedores, classificação factual,
corroboração, APIs públicas, preços, carteiras, Ledger, Trading ou Investing.
Fixtures de testes representam respostas do contrato da ponte; não são prova
de que um resolver Market Core de produção já esteja ligado.
