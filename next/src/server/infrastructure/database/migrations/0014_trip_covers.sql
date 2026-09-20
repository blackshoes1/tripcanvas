CREATE TABLE "trip_covers" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"image_base64" text,
	"revision" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_covers_revision_check" CHECK ("trip_covers"."revision" > 0),
	CONSTRAINT "trip_covers_size_check" CHECK ("trip_covers"."image_base64" is null or octet_length("trip_covers"."image_base64") <= 333336)
);
--> statement-breakpoint
ALTER TABLE "trip_covers" ADD CONSTRAINT "trip_covers_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;