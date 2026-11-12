# N4 — segurança operacional e provas reais

Base normativa: N0 PR #90, SHA `a358cf9cc3e0427cefc18b02f6c3c653b2a61e7b` (`N0_REVIEW_READY`). A reconciliação N0 continua pendente; este relatório não declara `N0_APPROVED`.

## Provas executadas

- `sourceSecurityN4.test.ts`: rejeita HTTP, hosts não permitidos, loopback, RFC1918, link-local/metadata e redirecionamentos para destino privado; conteúdo hostil é tratado como bytes opacos.
- `secLiveN4.test.ts`: obtém em CI o endpoint oficial SEC EDGAR para CIK `0000320193`, calcula hash SHA-256 sanitizado da resposta, valida o CIK e confirma publicações com URL oficial, accession, fingerprint, `firstSeenAt` e proveniência do adapter.
- `securityBoundaryN4.test.ts` em PostgreSQL 17: usa uma role LOGIN não administrativa, sem membership em `news_factual_writer`; a role não lê tabelas factuais nem executa a selagem.

## Limite de segurança do writer

`news_factual_writer` permanece `NOLOGIN`, `NOINHERIT`, sem memberships e separado de `news_service`. Contudo, a própria capability continua a possuir INSERT factual e EXECUTE da selagem para suportar o store atual. Uma credencial que já consiga assumir diretamente essa capability ainda pode contornar a validação TypeScript. Este ponto permanece `BLOCKED` para isolamento de produção; a prova de uma role de aplicação sem membership não é apresentada como prova criptográfica contra comprometimento do writer.

## Operação e recuperação

Os gates N1/N2/N3-D existentes continuam a provar checkpoints, retries, rollback, leases, heartbeat, replay idempotente e PIT em PostgreSQL 17. A aquisição SEC real é agora exercitada separadamente. Permanecem `NOT_PROVEN` a supervisão 24/7, a recuperação autónoma de uma revisão factual OPEN sem replay acionado, resolução DNS/rebinding adversarial em rede controlada, fornecedores alternativos e consumo N5 ponta a ponta.

Sem credenciais reais, respostas confidenciais, fornecedores pagos, deploy ou migrações remotas.
