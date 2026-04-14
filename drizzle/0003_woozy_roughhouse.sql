CREATE TABLE "profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" varchar(42),
	"handle" varchar(32),
	"premium_source" varchar(16),
	"granted_by" varchar(42),
	"reason" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_wallet_or_handle_required" CHECK ("profiles"."wallet" is not null or "profiles"."handle" is not null),
	CONSTRAINT "profiles_wallet_lowercase" CHECK ("profiles"."wallet" is null or "profiles"."wallet" = lower("profiles"."wallet"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_wallet_idx" ON "profiles" USING btree ("wallet") WHERE "profiles"."wallet" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_handle_lower_idx" ON "profiles" USING btree (lower("handle")) WHERE "profiles"."handle" is not null;