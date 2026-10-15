CREATE TABLE "trip_daily_moments" (
	"trip_id" uuid NOT NULL,
	"day_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"spot_key" text NOT NULL,
	"spot_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_daily_moments_trip_id_day_key_user_id_pk" PRIMARY KEY("trip_id","day_key","user_id")
);
--> statement-breakpoint
ALTER TABLE "trip_daily_moments" ADD CONSTRAINT "trip_daily_moments_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_daily_moments" ADD CONSTRAINT "trip_daily_moments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;