# Syntrake Launch Checklist (Beta -> Paid Product)

Last updated: 2026-02-26

## Current Status (Confirmed)

- `npm test` passes (`31/31`)
- `npm run lint` passes (no errors)
- `npm run build` passes
- Production deploy on Vercel is live (`signalcore-site.vercel.app`)
- `/api/health` returns `200` with `supabase`, `stripe`, `clerk` configured
- Daily intelligence stack is integrated (`V4/V5`, Perfect Loop, Audit, Paywall, Activation, Progression)
- Pricing resolver is live (`19 EUR early / 29 EUR standard`) and consistent across UI surfaces

## Exit Beta Criteria (Must-Have)

### 1. Product Reliability

- [ ] Run full manual QA on daily loop:
- [ ] New user -> Welcome -> Portfolio -> Daily -> Close Day -> next day
- [ ] Free user (`PREVIEW_ONLY`) flow
- [ ] Trial user (`FULL`) flow
- [ ] Pro user (`FULL`) flow
- [ ] HOLD day flow (progress + continuity visible, no confusion)
- [ ] Manual broker checklist flow (generate -> mark -> save -> readonly replay after day close)
- [ ] Action Dock flow (execute now, scroll, save/continue)

### 2. Mobile Usability

- [ ] Daily page usable on mobile (scroll, CTA visibility, no clipped content)
- [ ] Modal tables scroll correctly on mobile
- [ ] Portfolio add/edit rows usable on mobile
- [ ] Paywall modal readable and actionable on mobile

### 3. Billing / Entitlements (Before Live Stripe)

- [ ] Confirm `daily.billing` and `daily.paywall` states align in UI (`Free / Trial / Pro`)
- [ ] Confirm `PREVIEW_ONLY` blurs only execution details (not trust/progress/reasoning)
- [ ] Confirm pricing resolver outputs same amount on landing, pricing, in-app paywall
- [ ] Confirm monthly checkout selects correct price ID (early vs standard)

### 4. Domain & Production Readiness

- [ ] Add `syntrake.com` + `www.syntrake.com` to Vercel project (resolve current `403` domain ownership issue)
- [ ] Cloudflare DNS:
- [ ] `A @ -> 76.76.21.21` (DNS only for setup)
- [ ] `CNAME www -> cname.vercel-dns.com` (DNS only for setup)
- [ ] Confirm HTTPS active on both domains
- [ ] Set `NEXT_PUBLIC_APP_URL=https://syntrake.com`

### 5. Stripe Live (After Domain)

- [ ] Switch Stripe envs to live keys in Vercel
- [ ] Create live monthly prices (`Early 19`, `Pro 29`) and set:
- [ ] `STRIPE_PRICE_ID_EARLY`
- [ ] `STRIPE_PRICE_ID_STANDARD`
- [ ] Configure webhook endpoint: `https://syntrake.com/api/stripe/webhook`
- [ ] Test live checkout, trial, cancel, portal return, webhook sync

### 6. Clerk Live (After Domain)

- [ ] Switch Clerk project/keys to production
- [ ] Update redirect URLs to `https://syntrake.com/...`
- [ ] Confirm sign-up / sign-in / redirect back to app
- [ ] Confirm `free/trial/pro` metadata sync still works

### 7. Operational Basics (Strongly Recommended)

- [ ] Add error monitoring (e.g. Sentry) for frontend + API routes
- [ ] Add basic production alerts/log review for:
- [ ] `/api/daily-bundle`
- [ ] `/api/daily/close`
- [ ] `/api/stripe/checkout`
- [ ] `/api/stripe/webhook`
- [ ] `/api/decision/replay`
- [ ] Support inbox workflow configured (`support@syntrake`)

## Definition of â€œWorth 29 EUR/monthâ€ (Product Standard)

Syntrake should consistently deliver:

- A clear daily decision (`Today's Decision`)
- Risk-aware guidance (not random signals)
- Continuity and progress even on HOLD days
- Explainability (`why this decision`)
- Proof / audit / replay trust
- Measurable value perception (process quality, execution quality, continuity)

If reliability + billing + mobile + trust loops are stable, `29 EUR/month` is defensible.

## Notes / Known Non-Blocking Items

- Project folder name remains `signalcore-site` for compatibility.
- Some legacy routes/components remain for compatibility but do not block launch.
- No Git repo initialized in this folder (cannot commit/revert safely until `.git` exists).

