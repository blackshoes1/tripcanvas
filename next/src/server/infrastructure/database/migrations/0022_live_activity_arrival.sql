ALTER TABLE "live_activity_subscriptions" ADD COLUMN "arrival_target" jsonb;--> statement-breakpoint
ALTER TABLE "live_activity_subscriptions" ADD COLUMN "arrival_arrived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "live_activity_subscriptions" ADD COLUMN "arrival_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_activity_subscriptions" ADD COLUMN "arrival_event_revision" bigint DEFAULT 0 NOT NULL;