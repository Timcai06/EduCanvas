CREATE TABLE "artifact_generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"operation_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer,
	"failure_code" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"queue_job_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "artifact_generation_jobs_status_check" CHECK ("artifact_generation_jobs"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "artifact_generation_jobs_progress_check" CHECK ("artifact_generation_jobs"."progress" is null or ("artifact_generation_jobs"."progress" between 0 and 100)),
	CONSTRAINT "artifact_generation_jobs_failure_shape_check" CHECK (("artifact_generation_jobs"."status" = 'failed' and "artifact_generation_jobs"."failure_code" is not null and char_length("artifact_generation_jobs"."failure_code") between 1 and 128) or ("artifact_generation_jobs"."status" <> 'failed' and "artifact_generation_jobs"."failure_code" is null)),
	CONSTRAINT "artifact_generation_jobs_lifecycle_shape_check" CHECK (("artifact_generation_jobs"."status" = 'queued' and "artifact_generation_jobs"."started_at" is null and "artifact_generation_jobs"."completed_at" is null) or ("artifact_generation_jobs"."status" = 'running' and "artifact_generation_jobs"."started_at" is not null and "artifact_generation_jobs"."completed_at" is null) or ("artifact_generation_jobs"."status" in ('succeeded', 'failed', 'cancelled') and "artifact_generation_jobs"."completed_at" is not null)),
	CONSTRAINT "artifact_generation_jobs_queue_key_check" CHECK ("artifact_generation_jobs"."queue_job_key" is null or char_length("artifact_generation_jobs"."queue_job_key") between 1 and 512)
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb,
	"object_key" text,
	"checksum" text,
	"created_by_operation_id" uuid,
	"generation_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_versions_version_check" CHECK ("artifact_versions"."version" >= 1),
	CONSTRAINT "artifact_versions_content_shape_check" CHECK (("artifact_versions"."content" is not null and "artifact_versions"."object_key" is null and "artifact_versions"."checksum" is null) or ("artifact_versions"."content" is null and "artifact_versions"."object_key" is not null and "artifact_versions"."checksum" is not null)),
	CONSTRAINT "artifact_versions_object_key_check" CHECK ("artifact_versions"."object_key" is null or (char_length("artifact_versions"."object_key") between 1 and 1024 and "artifact_versions"."checksum" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"conversation_id" uuid,
	"owner_subject_id" text NOT NULL,
	"kind" text NOT NULL,
	"trust_tier" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"latest_version" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_trust_tier_check" CHECK ("artifacts"."trust_tier" in ('tier1', 'tier2')),
	CONSTRAINT "artifacts_status_check" CHECK ("artifacts"."status" in ('proposed', 'active', 'archived')),
	CONSTRAINT "artifacts_kind_check" CHECK ("artifacts"."kind" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "artifacts_text_check" CHECK (char_length("artifacts"."owner_subject_id") between 1 and 160 and char_length("artifacts"."title") between 1 and 300),
	CONSTRAINT "artifacts_version_check" CHECK ("artifacts"."latest_version" >= 0),
	CONSTRAINT "artifacts_archive_shape_check" CHECK (("artifacts"."status" = 'archived') = ("artifacts"."archived_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "artifact_generation_jobs" ADD CONSTRAINT "artifact_generation_jobs_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_generation_jobs" ADD CONSTRAINT "artifact_generation_jobs_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_created_by_operation_id_agent_operations_id_fk" FOREIGN KEY ("created_by_operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_generation_job_id_artifact_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."artifact_generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_generation_jobs_artifact_created_idx" ON "artifact_generation_jobs" USING btree ("artifact_id","created_at","id");--> statement-breakpoint
CREATE INDEX "artifact_generation_jobs_status_created_idx" ON "artifact_generation_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_versions_artifact_version_unique" ON "artifact_versions" USING btree ("artifact_id","version");--> statement-breakpoint
CREATE INDEX "artifacts_space_status_updated_idx" ON "artifacts" USING btree ("space_id","status","updated_at","id");--> statement-breakpoint
CREATE INDEX "artifacts_conversation_created_idx" ON "artifacts" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "artifacts_owner_recent_idx" ON "artifacts" USING btree ("owner_subject_id","updated_at","id");