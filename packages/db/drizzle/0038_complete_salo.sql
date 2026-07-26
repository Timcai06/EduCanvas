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
	CONSTRAINT "object_deletion_outbox_source_check" CHECK ("object_deletion_outbox"."source_type" in ('asset_version', 'artifact_version', 'user_avatar')),
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
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_actor_user_id_platform_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."platform_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "object_deletion_outbox_object_unique" ON "object_deletion_outbox" USING btree ("object_kind","storage_key");--> statement-breakpoint
CREATE INDEX "object_deletion_outbox_claim_idx" ON "object_deletion_outbox" USING btree ("status","available_at","created_at","id");--> statement-breakpoint
CREATE INDEX "security_audit_events_actor_time_idx" ON "security_audit_events" USING btree ("actor_user_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "security_audit_events_type_time_idx" ON "security_audit_events" USING btree ("event_type","occurred_at","id");