# News Core - execucao autonoma com Vercel Daemons (referencia nao ativa)

Estado: desenho preparado para revisao humana. Nao e configuracao de deploy e
nao autoriza qualquer alteracao no projeto Vercel.

## Decisao

O News Core e tecnicamente compativel com um worker pull-based de longa duracao:

- `scripts/news-supervisor.ts` continua a ser o entrypoint do processo;
- N1 e FACTUAL usam as filas PostgreSQL, leases, fencing, checkpoints e backoff
  ja existentes;
- o processo nao precisa de sessoes web nem de pedidos HTTP de entrada;
- a durabilidade permanece em PostgreSQL, nunca na memoria do processo ou no
  ciclo de vida do container;
- um restart pode interromper uma tarefa, por isso a recuperacao depende de
  leases expirados, retries e idempotencia ja testados.

Vercel Daemons e uma opcao de infraestrutura a validar, nao uma prova de
producao. O ambiente de destino ainda nao foi inspecionado nem autorizado.

## Configuracao de referencia (nao ativa)

Aplicar apenas depois de validar projeto, regiao, plano, variaveis e
conectividade PostgreSQL/Supabase. Nao adicionar ao `vercel.json` sem aprovacao.

```toml
# vercel.daemons.example.toml
[daemons.news-core]
root = "."
entrypoint = "Dockerfile.news-daemon"
command = ["node", "--import", "tsx/esm", "scripts/news-supervisor.ts"]
instances.iad1 = 1
```

O supervisor deve arrancar em modo `FACTUAL` com configuracao completa. A
ausencia de uma variavel obrigatoria deve terminar em fail-closed; `N1-only` so
pode ser usado quando explicitamente configurado e registado.

## Imagem de referencia

Se Daemons for escolhido, a imagem minima pode instalar as dependencias travadas,
copiar o codigo necessario e executar o supervisor existente:

```dockerfile
# Dockerfile.news-daemon (template; nao usado por CI nem por deploy local)
FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY scripts ./scripts
COPY news-core ./news-core
COPY tsconfig.json ./tsconfig.json
ENV NEWS_EXECUTION_MODE=FACTUAL
CMD ["node", "--import", "tsx/esm", "scripts/news-supervisor.ts"]
```

O template nao contem credenciais e nao deve embutir `.env`, chaves ou dumps.
Nao e necessario instalar Docker para o desenvolvimento habitual; o fluxo local
continua a usar `npm run news:supervisor`.

## Compatibilidade e limites a validar no destino

Antes de qualquer deploy, obter prova de:

1. Daemons disponivel no plano e na regiao escolhida.
2. Variaveis secretas e `DATABASE_URL`/TLS acessiveis pelo processo, sem roles
   administrativas.
3. Capabilities `news_service`, `news_factual_writer` e leitor com os mesmos
   grants/RLS do rehearsal PG17.
4. Limites de CPU, memoria, reinicio, numero de instancias e politicas de
   escala; uma instancia por regiao e a configuracao inicial conservadora.
5. Logs sanitizados, metricas e alertas para backlog, retries, leases, ultimo
   sucesso e indisponibilidade SEC.
6. Protocolo de termination/restart observado no ambiente de destino.

Nao ha garantia de que um job interrompido termine automaticamente: o worker
deve confirmar trabalho duravel e recuperar tarefas OPEN/PENDING/PROCESSING.
Daemons nao deve ser tratado como endpoint de entrada nem como substituto do
PostgreSQL.

## Estimativa de custo

Nao ha custo real calculado sem plano, regiao, numero de instancias e memoria.
Usar esta formula no sizing aprovado:

`custo mensal ~= CPU_h_ativas * preco_CPU + GB_h_provisionados * preco_memoria + armazenamento`

Comparar o resultado com os creditos e precos vigentes do plano Vercel no momento
da aprovacao. Os valores publicados podem mudar e nao constituem cotacao para
este projeto.

Para o sizing preliminar de novembro de 2026, usando os valores publicados para
Daemons beta ($0.128 por CPU-hora ativa apos 5 horas incluidas e $0.0212 por
GB-hora de memoria provisionada apos 420 GB-horas incluidas), uma instancia de
1 vCPU/2 GB durante 24 horas representa aproximadamente $2.43 de CPU e 48
GB-horas de memoria; durante 48 horas, aproximadamente $5.50 de CPU e 96
GB-horas de memoria. Estes calculos sao incrementais aproximados, assumem uma
unica instancia e nao incluem plano, impostos, armazenamento, rede ou outras
execucoes do projeto. O teto proposto de $10 e um limite de planeamento, nao uma
garantia de billing nem uma autorizacao de despesa.

Nao foi encontrada neste gate uma garantia de hard cap que interrompa
automaticamente a instancia ao atingir $10. A ativacao deve exigir alertas,
limite operacional externo e um procedimento humano de paragem; sem isso, a
recomendacao e nao ativar.

## Rehearsal isolado de 24-48 horas

Executar somente com autorizacao humana num projeto/base isolados:

1. criar PG17, roles segregadas e baseline vazio;
2. arrancar supervisor FACTUAL sem navegador ou sessao web;
3. executar dois ciclos SEC e verificar checkpoints, fingerprints e ausencia de
   duplicados;
4. provocar `SIGKILL`, indisponibilidade SEC e expiracao de lease;
5. verificar restart, fencing, backoff, fairness, backfill e leitura N5 PIT;
6. registar CPU, memoria, backlog, retries, leases, ultimo sucesso, erros
   sanitizados e custo estimado;
7. repetir durante 24-48 horas com limites de consumo e criterio de abortar;
8. classificar separadamente a prova local/CI e a prova do ambiente de destino.

Este ensaio nao transforma estabilidade observada em garantia absoluta de
disponibilidade. `N0-AUT-001` permanece obrigatorio e `NOT_PROVEN` ate a prova
de destino ser auditada.

## Gate de imagem

`Dockerfile.news-daemon`, `.dockerignore.news-daemon` e
`vercel.daemons.example.toml` sao artefactos de referencia. O workflow
`.github/workflows/news-daemon.yml` constroi a imagem em Ubuntu com Docker,
verifica Node/`pg`/`tsx`, confirma fail-closed sem as tres capabilities factuais
e executa os smoke suites existentes. Nenhum destes ficheiros altera o
`vercel.json` ativo ou faz deploy.
