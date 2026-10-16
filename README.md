# Syntrake

Syntrake is a Next.js commercial landing and account experience powered by Clerk and Stripe.

## Local setup

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Required environment variables

Use `.env.example` as the reference. Production requires Clerk, Stripe and the public application URL:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- Stripe price IDs used by the pricing page

## Useful commands

```bash
npm run dev
npm run lint
npx tsc --noEmit
npm run build
npm run verify
npm run audit:prod
```

## Deploy to Vercel

1. Create or select the new Vercel project.
2. Connect the Syntrake GitHub repository.
3. Add the Clerk and Stripe environment variables.
4. Deploy with the default Next.js settings.

Syntrake does not custody funds or execute external transactions. Account access is handled by Clerk and subscriptions are handled by Stripe.
