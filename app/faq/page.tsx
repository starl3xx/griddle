import Link from 'next/link';

/**
 * Frequently asked questions. Server component — no interactivity needed.
 */
export const metadata = {
  title: 'FAQ · Griddle',
  description: 'Frequently asked questions about Griddle.',
};

export default function FaqPage() {
  return (
    <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-12 gap-8 max-w-lg mx-auto w-full">
      <header className="text-center">
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-gray-900 dark:text-gray-100">
          FAQ
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Griddle — frequently asked questions</p>
      </header>

      <div className="w-full flex flex-col gap-6">
        <Section title="How do I play?">
          Find the hidden 9-letter word using every cell in the 3×3 grid exactly once.
          Tap cells to build your word — consecutive letters in the word cannot be neighbors
          in the grid. A new puzzle drops every day at midnight UTC.
        </Section>

        <Section title="What is unassisted mode?">
          When unassisted mode is on, the green and dimmed cell hints are hidden during play.
          You can still use Backspace and Reset, but you won&apos;t see which cells are available
          for your next move. Solving without using Backspace or Reset earns you the
          🎯 Ace Wordmark.
        </Section>

        <Section title="What is streak protection?">
          Streak protection is a one-shot save for your current streak. If you miss a day while
          protection is enabled, your streak is preserved and protection is consumed. It
          replenishes after 7 days, so you get roughly one save per week.
        </Section>

        <Section title="What happens to my money when I pay with Stripe?">
          A portion of every fiat payment is swapped to $WORD on Uniswap on Base and placed in
          an escrow contract. After 30 days (Stripe&apos;s chargeback window), it is permanently
          burned — removed from $WORD supply forever. The $1 premium over the crypto price
          ($6 vs $5) covers Stripe fees, swap fees, and a treasury margin.
        </Section>

        <Section title="Why a 30-day delay before the burn?">
          Credit card disputes can arrive weeks after a charge. The escrow window matches
          Stripe&apos;s dispute window so refunds are possible without reversing an irreversible
          burn. After the window, anyone can call <code>burnEscrowed()</code> on-chain — the burn
          is permissionless.
        </Section>

        <Section title="What is premium?">
          Griddle Premium is a one-time unlock (no subscription). It gives you access to every
          day&apos;s ranked leaderboard, the full puzzle archive, streak protection, and unassisted
          mode. Pay $5 with $WORD (crypto) or $6 with card / Apple Pay.
        </Section>

        <Section title="What are Wordmarks?">
          Wordmarks are achievements earned by specific types of solves — for example, solving
          without Backspace or Reset earns the 🎯 Ace Wordmark. More Wordmarks are coming soon.
        </Section>

        <Section title="Is my wallet required?">
          No. You can play and track solves without a wallet. Connecting a wallet links your
          history across devices and enables the crypto ($WORD) payment path. Fiat (Stripe)
          checkout works without a wallet — your premium is bound to your browser session and
          migrates to a wallet if you connect one later.
        </Section>
      </div>

      <Link href="/" className="text-sm text-gray-500 dark:text-gray-400 hover:text-brand transition-colors">
        ← back to today&apos;s puzzle
      </Link>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-card p-4">
      <h2 className="text-base font-black text-gray-900 dark:text-gray-100 mb-1.5">{title}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{children}</p>
    </div>
  );
}
