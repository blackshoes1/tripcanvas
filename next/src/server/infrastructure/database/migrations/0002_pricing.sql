CREATE TABLE "hotel_price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trip_client_id" text NOT NULL,
	"booking_id" text NOT NULL,
	"seller" text,
	"price" numeric,
	"currency" text,
	"quality" text,
	"verified" boolean DEFAULT false NOT NULL,
	"ptoken" text,
	"offers" jsonb,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hotel_price_snapshots" ADD CONSTRAINT "hotel_price_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hotel_price_snapshots_booking_idx" ON "hotel_price_snapshots" USING btree ("booking_id","observed_at");--> statement-breakpoint
CREATE INDEX "hotel_price_snapshots_user_idx" ON "hotel_price_snapshots" USING btree ("user_id","observed_at");--> statement-breakpoint
CREATE INDEX "hotel_price_snapshots_trip_idx" ON "hotel_price_snapshots" USING btree ("user_id","trip_client_id");