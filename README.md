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
| Wallet | RainbowKit (web) · Farcaster Frame SDK · Coinbase Wallet SDK (Base App) |
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
├── page.tsx                    # Main game
└── api/
    ├── puzzle/today/           # Grid only, never the word
    ├── solve/                  # Server-side answer verification (M4)
    ├── og/                     # Vercel OG share image (M3)
    ├── premium/verify/         # Onchain premium status (M4)
    └── farcaster/webhook/      # Farcaster mini app events (M3)

components/
├── Grid.tsx                    # 3×3 cell grid, 5 states
├── WordSlots.tsx               # 9 letter slots below grid
├── FlashBadge.tsx              # Purple shorter-word flash
├── ShareModal.tsx              # M3
├── PremiumModal.tsx            # M4 — $5 burn flow
└── StatsModal.tsx              # M4

lib/
├── adjacency.ts                # 3×3 rook-graph adjacency, Hamiltonian-path validation
├── dictionary.ts               # 4–8 letter Set lookup for shorter-word flash
├── puzzles.ts                  # Typed puzzle bank import
├── scheduler.ts                # Deterministic getPuzzleForDay()
├── telemetry.ts                # Client-side keystroke + timing capture
├── useGriddle.ts               # Game state hook (keyboard + tap, solve detection)
├── db/
│   ├── schema.ts               # Drizzle schema (puzzles, solves, streaks, premium, leaderboard)
│   └── queries.ts              # M4
└── wallet.ts                   # M4 — web/farcaster/base adapter

contracts/
├── GriddlePremium.sol          # M4 — $5-in-$WORD burn → isPremium
└── GriddleRewards.sol          # M4 — streak bonuses, signed-claim pattern

data/
├── puzzles.json                # 279 curated words with pre-validated grids
└── dictionary.json             # 4–8 letter English words (74,947 entries)

public/
├── fonts/                      # Söhne woff2 (6 weights ported from LHAW)
└── .well-known/farcaster.json  # M3
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
| `NEXT_PUBLIC_WORD_TOKEN_ADDRESS` | $WORD ERC-20 address on Base | M4f |
| `NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS` | `GriddlePremium.sol` escrow proxy | M4e |
| `NEXT_PUBLIC_GRIDDLE_REWARDS_ADDRESS` | `GriddleRewards.sol` proxy | M4e |
| `NEXT_PUBLIC_CHAIN_ID` | `8453` (Base mainnet) | M4f |
| `ORACLE_API_KEY` | CoinGecko key (shared with LHAW) | M4e |
| `STRIPE_SECRET_KEY` | Stripe API key for the Apple Pay premium path | M4f |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret for `/api/premium/stripe-webhook` | M4f |
| `OPERATOR_PRIVATE_KEY` | Operator wallet for swap+burn after fiat purchase | M4f |
| `BOT_THRESHOLD_INELIGIBLE_MS` | Below this server-side solve time, mark ineligible (default `8000`) | M4b ✅ |
| `BOT_THRESHOLD_SUSPICIOUS_MS` | Below this, flag but count (default `15000`) | M4b ✅ |
| `BOT_THRESHOLD_STDDEV_MS` | Keystroke stddev floor for suspicion (default `30`) | M4b ✅ |

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
| **M4c** | Wallet adapters | wagmi 2.x + viem, custom ConnectButton (no RainbowKit), Farcaster wallet connector, Coinbase smart wallet, anonymous → wallet linking, premium status read | In progress |
| **M4d** | Leaderboard + admin | Daily leaderboard page, `/admin/anomalies` flagged-solve dashboard | Planned |
| **M4e** | Premium contracts | Foundry project, `GriddlePremium.sol` (escrow-then-burn), `GriddleRewards.sol` (signed streak claims), LHAW oracle extension | Planned |
| **M4f** | Premium UI + Apple Pay | `PremiumModal.tsx` with two paths — $5 crypto (EIP-2612 permit) and $6 Apple Pay (Stripe → swap → escrow). Buy+burn worker, Stripe webhook, dispute window | Planned |

### Premium pricing (decided 2026-04-13)

- **$5** — direct $WORD permit-burn from a connected wallet
- **$6** — Stripe Checkout with Apple Pay enabled (the $1 covers Stripe fees ~$0.45, DEX swap fees + slippage buffer, and a small treasury margin)

Both paths land in the same `premium_users` row. Premium status is server-side (DB), not onchain — the contract burn is the deflationary signal, not the access-control mechanism. Both paths use **escrow-then-burn**: tokens go to a hold contract for ~30 days before permanent burn, so a Stripe dispute can recover them back to treasury.

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
- **No dark mode** — light mode only (matches LHAW)
- **Branch + PR workflow** — every change after M1 goes through a PR, reviewed by Cursor Bugbot before merge

---

## Changelog

### 2026-04-13 (M1 scaffold)

- **M1 shipped**: Playable 3×3 grid with hardcoded puzzle #1, LHAW design system ported (Söhne, brand blue, accent purple, matching shadows/radii/animations), all four cell states working (plus new `available` green state once construction begins), keyboard + tap input, shake on invalid, purple "flash-pop" badge for valid shorter words, green pulse-glow on solve.
- **Core libs**: `lib/adjacency.ts` (Hamiltonian-path validation on 3×3 rook complement), `lib/scheduler.ts` (deterministic day → puzzle), `lib/dictionary.ts` (74,947 word `Set` for real-time shorter-word detection), `lib/telemetry.ts` (client-side keystroke ring buffer + solve timer, ready to phone home in M4).
- **Data**: 279 curated puzzle words extracted from the handoff JSON, each validated against the non-adjacency Hamiltonian-path constraint.
- **Schema**: Drizzle schema file for `puzzles`, `solves` (with keystroke telemetry + flag columns), `premium_users`, `streaks`, `leaderboard` — no migrations run yet.
- **Dev-only**: solve verification is client-side in M1, against a known target word. M4 replaces this with server-side `/api/solve`.
