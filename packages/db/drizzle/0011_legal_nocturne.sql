CREATE TABLE "agent_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"trace_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "agent_operations_kind_check" CHECK ("agent_operations"."kind" in ('turn', 'artifact_generation')),
	CONSTRAINT "agent_operations_status_check" CHECK ("agent_operations"."status" in ('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"operation_id" uuid,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "conversation_messages_role_check" CHECK ("conversation_messages"."role" in ('system', 'user', 'assistant', 'tool')),
	CONSTRAINT "conversation_messages_status_check" CHECK ("conversation_messages"."status" in ('pending', 'streaming', 'completed', 'failed', 'cancelled', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"owner_subject_id" text NOT NULL,
	"agent_profile_id" text DEFAULT 'general' NOT NULL,
	"title" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_status_check" CHECK ("conversations"."status" in ('active', 'archived')),
	CONSTRAINT "conversations_archive_shape_check" CHECK (("conversations"."status" = 'active' and "conversations"."archived_at" is null) or ("conversations"."status" = 'archived' and "conversations"."archived_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_subject_id" text NOT NULL,
	"kind" text DEFAULT 'personal' NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_kind_check" CHECK ("spaces"."kind" in ('personal', 'notebook', 'course')),
	CONSTRAINT "spaces_status_check" CHECK ("spaces"."status" in ('active', 'archived')),
	CONSTRAINT "spaces_archive_shape_check" CHECK (("spaces"."status" = 'active' and "spaces"."archived_at" is null) or ("spaces"."status" = 'archived' and "spaces"."archived_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
INSERT INTO "spaces" (
	"id", "owner_subject_id", "kind", "title", "status", "archived_at", "created_at", "updated_at"
)
SELECT
	"id", "student_id", 'course', "course_slug", "status", "archived_at", "created_at", "updated_at"
FROM "lesson_sessions"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "conversations" (
	"id", "space_id", "owner_subject_id", "agent_profile_id", "title", "status",
	"last_activity_at", "archived_at", "created_at", "updated_at"
)
SELECT
	"id", "id", "student_id", 'k12.teacher', "title", "status",
	"last_activity_at", "archived_at", "created_at", "updated_at"
FROM "lesson_sessions"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "lesson_sessions"
SET "conversation_id" = "id"
WHERE "conversation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_operations_conversation_idempotency_unique" ON "agent_operations" USING btree ("conversation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_operations_conversation_created_idx" ON "agent_operations" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "conversation_messages_history_idx" ON "conversation_messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "conversations_owner_recent_idx" ON "conversations" USING btree ("owner_subject_id","status","last_activity_at","id");--> statement-breakpoint
CREATE INDEX "conversations_space_recent_idx" ON "conversations" USING btree ("space_id","last_activity_at","id");--> statement-breakpoint
CREATE INDEX "spaces_owner_status_updated_idx" ON "spaces" USING btree ("owner_subject_id","status","updated_at","id");--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;
