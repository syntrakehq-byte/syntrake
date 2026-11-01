# R3-E1 — operação manual Twelve Data (uma chamada)

Esta operação não é chamada por uma rota pública, worker, scheduler ou GitHub Actions.
O gate está fechado por defeito e aceita apenas `VERCEL_ENV=preview`,
`SYNTRAKE_R3E1_REAL_CALL_ENABLED=confirm-once`, `SYNTRAKE_R3E1_APPROVED_ENV=preview`
e `SYNTRAKE_R3E1_APPROVED_SHA` exatamente igual ao SHA do checkout autorizado.
Production é rejeitado explicitamente.

Guardar a chave somente no gestor de segredos local/CI do ambiente Preview, como
`SYNTRAKE_TWELVE_DATA_API_KEY`; nunca em Git, `.env` versionado, issue, PR ou chat.
Não imprimir o ambiente completo. O script imprime apenas símbolo, MIC, moeda, data,
intervalo e contadores de uso sanitizados quando o fornecedor os envia.

Procedimento, somente após autorização separada do proprietário:

```powershell
$env:VERCEL_ENV = "preview"
$env:VERCEL_GIT_COMMIT_SHA = "<SHA_EXATO_DO_CHECKOUT>"
$env:SYNTRAKE_R3E1_REAL_CALL_ENABLED = "confirm-once"
$env:SYNTRAKE_R3E1_APPROVED_ENV = "preview"
$env:SYNTRAKE_R3E1_APPROVED_SHA = $env:VERCEL_GIT_COMMIT_SHA
$env:SYNTRAKE_TWELVE_DATA_API_KEY = (Get-Secret SYNTRAKE_TWELVE_DATA_API_KEY)
npm run twelve-data:real:once
Remove-Item Env:SYNTRAKE_TWELVE_DATA_API_KEY
```

O processo permite uma única chamada; qualquer timeout/erro é tratado como potencialmente
consumido e não há retry. Esta entrega não executa o comando.
