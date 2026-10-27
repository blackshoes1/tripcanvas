CREATE TABLE "live_activity_subscriptions" (
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"session_id" text NOT NULL,
	"trip_id" uuid,
	"push_token" text,
	"token_revision" bigint DEFAULT 0 NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"next_update_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"last_state_version" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_activity_subscriptions_user_id_device_id_activity_id_pk" PRIMARY KEY("user_id","device_id","activity_id"),
	CONSTRAINT "live_activity_environment_check" CHECK ("live_activity_subscriptions"."environment" in ('sandbox','production')),
	CONSTRAINT "live_activity_active_target_check" CHECK ("live_activity_subscriptions"."ended_at" is not null or ("live_activity_subscriptions"."trip_id" is not null and "live_activity_subscriptions"."push_token" is not null))
);
--> statement-breakpoint
ALTER TABLE "live_activity_subscriptions" ADD CONSTRAINT "live_activity_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_activity_subscriptions" ADD CONSTRAINT "live_activity_subscriptions_session_id_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_activity_subscriptions" ADD CONSTRAINT "live_activity_subscriptions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_activity_due_idx" ON "live_activity_subscriptions" USING btree ("next_update_at") WHERE "live_activity_subscriptions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "live_activity_expiry_idx" ON "live_activity_subscriptions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "live_activity_session_idx" ON "live_activity_subscriptions" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_activity_token_uidx" ON "live_activity_subscriptions" USING btree ("push_token") WHERE "live_activity_subscriptions"."push_token" is not null;