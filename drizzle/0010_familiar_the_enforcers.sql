CREATE TABLE "funnel_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_name" varchar(64) NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"wallet" varchar(42),
	"profile_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "funnel_events_created_at_idx" ON "funnel_events" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "funnel_events_name_created_at_idx" ON "funnel_events" USING btree ("event_name","created_at" DESC);--> statement-breakpoint
CREATE INDEX "funnel_events_session_idx" ON "funnel_events" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_idempotency_idx" ON "funnel_events" USING btree ("idempotency_key") WHERE "funnel_events"."idempotency_key" is not null;