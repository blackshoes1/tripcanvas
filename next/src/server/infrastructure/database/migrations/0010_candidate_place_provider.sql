ALTER TABLE "trip_candidates" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "trip_candidates" ADD COLUMN "provider_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_candidates_provider_uidx" ON "trip_candidates" USING btree ("trip_id","provider","provider_id");--> statement-breakpoint
ALTER TABLE "trip_candidates" ADD CONSTRAINT "trip_candidates_provider_check" CHECK (("trip_candidates"."provider" is null and "trip_candidates"."provider_id" is null) or
    ("trip_candidates"."provider" is not null and "trip_candidates"."provider" in ('kakao','google') and
      ("trip_candidates"."provider_id" is null or ("trip_candidates"."provider" = 'kakao' and "trip_candidates"."provider_id" ~ '^[0-9]{1,20}$') or
        ("trip_candidates"."provider" = 'google' and "trip_candidates"."provider_id" ~ '^[A-Za-z0-9_-]{5,200}$'))));--> statement-breakpoint
ALTER TABLE "trip_candidates" ADD CONSTRAINT "trip_candidates_kakao_id_check" CHECK ("trip_candidates"."provider" is distinct from 'kakao' or "trip_candidates"."place_id" is null);--> statement-breakpoint
ALTER TABLE "trip_candidates" ADD COLUMN "client_key" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_candidates_client_key_uidx" ON "trip_candidates" USING btree ("trip_id","client_key");
