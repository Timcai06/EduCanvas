DROP INDEX "asset_representations_version_kind_unique";--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" ADD COLUMN "variant" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" ADD COLUMN "producer" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" ADD COLUMN "producer_version" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_representations" ADD COLUMN "variant" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_representations" ADD COLUMN "producer" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_representations" ADD COLUMN "producer_version" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_representations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_representations" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_processing_jobs_identity_unique" ON "asset_processing_jobs" USING btree ("asset_version_id","kind","variant","producer","producer_version");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_representations_identity_unique" ON "asset_representations" USING btree ("asset_version_id","kind","variant","producer","producer_version");--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" ADD CONSTRAINT "asset_processing_jobs_variant_check" CHECK ("asset_processing_jobs"."variant" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" ADD CONSTRAINT "asset_processing_jobs_producer_check" CHECK ("asset_processing_jobs"."producer" ~ '^[a-z][a-z0-9._-]{0,63}$');--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" ADD CONSTRAINT "asset_processing_jobs_producer_version_check" CHECK ("asset_processing_jobs"."producer_version" ~ '^[a-z0-9][a-z0-9._-]{0,63}$');--> statement-breakpoint
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_variant_check" CHECK ("asset_representations"."variant" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_producer_check" CHECK ("asset_representations"."producer" ~ '^[a-z][a-z0-9._-]{0,63}$');--> statement-breakpoint
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_producer_version_check" CHECK ("asset_representations"."producer_version" ~ '^[a-z0-9][a-z0-9._-]{0,63}$');