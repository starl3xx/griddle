import { redirect } from 'next/navigation';
import { getCurrentDayNumber } from '@/lib/scheduler';

/**
 * /leaderboard → 302 to /leaderboard/{today}. Convenience entry so
 * SolveModal / nav links don't have to know the current day number.
 */
export const dynamic = 'force-dynamic';

export default function LeaderboardIndex() {
  redirect(`/leaderboard/${getCurrentDayNumber()}`);
}
