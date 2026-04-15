CREATE TABLE "magic_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_wallet_or_handle_required";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email" varchar(254);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "display_name" varchar(50);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_url" varchar(500);--> statement-breakpoint
CREATE UNIQUE INDEX "magic_links_token_hash_idx" ON "magic_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "magic_links_email_idx" ON "magic_links" USING btree ("email");--> statement-breakpoint
CREATE INDEX "magic_links_expires_at_idx" ON "magic_links" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_email_lower_idx" ON "profiles" USING btree (lower("email")) WHERE "profiles"."email" is not null;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_identity_required" CHECK ("profiles"."wallet" is not null or "profiles"."handle" is not null or "profiles"."email" is not null);