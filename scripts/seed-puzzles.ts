/**
 * Seed the puzzles table with all 279 curated puzzles.
 *
 * Day ordering matches `lib/scheduler.ts` — tier A first, then B, C, P —
 * so the server-side puzzle schedule is identical to what the client has
 * been assuming up to M3. Dates start from LAUNCH_DATE (2026-04-13) and
 * advance by one per day.
 *
 * Idempotent: uses `ON CONFLICT DO NOTHING` on both the day_number and
 * date unique constraints, so re-running the script is safe and picks up
 * any newly-added puzzles without touching existing rows.
 *
 * Run: `bun run db:seed`
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '../lib/db/client';
import { puzzles } from '../lib/db/schema';
import { getPuzzleForDay, LAUNCH_DATE } from '../lib/scheduler';
import { PUZZLE_COUNT } from '../lib/puzzles';
import { sql } from 'drizzle-orm';

function dateForDay(dayNumber: number): string {
  const d = new Date(LAUNCH_DATE);
  d.setUTCDate(d.getUTCDate() + (dayNumber - 1));
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function seed() {
  const rows = [];
  for (let day = 1; day <= PUZZLE_COUNT; day++) {
    const p = getPuzzleForDay(day);
    rows.push({
      dayNumber: day,
      date: dateForDay(day),
      word: p.word,
      grid: p.grid,
    });
  }

  console.log(`seeding ${rows.length} puzzles…`);
  console.log(`  day 1  → ${rows[0].date} ${rows[0].word} / ${rows[0].grid}`);
  console.log(
    `  day ${rows.length} → ${rows[rows.length - 1].date} ${rows[rows.length - 1].word} / ${rows[rows.length - 1].grid}`,
  );

  const result = await db
    .insert(puzzles)
    .values(rows)
    .onConflictDoNothing({ target: puzzles.dayNumber })
    .returning({ id: puzzles.id });

  console.log(`inserted ${result.length} new rows (skipped ${rows.length - result.length} existing)`);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(puzzles);
  console.log(`puzzles table now contains ${total} rows`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
