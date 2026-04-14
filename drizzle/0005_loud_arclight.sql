ALTER TABLE "premium_users" ADD COLUMN "stripe_session_id" varchar(128);--> statement-breakpoint
CREATE UNIQUE INDEX "premium_users_stripe_session_idx" ON "premium_users" USING btree ("stripe_session_id") WHERE "premium_users"."stripe_session_id" is not null;
