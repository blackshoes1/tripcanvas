CREATE TABLE "trip_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"kind" text NOT NULL,
	"place_key" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"sha256" text NOT NULL,
	"content_base64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_files_kind_check" CHECK (kind in ('AUDIO','DOCUMENT')),
	CONSTRAINT "trip_files_size_check" CHECK (size > 0 and size <= 26214400 and octet_length(content_base64) <= 34952536)
);
--> statement-breakpoint
ALTER TABLE "trip_files" ADD CONSTRAINT "trip_files_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_files" ADD CONSTRAINT "trip_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_files_content_uidx" ON "trip_files" USING btree ("trip_id","kind","place_key","sha256");--> statement-breakpoint
CREATE INDEX "trip_files_trip_position_idx" ON "trip_files" USING btree ("trip_id","position");