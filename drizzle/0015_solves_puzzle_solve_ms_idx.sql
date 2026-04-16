-- Composite index on solves(puzzle_id, server_solve_ms) to back the
-- daily leaderboard query, which filters by puzzle_id and orders by
-- server_solve_ms. Without this index the query sequentially scans
-- the full solves table on every leaderboard fetch.

CREATE INDEX IF NOT EXISTS "solves_puzzle_solve_ms_idx"
  ON "solves" ("puzzle_id", "server_solve_ms");
