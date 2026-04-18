<div align="center">
  <img src="./public/icons/icon-192.png" alt="Griddle" width="120" />
  <h1>Griddle</h1>

  <p><strong>A daily 3×3 word puzzle. Find the hidden 9-letter word.</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js" alt="Next.js 14" />
    <img src="https://img.shields.io/badge/Base-0052FF?style=flat-square&logo=ethereum&logoColor=white" alt="Base" />
    <img src="https://img.shields.io/badge/Farcaster-855DCD?style=flat-square" alt="Farcaster" />
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Vercel-000?style=flat-square&logo=vercel" alt="Vercel" />
  </p>

  <p>
    <a href="https://griddle.fun">Play</a> &middot;
    <a href="./FAQ.md">FAQ</a> &middot;
    <a href="https://github.com/starl3xx/lets-have-a-word">Let’s Have A Word</a>
  </p>
</div>

---

## How to play

Every day, Griddle gives you one 3×3 grid of nine letters. There’s exactly **one hidden 9-letter word** that uses every letter once.

One rule: **consecutive letters in the answer can’t be directly up, down, left, or right of each other.** Diagonals are fair game.

```
   A · B · C           If A is next, B can’t come after it
   D · E · F           (they’re side-by-side). But A → F?
   G · H · I           That’s a diagonal — go for it.
```

Type on your keyboard or tap the cells. Valid shorter words (4–8 letters) flash as you build. Solve in seconds or minutes — your choice.

---

## What makes Griddle different

- **Not another Wordle clone.** The non-neighbor rule turns every puzzle into a small spatial challenge on top of the word-hunt.
- **No account required.** Fully playable anonymously. Sign in with email or a wallet only if you want streaks, the archive, or the leaderboard.
- **One-time premium, no subscription.** Pay $5 once to unlock the full archive forever.
- **Plays everywhere.** Browser, installable PWA, or a native mini app inside Farcaster and Base App.

---

## Where to play

- **Web** — [griddle.fun](https://griddle.fun)
- **Farcaster / Base App** — search for Griddle or tap a shared cast
- **Phone home screen** — open griddle.fun in Safari/Chrome, then “Add to Home Screen”

---

## Premium

One-time $5 unlock gives you:

- The full archive of past puzzles
- Streak protection (save your streak if you miss a day — once a week)
- “Unassisted” mode for ace solvers
- A permanent leaderboard presence

Two ways to pay:

- **USDC** — $5 flat. Swapped to $WORD on-chain and burned in the same transaction. Deflationary by design.
- **Card / Apple Pay / Google Pay** — $6 via Stripe. The $1 covers processing and the small treasury margin that keeps the burn pipeline stocked.

Pay once, you’re premium forever.

---

## For developers

Griddle is a Next.js 14 app on Vercel, Postgres on Neon, Base Chain for premium, and a small Foundry project for the two smart contracts. The target word is never sent to the client — every solve is verified server-side, with anti-bot timing checks applied before any streak or reward credit.

<details>
<summary><strong>Tech stack</strong></summary>

| Layer | Tech |
|---|---|
| Framework | Next.js 14 (App Router) + TypeScript |
| Styling | Tailwind CSS, Söhne typography |
| Database | Postgres (Neon) + Drizzle ORM |
| Cache | Upstash Redis |
| Chain | Base — `GriddlePremium.sol` + `GriddleRewards.sol` |
| Token | $WORD (`0x304e649e69979298BD1AEE63e175ADf07885fb4b`) — shared with Let’s Have A Word |
| Wallet | wagmi 2.x + viem · Farcaster connector · Coinbase Smart Wallet |
| Payments | Stripe (embedded Checkout) · ERC-2612 permit on Base |
| OG images | `@vercel/og` (Satori) |
| Hosting | Vercel · griddle.fun |

</details>

<details>
<summary><strong>Commands</strong></summary>

```bash
bun dev                  # dev server
bun run build            # production build
bun run typecheck        # tsc --noEmit
bun run icons:png        # regenerate /public/icons/*.png from icon.svg

bun run db:generate      # new Drizzle migration
bun run db:migrate       # apply migrations
bun run db:studio        # Drizzle Studio GUI
bun run db:check         # prod schema drift check
```

Puzzle seeding is deliberately not a package script — load your private word list into Neon via a local script kept out of git.

</details>

<details>
<summary><strong>Architecture</strong></summary>

```
┌──────────────────────────────────────────────────────┐
│  Client (Web · Farcaster Mini App · Base App)        │
│  Next.js 14 · Tailwind · Söhne                       │
│  Keystroke telemetry captured in memory              │
└───────────────────────┬──────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────┐
│  Next.js API routes (Serverless)                     │
│  /api/puzzle/today · /api/solve · /api/og            │
│  /api/premium/* · /api/stripe/*                      │
└────────┬───────────────┬───────────────┬─────────────┘
         ▼               ▼               ▼
    Postgres        Base Chain      CoinGecko oracle
    (Neon)          GriddlePremium  ($WORD/USD, 5-min)
                    GriddleRewards
```

</details>

<details>
<summary><strong>Project structure</strong></summary>

```
app/           # Next.js App Router (pages + API routes)
components/    # React components (game + admin + premium)
lib/           # Domain logic, DB, funnel, wallet session, Stripe
contracts/     # Foundry project — GriddlePremium + GriddleRewards
drizzle/       # Generated migrations (0000–0010)
data/          # dictionary.json (74,947 words, 4–8 letters)
public/        # SVG + PNG icons, fonts, .well-known/farcaster.json
scripts/       # Dev helpers (icon PNG export, migration check)
styles/        # Tailwind globals
```

Puzzle words and schedule are **not** committed — they live in Neon.

</details>

<details>
<summary><strong>Environment variables</strong></summary>

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Neon — pooled for runtime, unpooled for migrations |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL |
| `NEXT_PUBLIC_WORD_TOKEN_ADDRESS` | $WORD ERC-20 on Base |
| `NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS` | `GriddlePremium` deployment |
| `NEXT_PUBLIC_GRIDDLE_REWARDS_ADDRESS` | `GriddleRewards` deployment |
| `NEXT_PUBLIC_CHAIN_ID` | `8453` (Base mainnet) |
| `ORACLE_API_KEY` | CoinGecko (shared with LHAW) |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe Checkout |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `STRIPE_PRICE_LOOKUP_KEY` | Stable price lookup (default `griddle_premium_v1`) |
| `ESCROW_MANAGER_PRIVATE_KEY` | Operator EOA for fiat escrow unlocks |
| `RESEND_API_KEY` / `EMAIL_FROM` | Magic-link email transport |
| `BOT_THRESHOLD_INELIGIBLE_MS` / `BOT_THRESHOLD_SUSPICIOUS_MS` / `BOT_THRESHOLD_STDDEV_MS` | Anti-bot tuning |
| `ADMIN_WALLETS` | Comma-separated lowercase 0x addresses for `/admin` |

Contract deploy (in `contracts/.env`): `PRIVATE_KEY`, `BASE_RPC_URL`, `BASESCAN_API_KEY`, `ORACLE_ADDRESS`, `ESCROW_MANAGER_ADDRESS`, `REWARD_SIGNER_ADDRESS`, optional `OWNER`.

</details>

<details>
<summary><strong>Milestones</strong></summary>

Phases: **M1** Core game · **M2** Polish + deploy · **M3** Social surface · **M4** Platform foundation · **M5** Wallets + premium · **M6** Identity + admin · **M7** Telemetry. Pattern is always `M<phase>-<slug>` — no letter suffixes. Reference by full ID in commits and PRs (`M6-email-auth`, never `email-auth`).

| ID | Scope |
|---|---|
| M1 | Core loop — adjacency, scheduler, dictionary, grid UI, telemetry, schema file |
| M2 | Visual polish, tutorial, icon, OG metadata, 404, robots |
| M3 | Satori OG image, Farcaster mini app SDK, `.well-known/farcaster.json`, PWA manifest |
| M4-db | Neon + Drizzle migrations + 279-puzzle seed |
| M4-server | `/api/puzzle/today`, `/api/solve`, session middleware, server/client split |
| M4-perf | Upstash read-through cache, dictionary lazy-load (−217 kB first-load JS) |
| M5-wallets | wagmi 2.x + viem, custom ConnectButton, session→wallet KV binding |
| M5-contracts | Foundry: `GriddlePremium` + `GriddleRewards`, 27/27 tests |
| M5-home-upsell | HOW-TO-PLAY link, three home tiles, premium-gate skeleton, found-words strip |
| M5-premium-checkout | Permit+burn crypto path + Stripe fiat path, both settle to `premium_users` |
| M5-session-premium | Fiat checkout without a wallet — session-keyed KV, migrates on first connect |
| M5-premium-embedded | Embedded Stripe Checkout inline on `griddle.fun`, Apple Pay + Google Pay + Link |
| M6-leaderboard | `/leaderboard/[day]`, admin allowlist |
| M6-admin-console | shadcn primitives, `/admin` tab hub, Pulse + Anomalies |
| M6-stats-modal | StatsModal rebuild, premium settings, universal dark mode |
| M6-email-auth | Magic-link via Resend, profile merge CTE, session→profile KV binding |
| M6-admin-users | Searchable, paginated profile list under `/admin` |
| M6-settings-modal | Gear button, SettingsModal, merge-on-bind across wallet + email |
| M6-signin-framing | “Sign in” framing, complete-profile state, dimmed premium preview |
| M6-app-icon | 3×3 grid favicon/PWA icon, PNG exports, aligned OG + tutorial palette |
| M7-funnel | `funnel_events` table, typed catalog, idempotent webhook ingest, admin Funnel tab |

</details>

<details>
<summary><strong>Recent changes</strong></summary>

- **2026-04-18 — M6-app-icon** (#104): 3×3 grid logo replacing the blue-G favicon/PWA/apple-touch icons, PNG exports at 32–1024 under `public/icons/`, `/api/og` and TutorialModal tile palettes aligned to the same mint/gray/brand-blue stamp.
- **2026-04-17 — M5-premium-embedded** (#96): Stripe Checkout inline via `EmbeddedCheckoutProvider`; `/api/stripe/checkout` grows `mode: 'embedded' | 'hosted'`; `automatic_payment_methods: { enabled: true }` now surfaces Apple Pay + Google Pay + Link; hosted fallback retained for the Farcaster Frame.
- **2026-04-15 — M6-settings-modal + merge-on-bind + signin-framing** (#34, #38, #39): New gear button + SettingsModal absorbs identity + premium prefs; wallet↔email reconciliation via atomic `mergeProfiles` CTE; anon Settings renames “Create profile” → “Sign in”; wallet-connected-no-profile gets a Complete-profile state; premium prefs always visible (dimmed when locked); `/api/premium/[wallet]` moved to raw SQL to dodge a reproducible Drizzle `eq()` drift on wallet-keyed reads.
- **2026-04-15 — M6-email-auth + M6-admin-users + M7-funnel** (#30, #31, #32): Magic-link auth (Resend, atomic rate limit, rollback on transport fail); profile merge CTE; admin Users tab (debounced search, AbortController); funnel telemetry (typed event catalog, `sendBeacon`, webhook idempotency keys, admin Funnel tab).
- **2026-04-14 — M5-premium-checkout + M5-session-premium + M6-stats-modal** (#25–#29): Full checkout live for both paths; fiat unlocks bind to session until first wallet connect, then migrate; StatsModal + premium settings + universal dark mode.
- **2026-04-14 — Home tiles, found-words strip, admin console** (#17, #18, #20, #21): Stats/Leaderboard/Archive home tiles, persistent 4–8 letter found-words strip, shadcn-style UI primitives, `/admin` hub with Pulse + Anomalies, solves `created_at` btree index.
- **2026-04-13 — M5-contracts** (#15): `GriddlePremium` (permit+burn + escrow-then-burn fiat) + `GriddleRewards` (EIP-712 streak vouchers), 27/27 Foundry tests, immutable mainnet $WORD guard on deploy.
- **2026-04-13 — M4-db + M4-server + M4-perf + M5-wallets + M6-leaderboard** (#9–#13): Neon + Drizzle + 279-puzzle seed; server-authoritative game; Upstash read-through cache with key-separated public/answer; wagmi stack with custom ConnectButton; `/leaderboard/[day]` + admin anomalies.
- **2026-04-13 — M1–M3** (#3–#8): Core game loop, solve celebration, Söhne + LHAW design system ported, Satori OG, Farcaster mini app SDK, PWA manifest.

</details>

---

## Design decisions to preserve

1. The target word is never sent to the client — all solve validation is server-side.
2. Share cards show the actual grid letters — people can try to solve from a screenshot.
3. The non-adjacency rule is the only rule. Nothing else.
4. Every cell is used exactly once.
5. UI help is ON by default (blocked cells dimmed). Premium users can turn it OFF for an “unassisted” solve marker.
6. Wallet connection is never required to play.
7. $5 flat, one-time, forever — not a subscription.
8. Unassisted solves are marked separately on the leaderboard.
9. No first-to-solve jackpot — speed doesn’t pay, so bots gain nothing by cheating. Rewards come from streak milestones and share bounties, both immune to speed-cheat.
10. Anti-bot telemetry has been captured from day one.

---

## Code style

- **Curly quotes in user-facing text only** (`’`, `“`, `”`). Use ASCII `'` and `"` in code — JSX attributes, JSON, regex, string literals, commit messages. Curly quotes in code break parsers.
- **Dark mode via Tailwind `class` strategy.** Universal toggle in SettingsModal, persisted per-wallet when connected, `localStorage` fallback otherwise.
- **Branch + PR workflow.** Every change after M1 goes through a PR. Cursor Bugbot reviews automatically — fix findings and push before asking for a second review.
- **Fail-closed on create-and-bind.** Any endpoint that creates a row AND binds it to the session (magic-link verify, profile/create, profile/farcaster) uses `setSessionProfileOrThrow` and rolls back on KV failure. Two stores drifting apart is worse than a 503.
- **Idempotency keys on server-emitted funnel events.** Stripe event id (fiat) or tx hash (crypto). Client-emitted events are allow-listed; `checkout_completed` and `profile_created` are server-only.
- **Identity from a single profile snapshot.** GameClient owns the state and hands it to StatsModal + SettingsModal + the gear button. Every mutation path calls `refetchProfile()` so consumers stay in lockstep.
- **Drizzle wallet-eq drift — wallet-keyed SELECTs use raw SQL.** `eq(<table>.wallet, <value>)` has a reproducible, route-specific drift that returns 0 rows where raw `db.execute(sql\`… WHERE wallet = ${normalized}\`)` finds the row. First seen in `/api/premium/[wallet]` (#38), again in `/api/wordmarks/[wallet]`. Writes are unaffected. When adding a new wallet-keyed read, follow the raw-SQL pattern in `lib/db/queries.ts`.
