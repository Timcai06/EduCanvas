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
CREATE TABLE "object_deletion_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_deletion_outbox_kind_check" CHECK ("object_deletion_outbox"."object_kind" in ('asset', 'artifact', 'avatar')),
	CONSTRAINT "object_deletion_outbox_source_check" CHECK ("object_deletion_outbox"."source_type" in ('asset_version', 'asset_representation', 'artifact_version', 'user_avatar')),
	CONSTRAINT "object_deletion_outbox_status_check" CHECK ("object_deletion_outbox"."status" in ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "object_deletion_outbox_storage_key_check" CHECK (char_length("object_deletion_outbox"."storage_key") between 1 and 1024 and "object_deletion_outbox"."storage_key" !~* '^https?://'),
	CONSTRAINT "object_deletion_outbox_lifecycle_check" CHECK (("object_deletion_outbox"."status" = 'pending' and "object_deletion_outbox"."claimed_at" is null and "object_deletion_outbox"."completed_at" is null) or ("object_deletion_outbox"."status" = 'processing' and "object_deletion_outbox"."claimed_at" is not null and "object_deletion_outbox"."completed_at" is null) or ("object_deletion_outbox"."status" = 'completed' and "object_deletion_outbox"."completed_at" is not null) or ("object_deletion_outbox"."status" = 'failed' and "object_deletion_outbox"."claimed_at" is null and "object_deletion_outbox"."completed_at" is null and "object_deletion_outbox"."failure_code" is not null)),
	CONSTRAINT "object_deletion_outbox_attempts_check" CHECK ("object_deletion_outbox"."attempts" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "security_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"event_type" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"outcome" text NOT NULL,
	"reason_code" text,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_audit_events_outcome_check" CHECK ("security_audit_events"."outcome" in ('succeeded', 'denied', 'failed')),
	CONSTRAINT "security_audit_events_text_check" CHECK (char_length("security_audit_events"."event_type") between 1 and 128 and ("security_audit_events"."resource_type" is null or char_length("security_audit_events"."resource_type") between 1 and 64) and ("security_audit_events"."resource_id" is null or char_length("security_audit_events"."resource_id") between 1 and 180) and ("security_audit_events"."reason_code" is null or char_length("security_audit_events"."reason_code") between 1 and 128) and ("security_audit_events"."request_id" is null or char_length("security_audit_events"."request_id") between 1 and 160)),
	CONSTRAINT "security_audit_events_metadata_check" CHECK (jsonb_typeof("security_audit_events"."metadata") = 'object')
);
--> statement-breakpoint
ALTER TABLE "agent_operations" DROP CONSTRAINT "agent_operations_gateway_shape_check";--> statement-breakpoint
ALTER TABLE "artifact_versions" DROP CONSTRAINT "artifact_versions_generation_job_id_artifact_generation_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_messages" DROP CONSTRAINT "conversation_messages_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "learning_events" DROP CONSTRAINT "learning_events_session_id_lesson_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "diagnostic_responses" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" ADD CONSTRAINT "asset_processing_jobs_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_actor_user_id_platform_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."platform_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_processing_jobs_status_created_idx" ON "asset_processing_jobs" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "asset_processing_jobs_version_created_idx" ON "asset_processing_jobs" USING btree ("asset_version_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_representations_version_kind_unique" ON "asset_representations" USING btree ("asset_version_id","kind");--> statement-breakpoint
CREATE INDEX "asset_representations_version_status_idx" ON "asset_representations" USING btree ("asset_version_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "object_deletion_outbox_object_unique" ON "object_deletion_outbox" USING btree ("object_kind","storage_key");--> statement-breakpoint
CREATE INDEX "object_deletion_outbox_claim_idx" ON "object_deletion_outbox" USING btree ("status","available_at","created_at","id");--> statement-breakpoint
CREATE INDEX "security_audit_events_actor_time_idx" ON "security_audit_events" USING btree ("actor_user_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "security_audit_events_type_time_idx" ON "security_audit_events" USING btree ("event_type","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_operations_conversation_id_unique" ON "agent_operations" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_generation_jobs_artifact_id_unique" ON "artifact_generation_jobs" USING btree ("artifact_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_id_space_unique" ON "conversations" USING btree ("id","space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_sessions_id_student_unique" ON "lesson_sessions" USING btree ("id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnostic_attempts_id_goal_unique" ON "diagnostic_attempts" USING btree ("id","goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_goals_id_student_unique" ON "learning_goals" USING btree ("id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_objectives_id_goal_unique" ON "learning_objectives" USING btree ("id","goal_id");--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_gateway_shape_check" CHECK (("agent_operations"."gateway_envelope_id" is null and "agent_operations"."request_fingerprint" is null and (("agent_operations"."actor_user_id" is null and "agent_operations"."agent_id" is null and "agent_operations"."notebook_id" is null) or ("agent_operations"."actor_user_id" is not null and "agent_operations"."agent_id" is not null and "agent_operations"."notebook_id" is not null))) or ("agent_operations"."gateway_envelope_id" is not null and char_length("agent_operations"."gateway_envelope_id") between 1 and 160 and "agent_operations"."request_fingerprint" ~ '^[a-f0-9]{64}$' and "agent_operations"."actor_user_id" is not null and "agent_operations"."agent_id" is not null and "agent_operations"."notebook_id" is not null));