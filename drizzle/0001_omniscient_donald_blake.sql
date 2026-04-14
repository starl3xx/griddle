CREATE TABLE "puzzle_loads" (
	"session_id" varchar(64) NOT NULL,
	"puzzle_id" integer NOT NULL,
	"loaded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "puzzle_loads_session_id_puzzle_id_pk" PRIMARY KEY("session_id","puzzle_id")
);
--> statement-breakpoint
ALTER TABLE "puzzle_loads" ADD CONSTRAINT "puzzle_loads_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE no action ON UPDATE no action;