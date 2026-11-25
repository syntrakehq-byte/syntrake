# SYNTRAKE News Core — camada de descoberta noticiosa mundial (candidata)

## Objetivo

As sete fontes oficiais alimentam evidência institucional, mas não cobrem
de forma ampla notícias diárias de empresas, mercados, indústria e geopolítica.
Este incremento adiciona **GDELT Project DOC 2.0** como *índice global de
descoberta*, num perfil opcional do worker e sem criar um segundo News Core.

## Feed e natureza da informação

- API de origem: https://api.gdeltproject.org/api/v2/doc/doc
- Consulta fixa no servidor: economia, inflação, bancos centrais, bolsas,
  sanções e energia; notícias indexadas das últimas 24 horas
- `mode=artlist`, `format=jsonfeed`, até 20 links, ordenação cronológica
- Conteúdo armazenado: metadados estritamente necessários, títulos e links
  HTTPS de terceiros; **sem corpos de artigos, imagens nem resumos**
- Flags obrigatórias: `THIRD_PARTY_DISCOVERY_INDEX`,
  `PUBLISHER_UNVERIFIED`, `RIGHTS_METADATA_ONLY`
- Identidade de origem preservada: `GDELT Project (news discovery index)`.
  Não apresentar GDELT como o autor do artigo original nem tratar uma notícia
  indexada como prova independente do acontecimento
- Atribuição GDELT: https://www.gdeltproject.org/
- Os direitos de cada publicação original permanecem com o respetivo titular
- O serviço público pode limitar pedidos; não usar polling agressivo

## Configuração explícita e sem ativação automática

```
NEWS_GLOBAL_SOURCES_PROFILE=official-plus-world-index-v1
```

Configura **8 fontes lógicas**: sete feeds institucionais já testados e um
índice de notícias mundiais GDELT. O perfil antigo
`official-expanded-v1` mantém as sete fontes oficiais. Sem configuração,
o daemon não ativa fontes RSS globais por defeito.

A configuração não efetua migrations, deploy, pagamentos ou ligação a
instâncias de produção. A prova de operação 24/7 continua pendente.

## Google News RSS e outros media

A integração direta de Google News RSS para reutilização comercial
não foi ativada devido às restrições de serviço publicadas:
https://www.google.com/intl/en_us/terms_google_news.html

RSS de jornais também pode estar limitado a uso pessoal; confirmar regras
específicas antes de o ligar a distribuição comercial. Por exemplo, a BBC
exige autorização para uso empresarial dos seus feeds RSS, e a Guardian
limita o RSS comum a usos pessoais não comerciais.

GDELT disponibiliza os seus dados para uso comercial com atribuição
(https://www.gdeltproject.org/about.html#termsofuse), mas tal não
autoriza republicar conteúdos completos de terceiros.

## Testes e prova

1. Testes de fixture confirmam validação, proveniência, metadata-only,
   perfil opcional e nenhum acesso automático aos URLs dos artigos.
2. Gate CI de GDELT com fonte real tenta o caminho GDELT -> PostgreSQL 17 ->
   N5. O resultado externo deve ser reportado separadamente; o gate marca
   `continue-on-error` porque os limites/indisponibilidade do fornecedor
   não são regressões determinísticas do código.
3. Uma resposta sem items ou HTTP 429 **não equivale a prova de receção**.
4. Nenhum ensaio CI prova cobertura global exaustiva, veracidade de
   notícias de terceiros ou autonomia contínua.

Estado: **PR Draft, sem merge e sem deploy**.
