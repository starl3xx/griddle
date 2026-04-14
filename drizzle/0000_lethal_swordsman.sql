CREATE TABLE IF NOT EXISTS "leaderboard" (
	"puzzle_id" integer NOT NULL,
	"wallet" varchar(42) NOT NULL,
	"server_solve_ms" integer NOT NULL,
	"unassisted" boolean DEFAULT false NOT NULL,
	"rank" integer,
	CONSTRAINT "leaderboard_puzzle_id_wallet_pk" PRIMARY KEY("puzzle_id","wallet")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "premium_users" (
	"wallet" varchar(42) PRIMARY KEY NOT NULL,
	"unlocked_at" timestamp DEFAULT now() NOT NULL,
	"tx_hash" varchar(66) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "puzzles" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_number" integer NOT NULL,
	"date" date NOT NULL,
	"word" varchar(9) NOT NULL,
	"grid" char(9) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "puzzles_day_number_unique" UNIQUE("day_number"),
	CONSTRAINT "puzzles_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "solves" (
	"id" serial PRIMARY KEY NOT NULL,
	"puzzle_id" integer NOT NULL,
	"wallet" varchar(42),
	"session_id" varchar(64) NOT NULL,
	"solved" boolean DEFAULT false NOT NULL,
	"best_word" varchar(9),
	"client_solve_ms" integer,
	"server_solve_ms" integer,
	"keystroke_intervals_ms" jsonb,
	"keystroke_count" integer,
	"keystroke_stddev_ms" integer,
	"keystroke_min_ms" integer,
	"unassisted" boolean DEFAULT false NOT NULL,
	"flag" varchar(16),
	"reward_claimed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "streaks" (
	"wallet" varchar(42) PRIMARY KEY NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_solved_day_number" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leaderboard" ADD CONSTRAINT "leaderboard_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "solves" ADD CONSTRAINT "solves_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
