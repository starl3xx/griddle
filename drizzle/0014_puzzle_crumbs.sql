-- Puzzle crumbs: shorter words (4–8 letters) found during a puzzle attempt.
-- Permanent per puzzle per session — once found, they persist forever.
-- Wallet column for future cross-device merge.

CREATE TABLE IF NOT EXISTS "puzzle_crumbs" (
  "id" serial PRIMARY KEY NOT NULL,
  "puzzle_id" integer NOT NULL REFERENCES "puzzles"("id"),
  "session_id" varchar(64) NOT NULL,
  "wallet" varchar(42),
  "word" varchar(8) NOT NULL,
  "found_at" timestamp DEFAULT now() NOT NULL
);

-- One occurrence of each word per session per puzzle
CREATE UNIQUE INDEX IF NOT EXISTS "puzzle_crumbs_session_puzzle_word_idx"
  ON "puzzle_crumbs" ("session_id", "puzzle_id", "word");

-- Fast lookup: all crumbs for a session on a given puzzle
CREATE INDEX IF NOT EXISTS "puzzle_crumbs_session_puzzle_idx"
  ON "puzzle_crumbs" ("session_id", "puzzle_id");

-- Future: cross-device merge by wallet
CREATE INDEX IF NOT EXISTS "puzzle_crumbs_wallet_puzzle_idx"
  ON "puzzle_crumbs" ("wallet", "puzzle_id")
  WHERE "wallet" IS NOT NULL;
