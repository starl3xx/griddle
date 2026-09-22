# Stripe fulfillment: how a payment becomes premium, and how to check it

A fiat purchase becomes premium in exactly one place: the
`checkout.session.completed` webhook at `/api/stripe/webhook`. Every
other mechanism in the system — the `griddle:escrow-retries` queue, the
`EscrowBurned` / `EscrowRefunded` scan — starts from a row that webhook
already wrote. If the webhook never fires, none of them can help,
because there is nothing for them to advance.

That failure mode is silent by construction: Stripe reports the payment
as successful, the buyer is charged, and no error appears anywhere in
the app.

## The check that catches it

`/api/cron/sync-escrow-burns` runs hourly and, as its third step, asks
Stripe for every paid checkout session in the last 7 days and verifies
each one has a record. See `lib/stripe-reconcile.ts`.

A session counts as recorded when **either**:

- `premium_users.external_id` equals `keccak256(session.id)` — the
  wallet path, and the row that actually grants premium; or
- `profiles.stripe_session_id` equals the session id — the email-only
  path, whose premium lives in a session KV key.

Both tables are checked because the wallet path's `profiles` write is
deliberately non-fatal, so it can be absent from an otherwise healthy
purchase. Checking one table alone either invents gaps or misses them.

Outcomes per gap:

| Outcome | Meaning | Action |
| --- | --- | --- |
| `healed` | Row written, escrow opened. | None. |
| `healed_escrow_deferred` | Row written, buyer has premium, escrow queued for retry. | None; the queue drains next hour. |
| `healed_escrow_unqueued` | Row written, buyer has premium, but the escrow neither opened nor reached the retry queue. | Open the escrow by hand. Nothing will retry this on its own. |
| `heal_failed` | Nothing written. Buyer still has nothing. | Investigate now. |
| `heal_deferred` | Not attempted this run — heal budget spent, or Stripe could not be read. | None; the next run retries it. |
| `needs_manual_refund` | Wallet already premium from another purchase or grant. | Refund the duplicate charge in Stripe. |
| `no_wallet_anchor` | Anonymous buyer, nothing durable to attach premium to. | Contact the buyer; grant by hand once they connect a wallet. |

Two states are deliberately **not** gaps and never appear in the list:

- **Charged within the last 15 minutes.** The window is measured from
  the charge, not from the checkout session, because a buyer can hold
  an open session for an hour and pay seconds before the cron runs.
  Judging by session age would race a webhook still in flight and
  could put two `unlockForUser` calls on the chain at once.
- **Refunded or disputed.** A Checkout Session reports
  `payment_status: 'paid'` forever, including after a full refund, so
  the charge behind it is what gets checked. Money that went back is
  not a delivery gap.

A **truncated** run alerts on its own, even when it found no gaps: it
stopped before examining everything, so "no gaps" is an unfinished
check rather than a result.

`no_wallet_anchor` is never healed automatically. The only anchor
available is the email Stripe collected, which is unverified, and
writing it onto an existing profile is an account-takeover vector that
`recordFiatUnlock` already refuses. A person decides that case.

Set `OPS_ALERT_EMAIL` for the alert to be sent. Without it the gap is
still logged and still returned in the cron's JSON, but nobody is told.

## Checking the webhook by hand

Run these against the live account when a payment is in doubt.

```sh
# 1. Is anything subscribed at all? An empty list means every live
#    payment is being silently dropped.
stripe webhook_endpoints list --live --project-name griddle

# 2. Did a specific event reach an endpoint? `pending_webhooks: 0`
#    with no endpoint in the list means nobody was ever notified.
stripe events retrieve <evt_id> --live --project-name griddle

# 3. Does the buyer have premium?
curl -sL https://www.griddle.fun/api/premium/<wallet>
```

Two traps, both of which have cost a real sale:

- **The endpoint URL must use the `www` host.** `griddle.fun` answers
  307 and redirects to `www.griddle.fun`. Stripe does not follow
  redirects, so an apex URL is a failed delivery every time.
- **The path is `/api/stripe/webhook`.** There has never been a route
  at `/api/premium/stripe-webhook`.

Locally, use `stripe listen --forward-to localhost:3000/api/stripe/webhook`,
which mints its own signing secret. A test-mode endpoint pointed at
production cannot work: production verifies with the live signing
secret and rejects every test-signed payload.

## Changing the signing secret

Creating a new endpoint in Stripe issues a new `whsec_`. Put it in the
Vercel `STRIPE_WEBHOOK_SECRET` production variable and **redeploy** — an
environment change does not reach the running deployment on its own.
Until that redeploy lands, every delivery fails signature verification
and the reconcile above is what keeps buyers whole.
