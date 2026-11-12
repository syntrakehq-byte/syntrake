# News Core N2-C — relações editoriais

N2-C acrescenta uma camada editorial conservadora sobre os registos N1/N2-A/N2-B.

## Fronteiras

- Uma publicação é o documento editorial persistido.
- Uma observação é o relato de um fornecedor.
- Uma revisão é uma versão imutável da publicação.
- Um grupo editorial representa uma hipótese versionada de origem/republicação comum.
- Um evento estrutural é apenas um identificador de agrupamento; N2-C não confirma que um facto ocorreu.

Título, ticker, emissor ou proximidade temporal não produzem `EXACT`. Correspondências insuficientes permanecem `AMBIGUOUS` ou `REVIEW_REQUIRED`.

## Confiança da evidência

O campo `verified` regista apenas a asserção do produtor ou adaptador que forneceu a evidência; não prova uma fonte independente real. Evidência `PUBLICATION_TEXT` isolada nunca estabelece `EXACT`, e fixtures controladas não conferem autoridade de registry ou fornecedor.

## Contratos

`news-editorial-relations-v1` persiste snapshots append-only de membros de um grupo, evidência obrigatória e operações `ACTIVE`/`SEPARATED`.

`news-structural-event-links-v1` persiste relações muitos-para-muitos entre eventos estruturais e revisões de publicação. Ambos os contratos têm `asKnownAt` próprio, recuperação e idempotência.

As consultas `read_*_as_of` devolvem o estado efetivo; as variantes `*_history_as_of` devolvem o histórico completo. Ambas exigem que as fronteiras do derivado, da publicação, da revisão e das evidências sejam visíveis no cutoff.

N2-C não implementa confirmação factual N3, API pública N5, fusão destrutiva, identidade financeira ou acesso a Market Core, Investing, Trading ou Ledger.
