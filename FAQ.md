# Griddle — FAQ

*This FAQ is a living document. Some answers describe features that are planned but not yet live — see the [milestone status in the README](./README.md#milestone-status). Updated as we build.*

---

## What is Griddle?

Griddle is a daily 3×3 word puzzle. Every day, you get one grid of nine letters and one hidden 9-letter word that uses every cell exactly once. Find it.

The twist: consecutive letters in the hidden word can’t be **orthogonal neighbors** on the grid. From any cell, the letter that follows it can’t be directly above, below, left, or right of it. Diagonals are always fine.

One grid. One word. One rule.

---

## How do I play?

Type on your keyboard or tap cells in the grid. As you type, letters fill the slots below the grid and the cells on the grid light up to show your path.

- **Current cell** — highlighted in brand blue
- **Used cells** — light blue with a small sequence number, showing the order
- **Available cells** — the cells you can legally pick next, subtly tinted green
- **Blocked cells** — dimmed with an X overlay, meaning they’re orthogonally adjacent to your current cell

If you type a letter that isn’t available — either because its cell is blocked or because you’ve already used it — the grid shakes briefly.

Use **Backspace** to undo the last letter. Use **Reset** to clear the board.

---

## What’s the non-adjacency rule, exactly?

Every cell on the 3×3 grid has between 2 and 4 **orthogonal neighbors** — cells directly touching on top, bottom, left, or right. Consecutive letters of the hidden word can never be placed on cells that are orthogonal neighbors.

```
Position indices       Neighbors (forbidden)
  0 · 1 · 2              0 → 1, 3
  3 · 4 · 5              1 → 0, 2, 4
  6 · 7 · 8              4 → 1, 3, 5, 7
                         (and so on)
```

So if your last letter is at position 4 (the center), your next letter can be at 0, 2, 6, or 8 — the four corners — but not at 1, 3, 5, or 7, which are orthogonally adjacent.

For any 9-letter word with 9 unique letters, there are exactly **12,072** valid grid arrangements that satisfy the rule. That’s why the game has longevity — the 279-word puzzle bank supports years of fresh daily puzzles without ever repeating the exact same board.

---

## Do I need a wallet to play?

**No.** Griddle is fully playable anonymously. You can load griddle.fun, solve the puzzle, share your result, and walk away — no wallet, no account, no signup.

Connecting a wallet unlocks optional extras: streak tracking, personal archive, $WORD rewards for streak milestones, and Premium features. But the core game is free and always will be.

---

## Do I need a wallet to buy Premium?

**No.** You have three ways to create an account and unlock Premium:

1. **Connect a wallet** — $5 in $WORD, permit-signed and burned in one transaction
2. **Apple Pay or card** — $6 via Stripe Checkout, no wallet needed. Your unlock binds to your browser session and automatically migrates to a wallet-keyed record the first time you connect one
3. **Magic-link email** — drop in your email, click the link we send, and you have a profile immediately. You can pay to upgrade later, or just use it for streak tracking

Each path produces a real profile in our database. The leaderboard shows your handle (or a shortened wallet if you have one) regardless of how you signed up.

---

## How does email sign-in work?

Open **Stats** → **Create profile**. Enter your email and optionally a display name. We send you a one-time magic link that expires in 15 minutes. Click it, and you’re signed in on that browser. We rate-limit to 5 magic link emails per hour per address.

No passwords. No authenticator apps. The token is single-use — once you click it, it’s dead — and we only store a SHA-256 hash of it on our side, never the raw token. Your session binds to your profile in our edge cache with a 1-year TTL, so clearing cookies will make you re-authenticate.

If you opened the link on a different device than the one you submitted from, your display name won’t follow the link (it’s stashed in the original browser’s localStorage). Re-enter it from your Stats panel after you sign in.

---

## What happens when I solve it?

The grid celebrates with a green pulse-glow animation, your solve time is locked in, and a share prompt appears immediately. If your wallet is connected, your solve counts toward your streak and the daily leaderboard.

The **target word is never revealed in shares** — the share text and image show the grid of letters, not the solution. This is deliberate: people who see your share can try to solve the same puzzle in their head. The official solution is posted publicly by [@griddle](https://warpcast.com/griddle) at end-of-day.

---

## What is $WORD?

$WORD is the native token of [Let’s Have A Word](https://github.com/starl3xx/lets-have-a-word), our sibling word-hunt game. Griddle uses the **same token** — $WORD is cross-game currency across the family.

Token address on Base: [`0x304e649e69979298BD1AEE63e175ADf07885fb4b`](https://basescan.org/token/0x304e649e69979298BD1AEE63e175ADf07885fb4b)

In Griddle, $WORD powers:

- **Premium unlock** — a one-time $5-worth $WORD burn unlocks Premium forever
- **Streak milestone rewards** — earn $WORD bonuses at 7, 30, 100, and 365-day streaks
- **Post-launch** — Farcaster share bounties and other engagement rewards

---

## What is Premium?

Premium is a one-time unlock. **$5 in $WORD (burned permanently) or $6 via Apple Pay / card.** Not a subscription.

**What you get:**

- **Full archive access** — play every past puzzle, not just today’s
- **Daily leaderboard** — ranked view of the fastest solves each day
- **Stats dashboard** — full solve history, averages, fastest, unassisted count, current/longest streak
- **Streak protection** — one free streak save with a 7-day cooldown if you miss a day
- **Unassisted mode** — hide cell hints during play for the Ace Wordmark on solves
- **Dark mode** — universal toggle (free tier has it too, but the setting syncs across devices once you have an account)
- **Wordmarks** — achievements for your best solves (coming soon)

Premium status is recorded in our database, not onchain. The token burn is the deflationary signal — not the access-control mechanism.

---

## How does the Premium unlock work?

From the Premium modal you pick a path:

**Crypto ($5).** Your wallet fetches the live $WORD/USD price from our oracle and we show you the exact token amount needed. You sign a single EIP-2612 permit — no gas, no approval, no multi-step flow — and `GriddlePremium.unlockWithPermit` burns the tokens in a single transaction. We read the `UnlockedWithBurn` event from the receipt server-side (we don’t trust the client) before flipping you to Premium. Price tolerance is ±15% and the oracle must be fresh (≤ 5 min old) or the transaction reverts.

**Apple Pay / card ($6).** You’re redirected to a Stripe Checkout session with Apple Pay enabled. The $1 premium over the crypto path covers Stripe fees, DEX swap costs, and a small treasury margin. Stripe sends a signed webhook back to us when payment settles, and we flip you to Premium immediately — no wallet needed. If you later connect a wallet, your session-bound unlock automatically migrates to a wallet-keyed record. Fiat unlocks use **escrow-then-burn**: the tokens sit in a hold contract for ~30 days before final burn, so a chargeback can be refunded back to treasury.

Once unlocked, you’re Premium **forever**. No renewals.

---

## What settings do I have?

Settings live in your Stats panel (click the **Stats** tile on the home screen). Everyone gets:

- **Dark mode** toggle — persisted per-wallet when connected, otherwise stored locally
- **FAQ** link

Premium users additionally get:

- **Streak protection** — arm a one-shot save that covers a missed day. 7-day cooldown after use
- **Unassisted mode** — hide the green/dimmed cell hints during play so the game is pure recall. Solves in unassisted mode earn the **Ace** Wordmark

---

## How do streaks work?

Every day you solve the puzzle while connected to a wallet, your streak increments by one. Miss a day, it resets to zero (unless you’re Premium and have a streak protection token).

Streak milestones earn $WORD rewards:

- **7 days** — first milestone reward
- **30 days** — larger bonus
- **100 days** — major milestone
- **365 days** — full-year reward

Rewards are claimed onchain via `GriddleRewards.sol` using a signed claim pattern: the server signs a `(wallet, streakLevel, nonce)` message, the contract verifies your signature, and pays out.

Streaks **only count eligible solves**. See below.

---

## What about cheaters and bots?

The game has no first-to-solve jackpot, so there’s no prize money to race for — that alone eliminates most of the incentive to cheat. But we still care about leaderboard integrity and streak credibility.

**What we capture on every solve:**

- **Server-side timing** — how long between the moment the puzzle was first served to your session and the moment you submitted a solve. This is computed on the server and can’t be forged client-side.
- **Keystroke intervals** — the millisecond gaps between your keystrokes, captured as a ring buffer client-side. Human typing has natural variance; bots tend to cluster near 0ms or a fixed interval.

**What happens to fast or mechanical solves:**

- Solves under **8 seconds** server-side → automatically marked **ineligible**. No streak credit, no leaderboard, no rewards. The bot can still "play" — it just doesn’t earn anything.
- Solves between 8–15 seconds or with suspiciously uniform keystroke timing → marked **suspicious** but counted. Visible on an admin review dashboard for manual decisions.
- Everything else → normal.

Thresholds are tunable, so if a real human beats them legitimately (which would be very impressive for a 9-letter puzzle) we can adjust.

---

## What is "unassisted" mode?

By default, Griddle gives you visual help: blocked cells (the ones orthogonally adjacent to your current cell) are dimmed with an X, and valid-next cells are subtly tinted green. This keeps the game accessible.

**Unassisted mode** — a Premium-only toggle — turns that help off. All cells look identical regardless of adjacency state. You have to track the rule in your head. Solves completed in unassisted mode get a distinct leaderboard marker (`◆` instead of `○`), a genuine skill signal.

---

## Where’s the leaderboard?

Daily leaderboards rank the fastest wallet-connected solves for each puzzle. Unassisted solves are shown separately from assisted ones. Anonymous solves don’t appear on the leaderboard.

---

## When does the puzzle reset?

New puzzles drop at **00:00 UTC** every day. The previous day’s puzzle closes and becomes archive-only (Premium access).

---

## Can I play past puzzles?

Yes — with Premium. The full puzzle archive is available to Premium wallets, letting you work through every puzzle we’ve ever published.

---

## Does Griddle work on mobile?

Yes. Griddle is a web app first, so it runs in any mobile browser. It also runs as a **Farcaster mini app** inside Farcaster clients, and as a **Base App mini app** inside the Coinbase Wallet mobile app. Sharing from inside those contexts uses the native compose-cast flow and embeds a playable puzzle frame directly in your cast.

---

## Where are my stats stored?

If you’re signed in — by wallet, by email, or by Farcaster — your solves attach to a **profile** row in our database. One profile can carry any combination of identity anchors: a wallet address, an email, a display name / handle, a Farcaster FID. When two of them overlap (e.g. you used magic-link first and then connected a wallet later), the profiles auto-merge into one.

Anonymous solves live against a rotating session id. If you later create a profile or connect a wallet in the same browser, those anonymous solves get retroactively attributed to your new profile.

---

## How is Griddle related to Let’s Have A Word?

Griddle and [Let’s Have A Word](https://github.com/starl3xx/lets-have-a-word) are sibling games by the same creator. They share:

- The **$WORD token** (same contract, cross-game currency)
- The **design system** (Söhne typography, brand blue, animation language)
- The **price oracle** (CoinGecko, 5-minute cadence)
- The **Farcaster mini-app surface**

They are otherwise independent games with different mechanics. $WORD earned or held in one game is usable in the other.

---

## Where can I send feedback?

Open an issue on the [griddle GitHub repo](https://github.com/starl3xx/griddle/issues) or cast at [@griddle](https://warpcast.com/griddle) on Farcaster.
