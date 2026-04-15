<div align="center">
  <h1>Griddle</h1>

  <p><strong>A daily 3×3 word puzzle. Every cell matters. Consecutive letters can’t be neighbors.</strong></p>

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

## How It Works

```
Every day → one 3×3 grid of letters → one hidden 9-letter word
  ├─ Use every cell exactly once
  ├─ Consecutive letters can’t be orthogonally adjacent
  ├─ Type on the keyboard or tap the cells
  └─ Shorter valid words flash as you type
```

One hidden word. One grid. One rule.

---

## The Rule

```
Position indices       Forbidden neighbors
   0 · 1 · 2              0 ↔ 1, 3
   3 · 4 · 5              1 ↔ 0, 2, 4
   6 · 7 · 8              4 ↔ 1, 3, 5, 7
                          (orthogonal only; diagonals are free)
```

The hidden word is a **Hamiltonian path** through the grid — every cell visited exactly once — on the *complement* of the 3×3 rook graph. Consecutive letters must land on cells that are **not** orthogonal neighbors. Diagonals are fair game.

For any 9-letter word with 9 unique letters there are **exactly 12,072** valid grid arrangements, so the puzzle bank of 279 curated words supports years of fresh daily puzzles.

---

## Why Griddle?

- **Novel mechanic** — not another Wordle variant. The non-adjacency rule creates a genuine spatial puzzle on top of the word-hunt, and the game math is mathematically proven
- **Instant skill expression** — the whole game is keyboard-driven, solves in seconds to a few minutes, and the "find a valid shorter word" flash rewards vocabulary depth
- **Fully playable anonymously** — no wallet required. Wallet unlocks optional extras (streaks, archive, premium), never the core game
- **$WORD-powered premium** — $5 worth of $WORD, burned permanently, unlocks the entire archive forever. One-time payment, deflationary
- **Anti-bot guardrails** — every solve captures server-side timing + client-side keystroke telemetry. Sub-human-floor solves are flagged ineligible for streaks and leaderboards
- **Farcaster-native** — works as a standalone mini app inside Farcaster and Base App, with native share → compose-cast integration
- **Family resemblance** — shares the design system (Söhne, brand blue, animation language) with [Let’s Have A Word](https://github.com/starl3xx/lets-have-a-word) so both games feel in-universe

---

## Game Mechanic

| Concept | Details |
|---------|---------|
| **Grid** | 3×3, 9 letters, all unique |
| **Target word** | 9 letters, all unique, pre-validated on grid |
| **Constraint** | Consecutive letters must be non-adjacent (orthogonal) |
| **Cell reuse** | Each cell used exactly once |
| **Input** | Type on keyboard OR tap cells — the game auto-resolves which cell your letter lands on |
| **Backspace** | Removes last letter, restores previous state |
| **Shorter words** | Valid English 4–8 letter words flash as you build |
| **Solve** | First valid 9-letter word that uses every cell and obeys the rule wins |
| **Puzzle bank** | 279 curated words · 180-day no-repeat · 12,072 grid arrangements per word |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS (LHAW design system ported) |
| Typography | Söhne (all weights) |
| Database | PostgreSQL (Neon) + Drizzle ORM |
| Chain | Base — `GriddlePremium.sol` + `GriddleRewards.sol` |
| Token | $WORD (`0x304e649e69979298BD1AEE63e175ADf07885fb4b`) — shared with Let’s Have A Word |
| Oracle | CoinGecko extension of the LHAW oracle |
| OG Images | `@vercel/og` (Satori) |
| Wallet | wagmi 2.x + viem · `@farcaster/miniapp-wagmi-connector` · Coinbase Smart Wallet · custom `ConnectButton` (no RainbowKit) |
| Cache | Upstash Redis (read-through, HTTP edge-compatible) |
| UI primitives | shadcn-style `Card`/`Button`/`Table`/`Input`/`Progress` on Lucide icons |
| Hosting | Vercel |
| Domain | griddle.fun |

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Client (Web · Farcaster Mini App · Base App)        │
│  Next.js 14 App Router · Tailwind · Söhne            │
│  Keystroke telemetry captured in memory              │
└───────────────────────┬──────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│  Next.js 14 API Routes (Serverless)                  │
│  /api/puzzle/today  → grid only, never the word      │
│  /api/solve         → server-side answer check       │
│  /api/og            → Vercel OG (Satori) share image │
│  /api/premium/*     → onchain premium verification   │
└────────┬───────────────┬───────────────┬─────────────┘
         │               │               │
         ▼               ▼               ▼
    PostgreSQL      Base Chain      CoinGecko
    (Neon)          ┌────────────┐  Oracle
    Drizzle ORM     │ Griddle    │  ($WORD/USD,
                    │ Premium    │   5-min cadence)
                    │ (burn $5)  │
                    ├────────────┤
                    │ Griddle    │
                    │ Rewards    │
                    │ (streaks)  │
                    └────────────┘
```

The target word is **never** sent to the client. Solve verification happens server-side against the stored answer, with timing telemetry compared to anti-bot thresholds before any streak or reward credit is applied.

---

## Project Structure

```
app/
├── layout.tsx
├── page.tsx                    # Main game (server component, word stripped before client)
├── GameClient.tsx              # Client wrapper — modals, tiles, wallet flow, telemetry
├── manifest.ts                 # PWA web app manifest
├── faq/page.tsx                # Public FAQ page (mirrors FAQ.md)
├── leaderboard/[day]/          # Per-day ranked leaderboard
├── archive/                    # Past puzzles index (premium-gated from the home tile)
├── premium/success/            # Stripe success landing
├── admin/                      # /admin hub (Pulse · Funnel · Users · Anomalies · Grant)
└── api/
    ├── puzzle/today/           # Grid only, never the word
    ├── solve/                  # Server-side answer verification + anti-bot flags
    ├── og/                     # Satori OG share image
    ├── stats/                  # Per-wallet aggregate stats for the Stats modal
    ├── settings/               # User settings GET/PATCH (dark mode, streak protection, unassisted)
    ├── leaderboard/[day]/      # Daily leaderboard data
    ├── wallet/link/            # Session→wallet binding (POST + DELETE)
    ├── auth/
    │   ├── request/            # POST — send magic link email (rate limited, rollback on failure)
    │   └── verify/             # GET  — consume token, bind session → profile, redirect to /?auth=ok
    ├── profile/
    │   ├── route.ts            # GET/PATCH bound profile (session-profile or session-wallet fallback)
    │   ├── create/             # Handle-only profile creation (session-bound, fails closed on KV)
    │   └── farcaster/          # Farcaster miniapp upsert (wallet-match guarded, FID-verified)
    ├── premium/
    │   ├── [wallet]/           # Wallet-keyed premium status read
    │   ├── session/            # Session-bound premium read (fiat pre-wallet-connect)
    │   ├── migrate/            # Promote session-premium to wallet-keyed row on first connect
    │   └── verify/             # On-chain UnlockedWithBurn event verification → premium_users
    ├── stripe/
    │   ├── checkout/           # POST — create Stripe session with x-session-id in metadata
    │   └── webhook/             # POST — signature-verified checkout.session.completed → recordFiatUnlock
    ├── telemetry/event/        # POST — client funnel event ingestion (allow-listed events only)
    └── admin/
        ├── pulse/              # Admin Pulse aggregate (24h/7d)
        ├── funnel/             # Stage counts + breakdown + time-to-convert (windowed)
        ├── users/              # Paginated + searchable profile list
        ├── anomalies/          # Flagged-solve list
        └── grant-premium/      # Comp premium to wallet or handle (admin_grant)

components/
├── Grid.tsx                    # 3×3 cell grid, 5 states
├── WordSlots.tsx               # 9 letter slots below grid
├── FlashBadge.tsx              # Purple shorter-word flash
├── FoundWords.tsx              # Persistent 4–8 letter found-words strip
├── HomeTiles.tsx               # Stats · Leaderboard · Archive action row (2:1 layout)
├── Avatar.tsx                  # Shared Farcaster pfp / wallet-monogram avatar
├── TutorialModal.tsx           # First-visit + "HOW TO PLAY" modal
├── StatsModal.tsx              # Three-state modal: anon CTA / account stats / premium + settings
├── CreateProfileModal.tsx      # Email (magic link) OR display-name-only profile creation
├── SolveModal.tsx              # Post-solve share + play-again sheet
├── PremiumGateModal.tsx        # Live premium unlock — crypto + fiat buttons
├── PremiumCryptoFlow.tsx       # EIP-2612 permit sign → unlockWithPermit → verify
├── LazyPremiumCryptoFlow.tsx   # Dynamic-import shell for the crypto unlock path
├── ConnectButton.tsx           # wagmi-backed custom connect pill
├── LazyConnectFlow.tsx         # Dynamic-import shell for the ~140 kB wagmi stack
├── WalletProvider.tsx          # wagmi + react-query provider
├── NextPuzzleCountdown.tsx     # UTC midnight rollover countdown
├── admin/
│   ├── AdminDashboard.tsx      # /admin client shell with Analytics + Operations tab groups
│   ├── PulseTab.tsx            # Five-card health grid
│   ├── FunnelTab.tsx           # Stage bars + metadata breakdown + time-to-convert
│   ├── UsersTab.tsx            # Paginated profile list with debounced search
│   ├── AnomaliesTab.tsx        # Flagged-solve table on shadcn primitives
│   ├── GrantTab.tsx            # Comp-premium admin form
│   └── index.ts
└── ui/                         # shadcn-style primitives (Card/Button/Table/Input/Progress)

lib/
├── adjacency.ts                # 3×3 rook-graph adjacency, Hamiltonian-path validation
├── dictionary.ts               # Lazy-loaded 4–8 letter Set lookup (dynamic import)
├── scheduler.ts                # Deterministic getPuzzleForDay()
├── telemetry.ts                # Client-side keystroke + timing capture (anti-bot)
├── useGriddle.ts               # Game state hook (keyboard + tap, solve detection)
├── useDarkMode.ts              # Dark-mode hook with session-wallet DB sync
├── farcaster.ts                # useFarcaster hook (inMiniApp + fid + pfpUrl + displayName)
├── session.ts                  # Session cookie helpers (middleware-backed)
├── session-profile.ts          # Session→profile KV binding (fail-closed throwing setter)
├── session-premium.ts          # Session→premium KV binding (fiat-before-wallet)
├── wallet-session.ts           # Session→wallet KV binding
├── resend.ts                   # Resend API wrapper — magic-link email templates
├── admin.ts                    # ADMIN_WALLETS allowlist + requireAdminWallet
├── address.ts                  # Shared 0x validator
├── site.ts                     # Canonical site URL/name/description
├── share.ts                    # Plain-text share format
├── format.ts                   # Time + ms formatting shared by UI + server
├── stripe.ts                   # Lazy Stripe client + webhook secret helper
├── utils.ts                    # cn() — clsx + tailwind-merge for primitives
├── kv.ts                       # Upstash Redis client
├── contracts/                  # ABIs + address helpers (griddlePremium, wordToken, oracle)
├── funnel/
│   ├── events.ts               # Typed FunnelEvent discriminated union
│   ├── types.ts                # Shared rollup types (client-safe, no runtime imports)
│   ├── client.ts               # trackEvent(event) — sendBeacon with keepalive fallback
│   └── record.ts               # Server-side recordFunnelEvent (idempotent on caller-supplied key)
└── db/
    ├── client.ts               # Drizzle (neon-http) singleton
    ├── schema.ts               # puzzles, solves, streaks, premium_users, leaderboard,
    │                           # puzzle_loads, profiles, magic_links, user_settings, funnel_events
    └── queries.ts              # Cached read-through + admin Pulse/Funnel + profile + settings + funnel rollups

contracts/                      # Foundry project
├── foundry.toml
├── src/
│   ├── GriddlePremium.sol      # Crypto permit+burn + fiat escrow-then-burn
│   ├── GriddleRewards.sol      # EIP-712 signed streak vouchers
│   └── interfaces/
│       ├── IWordToken.sol
│       └── IWordOracle.sol
├── test/                       # 27/27 passing (18 Premium + 9 Rewards)
└── script/Deploy.s.sol         # Base mainnet deploy + canonical-$WORD safety check

data/
├── puzzles.json                # 279 curated words with pre-validated grids
└── dictionary.json             # 4–8 letter English words (74,947 entries)

drizzle/                        # Generated migrations (0000 – 0010)
├── 0000_lethal_swordsman.sql   # Initial schema
├── 0001_…                      # Profiles scaffolding, settings, premium ledger extensions
├── 0002_watery_midnight.sql    # solves_created_at_idx
├── 0007_blushing_saracen.sql   # User settings + premium extensions (last of M4f–h)
├── 0008_bouncy_korath.sql      # profiles email + emailVerifiedAt + displayName + avatarUrl, magic_links
├── 0009_misty_risque.sql       # profiles farcasterFid + farcasterUsername + partial unique idx
└── 0010_familiar_the_enforcers.sql  # funnel_events table + indexes + idempotency partial unique

public/
├── fonts/                      # Söhne woff2 (6 weights ported from LHAW)
└── .well-known/farcaster.json  # Farcaster mini app manifest
```

---

## Commands

```bash
# Development
bun dev                          # Start Next.js dev server
bun run build                    # Build for production
bun run typecheck                # TypeScript check

# Database (M4a+)
bun run db:generate              # Generate Drizzle migrations
bun run db:migrate               # Apply migrations
bun run db:studio                # Open Drizzle Studio GUI
bun run db:seed                  # Seed 279 puzzles (idempotent)
```

---

## Environment Variables

| Variable | Purpose | Milestone |
|----------|---------|-----------|
| `DATABASE_URL` | Pooled Neon Postgres connection — runtime queries | M4a ✅ |
| `DATABASE_URL_UNPOOLED` | Unpooled Neon connection — drizzle-kit migrations | M4a ✅ |
| `KV_REST_API_URL` | Upstash Redis HTTPS endpoint | M4-perf ✅ |
| `KV_REST_API_TOKEN` | Upstash Redis auth token | M4-perf ✅ |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL (driven from `lib/site.ts`) | M2 ✅ |
| `NEXT_PUBLIC_WORD_TOKEN_ADDRESS` | $WORD ERC-20 address on Base | M4f ✅ |
| `NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS` | `GriddlePremium` deployment | M4f ✅ |
| `NEXT_PUBLIC_GRIDDLE_REWARDS_ADDRESS` | `GriddleRewards` deployment | M4f ✅ |
| `NEXT_PUBLIC_CHAIN_ID` | `8453` (Base mainnet) | M4f ✅ |
| `ORACLE_API_KEY` | CoinGecko key (shared with LHAW) | M4e ✅ |
| `STRIPE_SECRET_KEY` | Stripe API key for the Apple Pay premium path | M4f ✅ |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client-side Stripe publishable key for Checkout | M4f ✅ |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret for `/api/stripe/webhook` | M4f ✅ |
| `STRIPE_PRICE_LOOKUP_KEY` | Stable lookup key for the Griddle Premium price (default `griddle_premium_v1`) | M4f ✅ |
| `ESCROW_MANAGER_PRIVATE_KEY` | Operator EOA that opens fiat escrows via `GriddlePremium.unlockForUser` after Stripe settles | M4f ✅ |
| `RESEND_API_KEY` | Resend API key for the magic-link email transport | M4i ✅ |
| `EMAIL_FROM` | Sender address for magic links (default `noreply@griddle.fun`) | M4i ✅ |
| `BOT_THRESHOLD_INELIGIBLE_MS` | Below this server-side solve time, mark ineligible (default `8000`) | M4b ✅ |
| `BOT_THRESHOLD_SUSPICIOUS_MS` | Below this, flag but count (default `15000`) | M4b ✅ |
| `BOT_THRESHOLD_STDDEV_MS` | Keystroke stddev floor for suspicion (default `30`) | M4b ✅ |
| `ADMIN_WALLETS` | Comma-separated lowercase 0x addresses authorized to view `/admin` | M4d ✅ |

Contract deploy (in `contracts/.env`, not the app env):

| Variable | Purpose |
|----------|---------|
| `PRIVATE_KEY` | Deployer key for `forge script script/Deploy.s.sol` |
| `BASE_RPC_URL` | Base mainnet RPC endpoint |
| `BASESCAN_API_KEY` | Etherscan-family verification key for Base |
| `ORACLE_ADDRESS` | LHAW oracle extended with `getWordUsdPrice()` |
| `ESCROW_MANAGER_ADDRESS` | Backend EOA permitted to open fiat escrows |
| `REWARD_SIGNER_ADDRESS` | EIP-712 signer for streak claim vouchers |
| `OWNER` | Optional; `Ownable2Step` owner (defaults to deployer) |

---

## Milestone Status

| | Milestone | Scope | Status |
|---|-----------|-------|--------|
| **M1** | Core game loop | Adjacency, scheduler, dictionary, grid UI, telemetry, Drizzle schema file, LHAW design system | ✅ Shipped |
| **M2** | Visual polish + deploy prep | Solve celebration, mobile tap UX, tutorial, icon, OG metadata, 404, robots, viewport | ✅ Shipped |
| **M3** | Social surface | Satori OG image, Farcaster mini app SDK + composeCast, `.well-known/farcaster.json`, PWA manifest | ✅ Shipped (M3a + M3b + M3c) |
| **M4a** | DB foundation | Neon Postgres, Drizzle migrations, 279-puzzle seed | ✅ Shipped |
| **M4b** | Server-authoritative game | `/api/puzzle/today`, `/api/solve`, session middleware, useGriddle async refactor, page split into server + client | ✅ Shipped |
| **M4-perf** | Cache + lazy load | Upstash Redis read-through cache, dictionary lazy-load (-217 kB first-load JS) | ✅ Shipped |
| **M4c** | Wallet adapters | wagmi 2.x + viem, custom ConnectButton (no RainbowKit), Farcaster wallet connector, Coinbase smart wallet, anonymous → wallet linking, session→wallet KV binding, premium status read | ✅ Shipped |
| **M4d** | Leaderboard + admin | `/leaderboard/[day]` page + API, wallet-allowlisted admin dashboard | ✅ Shipped |
| **M4e** | Premium contracts | Foundry project, `GriddlePremium.sol` (permit+burn crypto path, escrow-then-burn fiat path), `GriddleRewards.sol` (EIP-712 signed streak vouchers), full test coverage | ✅ Shipped (code; deploy pending) |
| **M4-home** | Home UX upgrade | Tappable "How to play" link replacing the dismissible card, three home tiles (Stats · 🏆 Leaderboard · 🗃️ Archive), premium-gate modal skeleton, persistent 4–8 letter found-words strip, profile-aware Stats modal, `/archive` page | ✅ Shipped |
| **M4-admin** | Admin console restructure | shadcn-style UI primitives (`Button`/`Card`/`Table`/`Input`/`Progress`), `/admin` tab hub (Pulse + Anomalies), `/api/admin/pulse`, btree index on `solves.created_at` | ✅ Shipped |
| **M4f** | Premium checkout live | `PremiumGateModal` + `PremiumCryptoFlow` + `/api/stripe/checkout` + `/api/stripe/webhook` wired end-to-end. Crypto path signs an EIP-2612 permit and server-verifies the `UnlockedWithBurn` event via `/api/premium/verify`. Fiat path creates a Stripe session (Apple Pay + card) with the session id stashed in metadata, and the webhook records the unlock with Stripe-event-id idempotency. Both paths land in `premium_users`. | ✅ Shipped |
| **M4g** | Session-based premium | Fiat checkout no longer requires a wallet. Premium binds to the browser session in Upstash KV via `session-premium.ts` and a `/api/premium/session` read; on first wallet connect `/api/premium/migrate` promotes the session binding to a wallet-keyed `premium_users` row. | ✅ Shipped |
| **M4h** | Stats modal + dark mode + settings | StatsModal rebuild with three identity states (anonymous / account / premium), premium settings panel (streak protection with 7-day cooldown, unassisted mode toggle), universal dark-mode toggle (Tailwind `darkMode: 'class'`), per-wallet settings table, Wordmarks placeholder card, FAQ link. Header Connect pill removed — the connector picker auto-reconnects without a user click. | ✅ Shipped |
| **M4i** | Identity + email auth | Magic-link email auth via Resend (`/api/auth/request`, `/api/auth/verify`), `CreateProfileModal` with email OR handle-only paths, Farcaster miniapp profile upsert with FID+wallet match guard, atomic profile auto-merge in a single CTE, session→profile KV bindings that fail closed when they can't land. Adds `profiles.email` / `displayName` / `avatarUrl` / `farcasterFid` / `farcasterUsername` columns and a `magic_links` token table. | ✅ Shipped |
| **M4j** | Admin Users tab | Searchable, paginated profile list under `/admin` → Operations. Joins `profiles` and `premium_users` for combined identity + premium source display. Debounced search with AbortController-cancelled fetches so rapid typing can't race stale responses into the table. | ✅ Shipped |
| **M5a** | Funnel telemetry | New `funnel_events` table + typed event catalog (`lib/funnel/events.ts`) + client `sendBeacon` helper + server-side `recordFunnelEvent` with idempotency keys for webhook / tx-verify callers. Instruments `stats_opened`, `premium_gate_shown`, `upgrade_clicked`, `checkout_started`, `checkout_completed`, `checkout_failed`, `profile_identified`. New admin **Funnel** tab with stage bars, per-metadata breakdown, an Other signals card for `checkout_failed` reason taxonomy, and median time-to-convert per payment method. | ✅ Shipped |

### Premium pricing

- **$5** — direct $WORD permit-burn from a connected wallet
- **$6** — Stripe Checkout with Apple Pay enabled (the $1 covers Stripe fees ~$0.45, DEX swap fees + slippage buffer, and a small treasury margin). No wallet required — the unlock binds to the browser session in KV and migrates to a wallet-keyed `premium_users` row on first connect.

Both paths land in the same `premium_users` ledger. Premium status is server-side (DB), not onchain — the contract burn is the deflationary signal, not the access-control mechanism. Both paths use **escrow-then-burn**: tokens go to a hold contract for ~30 days before permanent burn, so a Stripe dispute can recover them back to treasury. The server-side `checkout_completed` funnel event is idempotency-keyed on the Stripe event id (fiat) or the on-chain tx hash (crypto) so retry storms can't double-count conversions.

---

## Design Decisions to Preserve

1. **Target word never sent to the client** — all solve validation is server-side
2. **Grid shows the actual letters in shares** — people can try to solve from a screenshot
3. **Non-adjacency is the only rule** — no other constraints
4. **Each cell used exactly once** for the 9-letter target
5. **UI help is ON by default** — blocked cells are visually dimmed. Premium users can turn it OFF for an "unassisted" solve marker
6. **Wallet connection never required** — the game is fully playable anonymously
7. **$5 flat burn, one-time, forever** — not a subscription
8. **Unassisted solves marked separately** on the leaderboard — a genuine skill signal
9. **No first-to-solve jackpot** — speed doesn’t pay, so bots gain nothing by cheating. Rewards come from streak milestones and (later) Farcaster share bounties, both immune to speed-cheat
10. **Anti-bot telemetry captured from day one** — server-side solve timing, client-side keystroke intervals, admin-visible anomaly dashboard

---

## Code Style

- **Curly quotes everywhere** — `’`, `“`, `”` in all UI text. Never `'` or `"`. Applies to copy, share text, OG images, email, toasts, modals
- **Dark mode via Tailwind `class` strategy** — universal toggle from StatsModal, persisted per-wallet in `user_settings.darkModeEnabled` when connected, otherwise `localStorage`. Every styled component ships both light and dark variants
- **Branch + PR workflow** — every change after M1 goes through a PR, reviewed by Cursor Bugbot before merge. Fix all Bugbot findings and push before asking for a second review
- **Fail-closed on create-and-bind** — any endpoint that creates a DB row AND binds it to the session (magic-link verify, profile/create, profile/farcaster) uses the throwing `setSessionProfileOrThrow` variant and rolls back the row on KV failure. Two stores drifting apart is worse than a 503
- **Idempotency keys on webhook telemetry** — every server-side `checkout_completed` insert is keyed on the Stripe event id or the on-chain tx hash. Client events are allow-listed and carry no idempotency key — `checkout_completed` and `profile_created` are server-only on purpose

---

## Changelog

### 2026-04-15 (M4i + M4j + M5a — identity, admin Users, funnel)

- **M4i — email auth + profile creation** (#30): Magic-link email auth via Resend. New `POST /api/auth/request` generates a SHA-256-hashed token with a 15-minute TTL and atomic 5-per-hour rate limit via a single `INSERT … SELECT … WHERE count < N`. Transport failure rolls the token row back so a Resend outage doesn’t burn rate-limit slots. `GET /api/auth/verify` consumes the token in one atomic UPDATE, creates-or-finds the profile, binds it to the session in Upstash KV via a throwing setter (so a KV flake redirects to `?auth=error` instead of stranding the user with a consumed token and no binding). Profiles gained `email`, `emailVerifiedAt`, `displayName`, `avatarUrl`, `farcasterFid`, `farcasterUsername` columns plus a `magic_links` table. Auto-merge: if a user authenticates with both a wallet row and a Farcaster row (or email + wallet), `mergeProfiles` combines them in a single atomic CTE (older row wins on conflict, survivor row’s wallet is then explicitly overwritten with the authenticating wallet). CreateProfileModal accepts email OR display-name-only; on the email path a pending display name is stashed in `localStorage` and PATCHed onto the profile after the `?auth=ok` redirect. Handle-only profiles rejected when the session already has a profile (by either `session-profile` OR `session-wallet` + wallet-linked row) to close a handle-squat loop. Single-char slugs padded to at least 2 chars and trailing hyphens trimmed after the length slice so every generated handle round-trips through the PATCH validator. `upsertProfileForFarcaster` uses `onConflictDoNothing` + re-fetch as its TOCTOU guard, and the Farcaster POST in `handleWalletConnect` is now awaited before the premium migration proceeds. FID validated as a positive integer on ingest.
- **M4j — admin Users tab** (#31): Searchable, paginated profile list under `/admin` → Operations. Joins `profiles` and `premium_users` for combined identity + premium-source display (uses the actual `premium_users.source` column, not a fabricated label). Debounced search with `AbortController`-cancelled fetches so rapid typing can't race stale responses into the table, empty-string handle values treated as missing in the avatar-initial helper, page reset on real query change only.
- **M5a — funnel telemetry** (#32): New `funnel_events` table with `(created_at desc)`, `(event_name, created_at)`, and a partial unique index on `idempotency_key` so server-side retry bursts can't double-count. Typed event catalog (`lib/funnel/events.ts`) as a discriminated union on `name` — typos become compile errors at every call site. Client helper (`lib/funnel/client.ts`) uses `navigator.sendBeacon` with a keepalive-fetch fallback so events survive page unloads. Server helper (`lib/funnel/record.ts`) swallows its own failures; the `/api/telemetry/event` handler wraps every step in try/catch so the route honors its “always 204” contract even when `getSessionId` throws. The client ingestion endpoint accepts only an allow-listed subset (`stats_opened`, `premium_gate_shown`, `upgrade_clicked`, `checkout_started`, `checkout_failed`, `profile_identified`) — `checkout_completed` and `profile_created` are emitted exclusively server-side from the Stripe webhook and the crypto verify route, each with an idempotency key (Stripe event id or `crypto:${txHash}`) so forged client events can’t inflate conversion metrics.

  New **Funnel** admin tab with a window picker (24h / 7d / 30d / all), stage bars (conversion % computed against the first populated stage so warmup doesn’t render every stage at 0%), per-metadata breakdown (`checkout_failed` routes to its `reason` bucket via a CASE expression so failure taxonomies stay visible), an Other signals card for non-funnel events, and median time-to-convert cards per payment method. Time-to-convert query uses an alias-local CTE bound (`uc.created_at`) to sidestep the ambiguous column Drizzle would otherwise render for the self-join. Shared rollup types live in `lib/funnel/types.ts` with no runtime imports so the `'use client'` tab and the server query stay in lockstep without the bundler pulling `db/client.ts` into the client chunk.

### 2026-04-14 (M4f + M4g + M4h — premium checkout, dark mode, stats)

- **M4f — premium checkout live** (#26): `PremiumGateModal` + `PremiumCryptoFlow` + `/api/stripe/checkout` + `/api/stripe/webhook` + `/api/premium/verify` end-to-end. Crypto path: fetch live $WORD/USD from the oracle, sign an EIP-2612 permit (`signTypedDataAsync`) with a ±15% slippage buffer, call `unlockWithPermit` via `writeContractAsync`, then server-verify the `UnlockedWithBurn` event from the receipt before writing the `premium_users` row — the client-reported wallet is never trusted. Fiat path: stash `sessionId` in Stripe metadata, signature-verified webhook on receipt, `recordFiatUnlock` with Stripe-session-id idempotency. Both routes land in the same `premium_users` ledger.
- **HomeTiles 2:1 + payment copy + silhouette avatar** (#25): Home tiles relaid out as a 2×1 grid (Stats · Leaderboard · Archive), post-solve share card gains a neutral silhouette avatar for anon users, pricing copy refreshed across Premium/Checkout UI.
- **Admin Grant tab** (#24): `/admin` → Operations → **Grant**, an operator form that comps premium to any wallet OR handle with an optional reason string. `premium_users.source='admin_grant'` with `grantedBy` + `reason` audit trail. Used for game launch perks and support-case resolutions; does not burn tokens.
- **M4g — session-based premium** (#27): Fiat checkout no longer requires a connected wallet. A new Upstash binding (`session-premium.ts`) holds the premium flag against the browser session id, surfaced via `/api/premium/session`. On the user’s first wallet connect, `/api/premium/migrate` promotes the session-bound unlock to a wallet-keyed `premium_users` row — GETDEL on the session key so it can’t be double-claimed, onConflictDoUpdate on the wallet key so a prior crypto unlock can’t be overwritten by a fiat migration.
- **M4h — stats modal overhaul + dark mode + settings** (#28, #29): StatsModal rebuilt with three identity states — **anonymous** (CTAs: create profile / connect wallet / unlock with card or crypto), **account** (free stats + premium upsell strip with a “Refresh” button for users who just paid but whose wallet hasn’t flipped yet), and **premium** (full stats grid + settings panel + Wordmarks placeholder + FAQ link). Premium settings live in a new `user_settings` table keyed on wallet: **streak protection** (armed once, 7-day cooldown after use) and **unassisted mode** (hides cell hints for an Ace Wordmark). Universal **dark mode** toggle in the stats header — Tailwind `darkMode: 'class'` strategy, wallet-synced to `user_settings.darkModeEnabled` when connected, `localStorage` fallback otherwise. Header Connect pill removed entirely; wagmi auto-reconnects on page load via the provider. `/faq` page added for the public-facing FAQ (mirrors `FAQ.md`). Wallet picker no longer auto-opens on first load — only when the user explicitly clicks a connect CTA.

### 2026-04-14 (home UX + admin console)

- **Home tiles** (#17): Replaced the dismissible How-to-play card with a small tappable "HOW TO PLAY" link under the subtitle. Added a three-tile action row under the Backspace/Reset controls — **Stats** (opens a modal with per-wallet streak/time/solve aggregates), **🏆 Leaderboard** (premium-gated link to `/leaderboard/[today]`), and **🗃️ Archive** (premium-gated link to a new `/archive` page listing past puzzle days). Tiles use the Farcaster pfp when running inside a miniapp and fall back to a brand-blue monogram derived from the connected wallet.
- **Persistent found-words strip** (#17): Valid 4–8 letter English words found mid-attempt now accumulate as a compact pill strip between the word slots and the Backspace/Reset row. Cleared only on reset or confirmed solve.
- **Stats modal + `/api/stats`** (#17): Session→wallet binding reads aggregate stats (solves, unassisted count, fastest, average, current/longest streak) from a new endpoint. Falls back to a Connect CTA when no wallet is bound.
- **Premium gate skeleton** (#17): `PremiumGateModal` lays out both pricing tiles ($5 crypto, $6 Apple Pay) with a disabled Unlock CTA until M4f wires the actual Stripe + permit-burn handlers.
- **shadcn-style UI primitives** (#18): New `components/ui/{button,card,input,table,progress}.tsx` on `lucide-react` + `class-variance-authority` + `@radix-ui/react-slot` + `clsx` + `tailwind-merge`. Light-mode only, hooked into Griddle's existing palette (brand blue, error, accent purple). Used by the admin dashboard; future premium UI will adopt them too.
- **Admin dashboard** (#20): Replaced the single-table `/admin/anomalies` with a `/admin` hub on the new primitives — two-section tab nav (Analytics / Operations), self-fetching tab components. **Pulse tab** shows solves 24h/7d, active wallets 7d, flagged rate (tone-graded at 5%/15% thresholds), premium users all-time. **Anomalies tab** is the old ~200-row flagged-solve table rebuilt with a client-side refresh button. Backed by a new `getAdminPulse` query with a `WHERE created_at >= now() - interval '7 days'` scan bound and an admin-gated `/api/admin/pulse` endpoint.
- **solves.created_at index** (#21): Btree index follow-up to the Pulse query so the 7-day window is a range scan instead of a sequential scan. Migration `0002_watery_midnight.sql`.
- **Profiles scaffolding** (#22, pending): `profiles` table keyed on wallet **or** handle with a CHECK constraint and two partial unique indexes (case-insensitive on `lower(handle)`). `getProfileByWallet` / `getProfileByHandle` / `upsertProfile` helpers. Supports the inclusive leaderboard in M4f so Apple Pay users who don't own a wallet still get a leaderboard presence. Nothing reads from this table yet — leaderboard rendering switches over in the M4f UI PR.

### 2026-04-13 (M4e — Foundry contracts)

- **GriddlePremium.sol**: Two unlock paths, both settle to burned $WORD.
  - Crypto ($5): `unlockWithPermit` takes an ERC-2612 permit signature, verifies the amount against a CoinGecko-backed oracle within ±15% slippage (5-minute max staleness), and burns via `WORD.burn()` in the same transaction.
  - Fiat ($6): `unlockForUser` is called by a backend EOA after Stripe settles and the treasury swaps USD → $WORD. Tokens are held in-contract for `escrowWindow` (30 days default, 30–120 owner-settable bounds). During the window the owner can `refundEscrow` back to treasury to unwind a chargeback; after the window anyone can call `burnEscrowed` to finalize the burn. Escrows are keyed by a `bytes32 externalId` (hashed Stripe session id) which doubles as a webhook idempotency key.
  - `revokePremium` is separate from `refundEscrow` so the owner can audit a dispute before clipping access.
- **GriddleRewards.sol**: Streak milestone rewards redeemed via EIP-712 signed vouchers (`Claim(user, milestone, amount, nonce, deadline)`). Per-user nonces for replay protection, rotatable signer, owner-fundable treasury, `sweep` for recovery.
- **Testing**: 27/27 Foundry tests passing (18 Premium + 9 Rewards) against OZ `ERC20Permit` + `ERC20Burnable` mocks. Deploy script hardcodes the canonical mainnet $WORD address and refuses to deploy on chain 8453 with anything else.
- **Important**: `WORD` is `immutable` (not `constant`) so tests can inject a mock; post-deploy guarantee is identical.

### 2026-04-13 (M4a–M4d — backend + wallet)

- **M4a (#9)**: Neon Postgres via Drizzle, applied all migrations, seeded 279 puzzles, pooled + unpooled connection env vars.
- **M4b (#10)**: Server-authoritative game. `/api/puzzle/today` (grid only, word stripped via type-level guarantee), `/api/solve` (DB-side verification with timing telemetry + anti-bot thresholds), session cookie minted by middleware and forwarded via `x-session-id`. Page split into server + client components; `useGriddle` refactored to imperative solve trigger.
- **M4-perf (#11)**: Upstash Redis read-through cache with two-key separation (public payload never shares a key with the answer word), `safeKvGet`/`safeKvSet` wrappers so cache failures fall through to DB. Dictionary lazy-loaded via dynamic import. First-load JS cut by ~217 kB.
- **M4c (#12)**: Wallet adapters. wagmi 2.x + viem + `@farcaster/miniapp-wagmi-connector` + Coinbase Smart Wallet + injected fallback. Custom `ConnectButton` (no RainbowKit). `LazyConnectFlow` dynamic-imports the ~140 kB wagmi stack only when the user clicks Connect. Session→wallet KV binding lets `/api/solve` attribute new solves and retroactively backfill anonymous solves on link.
- **M4d (#13)**: `/leaderboard/[day]` page + API (top 100 by server-side solve time, wallet+flag filtered). Admin anomaly dashboard at `/admin/anomalies` gated on an `ADMIN_WALLETS` env allowlist; non-admins get 404 so the route's existence isn't leaked.

### 2026-04-13 (M2 + M3 — polish + social surface)

- **M2 (#3–#5)**: Visual polish + deployment prep. Solve celebration, tutorial copy, share grid alignment via Unicode fullwidth letters, share-footer driven from canonical `lib/site.ts`. Top-left spoiler fix: regenerated all 279 grids so `word[0]` never sits in cell 0.
- **M3a (#6)**: Satori OG image route at `/api/og`. Gotchas logged in code comments — no `display: grid` in Satori, multi-child divs need explicit `display: flex`, fonts must be TTF.
- **M3b (#7)**: Farcaster mini-app SDK integration. Fire `sdk.actions.ready()` immediately (don't await behind context), race `sdk.context` against a 2-second timeout to avoid hangs, three-state `composeCast` result (cast / cancelled / failed) so a cancelled composer doesn't silently fall through to clipboard.
- **M3c (#8)**: PWA web app manifest + iOS/Android install prompts.

### 2026-04-13 (M1 scaffold)

- **M1 shipped**: Playable 3×3 grid with hardcoded puzzle #1, LHAW design system ported (Söhne, brand blue, accent purple, matching shadows/radii/animations), all four cell states working (plus new `available` green state once construction begins), keyboard + tap input, shake on invalid, purple "flash-pop" badge for valid shorter words, green pulse-glow on solve.
- **Core libs**: `lib/adjacency.ts` (Hamiltonian-path validation on 3×3 rook complement), `lib/scheduler.ts` (deterministic day → puzzle), `lib/dictionary.ts` (74,947 word `Set` for real-time shorter-word detection), `lib/telemetry.ts` (client-side keystroke ring buffer + solve timer, ready to phone home in M4).
- **Data**: 279 curated puzzle words extracted from the handoff JSON, each validated against the non-adjacency Hamiltonian-path constraint.
- **Schema**: Drizzle schema file for `puzzles`, `solves` (with keystroke telemetry + flag columns), `premium_users`, `streaks`, `leaderboard` — no migrations run yet.
- **Dev-only**: solve verification is client-side in M1, against a known target word. M4 replaces this with server-side `/api/solve`.
