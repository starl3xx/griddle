ALTER TABLE "premium_users" ALTER COLUMN "tx_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "premium_users" ADD COLUMN "source" varchar(16) DEFAULT 'crypto' NOT NULL;--> statement-breakpoint
ALTER TABLE "premium_users" ADD COLUMN "granted_by" varchar(42);--> statement-breakpoint
ALTER TABLE "premium_users" ADD COLUMN "reason" varchar(200);