CREATE TABLE "wordmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" varchar(42) NOT NULL,
	"wordmark_id" varchar(16) NOT NULL,
	"puzzle_id" integer,
	"earned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wordmarks" ADD CONSTRAINT "wordmarks_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "wordmarks_wallet_wordmark_idx" ON "wordmarks" USING btree ("wallet","wordmark_id");--> statement-breakpoint
CREATE INDEX "wordmarks_wallet_idx" ON "wordmarks" USING btree ("wallet");--> statement-breakpoint
ALTER TABLE "solves" ADD COLUMN "backspace_count" integer;--> statement-breakpoint
ALTER TABLE "solves" ADD COLUMN "reset_count" integer;--> statement-breakpoint
ALTER TABLE "solves" ADD COLUMN "found_words" jsonb;
