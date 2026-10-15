# Syntrake Site

Syntrake is a Next.js app that turns a user profile + portfolio state into a daily execution workflow:
- profile intake
- plan activation
- broker/manual execution checklist
- proof logging and discipline tracking

## 1) Local setup

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## 2) Required environment variables

Use `.env.example` as reference. Minimum required for production:
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- monthly Stripe price ids (`STRIPE_PRICE_ID_EARLY`, `STRIPE_PRICE_ID_STANDARD`)
- optional annual Stripe price ids (`STRIPE_PRICE_ID_EARLY_ANNUAL`, `STRIPE_PRICE_ID_STANDARD_ANNUAL`) if you want to expose annual checkout
- `CRON_SECRET` (required for `/api/engine/loop` in production)

## 3) Scripts

```bash
npm run dev          # local development
npm run test         # vitest unit tests
npm run lint         # eslint
npx tsc --noEmit     # typecheck
npm run build        # production build
npm run verify       # test + lint + typecheck + build
npm run audit:prod   # prod dependency audit
```

## 4) Production hardening notes

- `/api/engine/loop` is blocked in production unless `CRON_SECRET` or `ENGINE_LOOP_SECRET` is configured.
- Stripe portal return URLs are restricted to same-origin to prevent open redirects.
- `user-settings`, `setup/complete`, and broker store now fail fast in production when persistence is unavailable (unless `ALLOW_MEMORY_FALLBACK=1`).
- `/api/health` returns `503` when degraded.

## 5) Deploy to Vercel

1. Create project in Vercel.
2. Add all required env vars from `.env.example`.
3. Ensure `CRON_SECRET` is set (cron calls `/api/engine/loop` from `vercel.json`).
4. Deploy.
5. Validate:
   - `/api/health` should return `200` and `ok: true`
   - signup/signin works (Clerk)
   - checkout + portal works (Stripe)
   - daily flow works for connected and manual broker users

## 6) Release checklist

- `npm run verify` passes
- `npm run audit:prod` returns no production vulnerabilities
- Stripe webhook endpoint configured in dashboard
- Clerk production keys active
- Supabase service role configured
- Disclaimer/terms pages reviewed by legal

## 7) Important

Syntrake is an execution and discipline product. It does not guarantee returns or eliminate market risk.

## 8) Android app path

- PWA install is enabled (`/manifest.webmanifest` + `/sw.js`).
- Android users can install from Chrome (`Menu -> Install app`).
- For Google Play release using Trusted Web Activity (TWA), follow:
  - `docs/android-launch-playstore.md`


