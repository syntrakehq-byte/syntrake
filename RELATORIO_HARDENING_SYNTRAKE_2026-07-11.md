# Relatorio de Hardening Syntrake - 2026-07-11

## Estado executivo

O hardening institucional foi executado sem alterar logica quantitativa, Decision Engine, Scanner, Research Lab semantics, Paper Trading, Promotion ou APIs publicas.

Estado final dos gates:

- TypeScript: `npx tsc --noEmit --pretty false` passou.
- Lint: `npm run lint` passou.
- Build: `npm run build` passou.
- Prod audit: `npm audit --omit=dev` passou com 0 vulnerabilidades.
- Testes: `npx vitest run` passou com 197 ficheiros e 708 testes verdes; 15 ficheiros/22 testes skipped intencionalmente.

## Problemas resolvidos

| ID | Resultado | Evidencia |
| --- | --- | --- |
| SYN-005 | Resolvido | Fixtures de testes alinhadas com contratos TypeScript atuais; `tsc` verde. |
| npm-audit | Resolvido | Overrides seguros para `@clerk/shared`, `js-cookie` e `ws`; audit prod com 0 vulnerabilidades. |
| SYN-006 | Resolvido | CI deixa de fazer `exit 0` quando audits de producao nao podem executar por falta de secrets. |
| SYN-001 | Resolvido | Investing core tables passam a ter RLS e policies owner-scoped por JWT subject. |
| SYN-002 | Resolvido | `paper_trades` recebe policies owner-scoped; mirrors Research Lab/scanner ficam explicitamente service-role only. |
| SYN-004 | Endurecido | Guard test impede import acidental de modulos stub no entrypoint canonico v4. |
| SYN-008 | Endurecido | Testes garantem que default plan automatico nao sobrescreve plano existente e fica marcado como `auto-default`. |
| SYN-009 | Endurecido | Testes garantem que producao nao cai silenciosamente para memory fallback quando persistence esta indisponivel. |
| SYN-RL-001 | Resolvido anteriormente | Sync Supabase evita overwrite regressivo de metricas acumuladas na mesma baseline salvo override explicito. |

## Risco residual

- Migrations RLS devem ser aplicadas primeiro em staging, validando JWT claim `sub` contra os `user_id` reais.
- Os ficheiros grandes (`daily-bundle/route.ts`, `TradingTab.tsx`) continuam como divida P2; nao foram refatorados para evitar regressao.
- Modulos v4 marcados como stub continuam estacionados; nao foram implementados porque isso alteraria comportamento funcional.
- Regex de limpeza de mojibake permanece intencionalmente com sequencias corrompidas para conseguir normalizar input corrompido.

## Plano de rollback

- Dependencias: remover overrides de `@clerk/shared`, `js-cookie`, `ws` e restaurar `package-lock.json`.
- CI: reverter `.github/workflows/ci.yml`.
- RLS: aplicar migration reversa removendo policies novas ou reverter migration antes de aplicar em ambiente alvo.
- Testes/guardrails: reverter ficheiros em `tests/*Hardening.test.ts` e testes RLS relacionados.
- Research Lab sync: definir `RESEARCH_SUPABASE_ALLOW_REGRESSIVE_STATE=1` apenas para reset/rebuild intencional, ou reverter a alteracao de `supabaseSync.ts`.

## Proposta de commits

1. `fix(test): restore TypeScript contract compatibility`
2. `chore(security): clear production dependency audit`
3. `ci: fail production audits when required secrets are missing`
4. `chore(db): add owner-scoped RLS policies for canonical tables`
5. `test: add institutional hardening guardrails`
6. `fix(research): prevent regressive Research Lab state overwrite`
7. `chore(investing): document canonical investing boundaries`

