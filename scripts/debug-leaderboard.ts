/**
 * Repro script for the "prod leaderboard returns empty despite eligible
 * solves in DB" bug. Uses the same `@neondatabase/serverless` HTTP
 * driver + Drizzle client as the production runtime, so Drizzle
 * binding or driver-side deserialization issues repro here but not in
 * raw psql.
 *
 * Run:  `bun scripts/debug-leaderboard.ts <dayNumber>`
 */
import { getDailyLeaderboard } from '@/lib/db/queries';
import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

async function main() {
  const dayNumber = parseInt(process.argv[2] ?? '6', 10);
  console.log(`\n=== getDailyLeaderboard(${dayNumber}) ===`);
  const rows = await getDailyLeaderboard(dayNumber, 100);
  console.log(`rows: ${rows.length}`);
  console.log(JSON.stringify(rows, null, 2));

  console.log(`\n=== Raw shape of puzzles.date ===`);
  const puzzle = await db.execute(sql`
    SELECT id, day_number, date, pg_typeof(date) AS type
    FROM puzzles WHERE day_number = ${dayNumber}
  `);
  const pRows = Array.isArray(puzzle) ? puzzle : puzzle.rows;
  console.log(pRows);
  if (pRows[0]) {
    const d = pRows[0].date;
    console.log(`typeof date = ${typeof d}, value = ${JSON.stringify(d)}`);
  }

  console.log(`\n=== Count of eligible solves, using the same filter as getDailyLeaderboard ===`);
  if (pRows[0]) {
    const pid = pRows[0].id as number;
    const pdate = pRows[0].date;
    const debug = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM solves
      WHERE solves.puzzle_id = ${pid}
        AND solves.solved = true
        AND (solves.flag IS NULL OR solves.flag = 'suspicious')
        AND (solves.wallet IS NOT NULL OR solves.profile_id IS NOT NULL)
        AND solves.server_solve_ms IS NOT NULL
        AND solves.created_at::date = ${pdate}::date
    `);
    const dRows = Array.isArray(debug) ? debug : debug.rows;
    console.log(`count = ${dRows[0]?.n}`);

    console.log(`\n=== Same count but WITHOUT the date filter ===`);
    const debug2 = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM solves
      WHERE solves.puzzle_id = ${pid}
        AND solves.solved = true
        AND (solves.flag IS NULL OR solves.flag = 'suspicious')
        AND (solves.wallet IS NOT NULL OR solves.profile_id IS NOT NULL)
        AND solves.server_solve_ms IS NOT NULL
    `);
    const d2 = Array.isArray(debug2) ? debug2 : debug2.rows;
    console.log(`count = ${d2[0]?.n}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
