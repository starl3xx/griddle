import type { ReactNode } from 'react';

export interface FaqItem {
  question: string;
  answer: ReactNode;
}

/**
 * Canonical FAQ content shared between the standalone /faq page and
 * the inline accordion in Settings. Ordered as an implicit hierarchy:
 * how-to-play → profile/sign-in → premium/features → fiat → crypto.
 * Keep copy terse — the longer-form FAQ lives in FAQ.md at the repo root.
 */
export const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'How do I play?',
    answer: (
      <>
        Find the hidden 9-letter word using every cell in the 3×3 grid exactly once.
        Tap cells or type to build your word — consecutive letters in the word cannot be
        orthogonal neighbors in the grid (diagonals are always fine). A new puzzle drops
        every day at midnight UTC.
      </>
    ),
  },
  {
    question: 'When do new puzzles drop?',
    answer: (
      <>
        New puzzles go live at 00:00 UTC every day. The previous day’s puzzle closes and
        moves into the archive, which is Premium-only.
      </>
    ),
  },
  {
    question: 'Do I need an account to play?',
    answer: (
      <>
        No. Griddle is fully playable anonymously — solve, share, walk away. Signing in
        adds streak tracking, leaderboard placement, a personal archive, and $WORD rewards
        at streak milestones. Anonymous solves in the same browser attach to your profile
        retroactively if you sign in later.
      </>
    ),
  },
  {
    question: 'How do I sign in?',
    answer: (
      <>
        Tap the gear icon (top-right) → Sign in. Three paths work: connect a wallet, email
        magic-link (no password, 15-minute expiry), or Farcaster inside a mini-app. They
        all produce a real profile, and combining any of them later merges into one.
      </>
    ),
  },
  {
    question: 'Is a crypto wallet required?',
    answer: (
      <>
        No. You can play and track solves without a wallet. Connecting a wallet links your
        history across devices and enables the crypto ($WORD) payment path. Fiat (Stripe)
        checkout works without a wallet — your Premium is bound to your browser session and
        migrates to a wallet if you connect one later.
      </>
    ),
  },
  {
    question: 'What is Premium?',
    answer: (
      <>
        Griddle Premium is a one-time unlock (no subscription). It gives you the daily
        leaderboard, the full puzzle archive, streak protection, unassisted mode, and
        Wordmarks. Pay $5 with $WORD (crypto) or $6 with card / Apple Pay.
      </>
    ),
  },
  {
    question: 'What is unassisted mode?',
    answer: (
      <>
        When unassisted mode is on, the green and dimmed cell hints are hidden during play.
        You can still use Backspace and Reset, but you won’t see which cells are available
        for your next move. Solving without using Backspace or Reset earns you the
        🎯 Blameless Wordmark.
      </>
    ),
  },
  {
    question: 'What is streak protection?',
    answer: (
      <>
        Streak protection is a one-shot save for your current streak. If you miss a day while
        protection is enabled, your streak is preserved and protection is consumed. It
        replenishes after 7 days, so you get roughly one save per week.
      </>
    ),
  },
  {
    question: 'What are Wordmarks?',
    answer: (
      <>
        Wordmarks are achievements earned by specific types of solves — for example, solving
        without Backspace or Reset earns the 🎯 Blameless Wordmark. More Wordmarks are coming soon.
      </>
    ),
  },
  {
    question: 'What happens to my money when I pay with Stripe?',
    answer: (
      <>
        A portion of every fiat payment is swapped to $WORD on Uniswap on Base and placed in
        an escrow contract. After 30 days (Stripe’s chargeback window), it is permanently
        burned — removed from $WORD supply forever. The $1 premium over the crypto price
        ($6 vs $5) covers Stripe fees, swap fees, and a treasury margin.
      </>
    ),
  },
  {
    question: 'Why a 30-day delay before the burn?',
    answer: (
      <>
        Credit card disputes can arrive weeks after a charge. The escrow window matches
        Stripe’s dispute window so refunds are possible without reversing an irreversible
        burn. After the window, anyone can call <code>burnEscrowed()</code> on-chain — the burn
        is permissionless.
      </>
    ),
  },
  {
    question: 'What is $WORD?',
    answer: (
      <>
        $WORD is the native token shared between Griddle and our sibling game
        Let’s Have A Word. It lives on Base. You never need to hold it directly — Premium
        unlocks and streak milestone rewards handle $WORD automatically.
      </>
    ),
  },
  {
    question: 'How does the crypto unlock work?',
    answer: (
      <>
        You sign one EIP-2612 permit over $5 USDC — no gas for the permit, no approval
        dance, no separate $WORD purchase. In a single transaction the contract pulls the
        USDC, swaps it to $WORD on Uniswap, and burns the $WORD. A client-computed minimum
        output protects against MEV slippage. You’re Premium forever.
      </>
    ),
  },
];
