ALTER TABLE "profiles" ADD COLUMN "avatar_source" varchar(16);--> statement-breakpoint
UPDATE "profiles" SET "avatar_source" = 'farcaster' WHERE "farcaster_fid" IS NOT NULL AND "avatar_url" IS NOT NULL;
