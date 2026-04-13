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

Premium is a one-time unlock that enables extra features for wallet-connected players. **$5 in $WORD, burned permanently, forever.** Not a subscription.

**What you get:**

- **Personal solve history** — every puzzle you’ve ever played, time and path preserved
- **Full archive access** — play previous puzzles, not just today’s
- **Streak protection** — one free streak save per month if you miss a day
- **Stats dashboard** — average solve time, best solve, heatmaps, unassisted percentage
- **Unassisted mode** — toggle the "available cell" green tinting OFF for a pure skill challenge. Unassisted solves get a separate leaderboard marker

---

## How does the Premium unlock work?

You click **Unlock Premium**, the app fetches the live $WORD/USD price from our oracle, and shows you the exact token amount needed for $5.00. You sign a single EIP-2612 permit in your wallet — no gas, no approval, no multi-step flow — and the contract burns the tokens from your wallet in a single transaction.

Once confirmed onchain, your wallet is flagged as Premium **forever**. Even if $WORD price changes, you’re done. No renewals.

The price has a ±15% slippage tolerance and the oracle must be fresh (updated within 5 minutes) or the transaction reverts to protect you from stale prices.

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
