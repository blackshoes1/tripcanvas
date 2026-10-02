CREATE TABLE "leg_fill_usage" (
	"scope" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leg_fill_usage_scope_day_pk" PRIMARY KEY("scope","day")
);
