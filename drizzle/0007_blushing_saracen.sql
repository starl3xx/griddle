CREATE TABLE "user_settings" (
	"wallet" varchar(42) PRIMARY KEY NOT NULL,
	"streak_protection_enabled" boolean DEFAULT false NOT NULL,
	"streak_protection_used_at" timestamp,
	"unassisted_mode_enabled" boolean DEFAULT false NOT NULL,
	"dark_mode_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
