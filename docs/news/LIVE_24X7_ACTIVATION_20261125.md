# SYNTRAKE — passagem controlada do News Core para 24/7

**Estado:** CANDIDATO. Não é aprovação de produção. O PR desta alteração
prepara a leitura persistente do site, mas não cria roles, não migra a base
de produção e não liga um daemon com consumo faturável.

## Estado observado em 2026-11-25

- `www.syntrake.com/news`: página privada, com RSS consultado a pedido.
- Supabase `syntrake`: PostgreSQL 17.11, sem esquema `news_core` e sem
  `news_reader` / `news_service`.
- Supabase `syntrake-g3-preview`: também PG17.11 e sem esses objetos.
- Vercel: projeto `syntrake` no plano Hobby. O Cron Jobs do Hobby
  executa no máximo uma vez por dia; **não** usar cron Vercel do Hobby
  como substituto de um worker financeiro de notícias.
- `scripts/news-supervisor.ts` e `scripts/news-postgres-worker.ts` já
  implementam ciclos independentes de sessões web, leases e checkpoints.
- Perfil recomendado inicial: `official-plus-daily-news-v1`, 10 RSS
  (7 institucionais + ONU News/France 24/CNBC). GDELT continua NÃO
  comprovado ao vivo devido a HTTP 429.
- `NEWS_CORE_PRODUCTION_READY=NO` e `N0-AUT-001=NOT_PROVEN` até ao ensaio
  real prolongado, com evidências e revisão de segurança/direitos.

## 1. Preparação da base (não executar automaticamente)

Escolher um destino explícito PostgreSQL 17 com durabilidade, backups,
região adequada, custos conhecidos e mecanismos de recuperação. Antes de
qualquer migração remota: rever ordem completa das migrations News,
compatibilidade de funções, permissões `SECURITY DEFINER` e
`search_path`, roles já existentes, conflitos entre schema e aplicação
e reversibilidade. Fazer primeiro rehearsal numa base isolada. A base
de produção não pode ser alterada pela simples existência deste PR.

Os papéis `news_service`, `news_reader`, `news_pipeline_verifier`,
`news_factual_attestor` e `news_factual_writer` devem continuar
segregados. Criar logins específicos, sem BYPASSRLS, com credenciais
aleatórias guardadas apenas no gestor de secrets. Nunca usar o login
`postgres` nem uma URL do Investing para o leitor do site.

A base precisa das migrations N1–N-G8 aplicadas integralmente e verificadas
na ordem revista, sem reaplicar funções de tipo de retorno incompatível.

## 2. Worker 24/7

Utilizar a imagem `Dockerfile.news-daemon` e o entrypoint
`scripts/news-supervisor.ts` **num serviço de longa duração**.
Vercel Daemons é candidato, mas requer confirmação explícita da
disponibilidade no plano/região e dos custos. O `vercel.json` atual não
configura daemons, e o ficheiro `vercel.daemons.example.toml` é apenas
um exemplo, não ativo. Se usado, migrar o ficheiro de configuração Vercel
de forma controlada: o projeto deve ter apenas um formato ativo.

Configuração inicial proposta do worker:

- `NEWS_GLOBAL_SOURCES_PROFILE=official-plus-daily-news-v1`
- `NEWS_DATABASE_URL`: login writer isolado, TLS verificável
- `SEC_USER_AGENT`: contacto operacional válido
- `NEWS_EXECUTION_MODE=FACTUAL` com credenciais segregadas de verifier,
  attestor e writer, OU fase experimental explicitamente
  `NEWS_EXECUTION_MODE=N1_ONLY` sem alegar pipeline FACTUAL completo
- `NEWS_POLL_INTERVAL_MS=30000` para verificar a fila frequentemente;
  os intervalos reais por fonte e o backoff estão sujeitos à política
  do coletor, a rever antes da ativação
- supervisão do processo, limites de CPU/memória, restart automático,
  logs sem tokens e alertas por fonte

Não abrir portas de entrada nem colocar credenciais no Dockerfile.
O worker não depende de nenhum browser ou sessão do site.

## 3. Site: leitura PIT persistente

O código do site tem agora uma seleção **fail-closed**:

```
NEWS_SITE_READ_MODE=N5
NEWS_READER_DATABASE_URL=<URL de login com permissão SET ROLE news_reader>
NEWS_READER_CA_PEM=<certificado raiz PEM do PostgreSQL de destino>
```

Variáveis exclusivamente do servidor Vercel; nunca prefixar com
`NEXT_PUBLIC_`. O N5 autentica a leitura com capacidade interna,
valida o role `news_reader`, obtém publicações PIT de forma ordenada
e só expõe data, título, URL HTTPS, proveniência e flags. Não lê corpos
de artigos. Não usa credenciais de escrita, administração ou Trading.

Sem `NEWS_SITE_READ_MODE=N5`, o site continua no modo RSS a pedido.
Com `N5` mas sem DB/roles válidos, a página mostra a indisponibilidade
do histórico e NÃO finge que a recolha está operacional.

## 4. Aceitação e rollback

Antes de qualquer afirmação "24/7 operacional", exigir:

1. Migrations completas e roles com grants e testes de rejeição.
2. Worker ativo num host persistente independente de pedidos web.
3. Fontes RSS reais recolhidas e escritas com checkpoint durável.
4. Duas recolhas por fonte sem duplicados.
5. N5 sob role leitor realmente restrito; nenhum acesso DML.
6. Site privado apresenta histórico real, por fonte, com datas PIT.
7. Queda forçada do worker e reinício automático, sem perda de cursor.
8. Falha de uma fonte não interrompe as outras.
9. Evidência contínua 24–48h com logs/custos e alertas externos.
10. Revisão de direitos de cada RSS editorial e limitação a metadados.
11. Reversibilidade: desligar flag N5 e parar daemon sem alterar histórico.
12. `NEWS_CORE_PRODUCTION_READY` só pode mudar para YES depois da
    revisão formal, incluindo N0-AUT-001.

**Consultas exemplificativas read-only após ativação:**

```sql
select source_id, count(*) as publications, max(as_known_at) as last_known_at
from news_core.publications where visibility_state='COMMITTED'
group by source_id order by source_id;

select source_id, health, coverage, last_success_at, last_error_code
from news_core.global_operational_state order by source_id;

select collection_scope_key, consecutive_failures, last_success_at, next_run_at
from news_core.collection_targets order by collection_scope_key;
```

Não aplicar estes comandos a uma base que ainda não tenha o esquema.
Não misturar dados de CI com dados reais de produção.

## Resultado deste PR

Implementação da **leitura N5 preparada no site**, atrás de flag
controlada, com testes de links seguros e sem republicação de corpos.
O **daemon permanece candidato**: ativá-lo implica migrações, segredos
e eventualmente custos que precisam de autorização antes de alterações
persistentes ao serviço e à base de produção.
