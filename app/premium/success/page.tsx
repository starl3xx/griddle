import Link from 'next/link';
import { Diamond } from '@phosphor-icons/react/dist/ssr';

/**
 * Post-Stripe redirect landing page.
 *
 * After a successful Checkout Session, Stripe sends the user to
 * `/premium/success?session_id=cs_...`. We don't read the session id
 * directly — the backend has already received (or will receive) the
 * `checkout.session.completed` webhook which writes the DB row. All
 * this page does is congratulate the user and link them back into
 * the game. On return, GameClient's wallet-connect flow re-reads
 * `/api/premium/[wallet]` and the gate disappears.
 *
 * Intentionally a server component — no interactivity needed, and it
 * keeps the bundle light for the one-off redirect target.
 */
export const dynamic = 'force-dynamic';

export default function PremiumSuccessPage() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 gap-4 text-center">
      <div className="w-16 h-16 rounded-full bg-accent/15 text-accent flex items-center justify-center">
        <Diamond className="w-8 h-8" weight="fill" aria-hidden />
      </div>
      <h1 className="text-3xl font-black tracking-tight text-gray-900">
        Premium unlocked
      </h1>
      <p className="text-sm font-medium text-gray-500 max-w-sm">
        Thanks for supporting Griddle. Your leaderboard, archive, and stats are
        live the next time you open the game.
      </p>
      <Link
        href="/"
        className="btn-primary mt-2 inline-flex items-center gap-2"
      >
        Back to today’s puzzle
      </Link>
    </main>
  );
}
