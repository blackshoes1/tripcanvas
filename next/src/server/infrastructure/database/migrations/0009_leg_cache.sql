CREATE TABLE "leg_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"sec" integer,
	"m" integer,
	"path" text,
	"taxi" integer,
	"snapped" boolean DEFAULT false NOT NULL,
	"fail" boolean DEFAULT false NOT NULL,
	"provider" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
