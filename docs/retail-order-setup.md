# Retail custom-order activation

The retail order workflow stores order requests in the existing D1 `DB` binding and private design files in the existing R2 `PRIVATE_ASSETS` binding under `retail-orders/`. It uses the existing `CLOUDFLARE_EMAIL_API_TOKEN` sender and existing `ADMIN_REVIEW_TOKEN` admin authentication. It does not change pilot or wholesale records.

## Required Cloudflare setup before accepting live orders

1. Confirm the existing Pages project `snapink` has bindings named `DB` (D1) and `PRIVATE_ASSETS` (R2) in production. Do not substitute the model or backup buckets for customer artwork.
2. Review migration `0011_retail_orders.sql`, then apply it to the production D1 database configured for Pages. The application returns a clear unavailable response until these tables exist. This migration has not been applied remotely as part of the source-code change.
3. Configure these Cloudflare Pages production secrets (and preview equivalents if testing previews):
   - `STRIPE_SECRET_KEY` — Stripe restricted/secret key with permission to create Checkout Sessions.
   - `STRIPE_WEBHOOK_SECRET` — signing secret for the webhook endpoint below.
   - Existing `CLOUDFLARE_EMAIL_API_TOKEN` — Cloudflare Email Sending API token. Never place any of these values in frontend code or repository files.
4. Set the Pages environment variable `STRIPE_AUTOMATIC_TAX_ENABLED=true` only after Stripe Tax is enabled for the Stripe account and its tax registrations, product tax defaults, shipping tax treatment, and customer address settings are reviewed. The workflow deliberately refuses approval/payment-session creation unless this is enabled; tax is exclusive and appears as a separate Stripe-calculated amount.
5. In Stripe, register `https://snapbacksleeves.com/api/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.expired`. Store the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`. Keep webhook retries enabled.
6. Test the complete order, approval, tax, email, payment, and webhook flow with Stripe test credentials and Cloudflare preview resources before setting production credentials. Never point preview code at the production D1/R2 resources.

## Migration command

Review the actual D1 binding/database configuration in the `snapink` Cloudflare Pages project first. Once approved by the resource owner, apply the migration using the configured database name, for example:

```powershell
npx wrangler d1 migrations apply snapink_waitlist --remote
```

Do not run this command against production until the migration has been reviewed and the target database confirmed in Cloudflare. `wrangler.toml` may contain local or historical configuration and is not proof of the active Pages bindings.

## Order status flow

`PENDING_REVIEW` → `CHANGES_REQUESTED` or `DECLINED`, or admin approval → `AWAITING_PAYMENT` → verified Stripe webhook → `PAID` → owner-controlled fulfillment updates `IN_PRODUCTION` → `SHIPPED` → `COMPLETED`.

Admin approval creates one order-specific Stripe Checkout Session with an idempotency key. It does not charge a card. The session amount is checked against the server-calculated merchandise discount and shipping; Stripe Tax calculates any applicable tax at checkout. A returning browser is never treated as proof of payment.

Customer artwork, Studio SVG, and preview PNG are private R2 objects. Admin file access is protected by the existing `ADMIN_REVIEW_TOKEN` authorization. Email provider acceptance is recorded separately from order persistence; the dashboard provides retry actions for failed notifications.
