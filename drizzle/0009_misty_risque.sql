ALTER TABLE "profiles" DROP CONSTRAINT "profiles_identity_required";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "farcaster_fid" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "farcaster_username" varchar(50);--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_farcaster_fid_idx" ON "profiles" USING btree ("farcaster_fid") WHERE "profiles"."farcaster_fid" is not null;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_identity_required" CHECK ("profiles"."wallet" is not null or "profiles"."handle" is not null or "profiles"."email" is not null or "profiles"."farcaster_fid" is not null);