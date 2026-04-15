import type { ReactNode } from 'react';

export interface FaqItem {
  question: string;
  answer: ReactNode;
}

/**
 * Canonical FAQ content shared between the standalone /faq page and
 * the inline accordion in Settings. Keep copy terse — the longer-form
 * FAQ lives in FAQ.md at the repo root.
 */
export const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'How do I play?',
    answer: (
      <>
        Find the hidden 9-letter word using every cell in the 3×3 grid exactly once.
        Tap cells or type to build your word — consecutive letters in the word cannot be
        orthogonal neighbors in the grid. A new puzzle drops every day at midnight UTC.
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
        🎯 Ace Wordmark.
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
    question: 'What is premium?',
    answer: (
      <>
        Griddle Premium is a one-time unlock (no subscription). It gives you access to every
        day’s ranked leaderboard, the full puzzle archive, streak protection, and unassisted
        mode. Pay $5 with $WORD (crypto) or $6 with card / Apple Pay.
      </>
    ),
  },
  {
    question: 'What are Wordmarks?',
    answer: (
      <>
        Wordmarks are achievements earned by specific types of solves — for example, solving
        without Backspace or Reset earns the 🎯 Ace Wordmark. More Wordmarks are coming soon.
      </>
    ),
  },
  {
    question: 'Is my wallet required?',
    answer: (
      <>
        No. You can play and track solves without a wallet. Connecting a wallet links your
        history across devices and enables the crypto ($WORD) payment path. Fiat (Stripe)
        checkout works without a wallet — your premium is bound to your browser session and
        migrates to a wallet if you connect one later.
      </>
    ),
  },
];
