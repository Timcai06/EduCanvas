CREATE TABLE "asset_processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"queue_job_key" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "asset_processing_jobs_kind_check" CHECK ("asset_processing_jobs"."kind" in ('extract_text', 'render_preview', 'generate_thumbnail')),
	CONSTRAINT "asset_processing_jobs_status_check" CHECK ("asset_processing_jobs"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "asset_processing_jobs_lifecycle_check" CHECK (("asset_processing_jobs"."status" = 'queued' and "asset_processing_jobs"."started_at" is null and "asset_processing_jobs"."completed_at" is null) or ("asset_processing_jobs"."status" = 'running' and "asset_processing_jobs"."started_at" is not null and "asset_processing_jobs"."completed_at" is null) or ("asset_processing_jobs"."status" in ('succeeded', 'failed', 'cancelled') and "asset_processing_jobs"."completed_at" is not null)),
	CONSTRAINT "asset_processing_jobs_failure_shape_check" CHECK (("asset_processing_jobs"."status" = 'failed' and "asset_processing_jobs"."failure_code" is not null) or ("asset_processing_jobs"."status" <> 'failed' and "asset_processing_jobs"."failure_code" is null)),
	CONSTRAINT "asset_processing_jobs_attempts_check" CHECK ("asset_processing_jobs"."attempts" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "asset_representations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"status" text NOT NULL,
	"derived_storage_key" text,
	"byte_size" integer,
	"checksum" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_representations_kind_check" CHECK ("asset_representations"."kind" in ('original', 'text', 'preview', 'thumbnail')),
	CONSTRAINT "asset_representations_status_check" CHECK ("asset_representations"."status" in ('processing', 'ready', 'failed', 'unavailable')),
	CONSTRAINT "asset_representations_storage_shape_check" CHECK (("asset_representations"."derived_storage_key" is null and "asset_representations"."checksum" is null) or ("asset_representations"."derived_storage_key" is not null and char_length("asset_representations"."derived_storage_key") between 1 and 1024 and "asset_representations"."derived_storage_key" !~* '^https?://' and "asset_representations"."checksum" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "asset_representations_failure_shape_check" CHECK (("asset_representations"."status" = 'failed' and "asset_representations"."failure_code" is not null) or ("asset_representations"."status" <> 'failed' and "asset_representations"."failure_code" is null))
);
--> statement-breakpoint
ALTER TABLE "object_deletion_outbox" DROP CONSTRAINT "object_deletion_outbox_source_check";--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" ADD CONSTRAINT "asset_processing_jobs_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_processing_jobs_status_created_idx" ON "asset_processing_jobs" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "asset_processing_jobs_version_created_idx" ON "asset_processing_jobs" USING btree ("asset_version_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_representations_version_kind_unique" ON "asset_representations" USING btree ("asset_version_id","kind");--> statement-breakpoint
CREATE INDEX "asset_representations_version_status_idx" ON "asset_representations" USING btree ("asset_version_id","status");--> statement-breakpoint
ALTER TABLE "object_deletion_outbox" ADD CONSTRAINT "object_deletion_outbox_source_check" CHECK ("object_deletion_outbox"."source_type" in ('asset_version', 'asset_representation', 'artifact_version', 'user_avatar'));