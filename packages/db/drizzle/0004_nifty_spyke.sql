CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"client_message_id" text,
	"request_hash" text,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "chat_messages_role_check" CHECK ("chat_messages"."role" in ('student', 'assistant')),
	CONSTRAINT "chat_messages_status_check" CHECK ("chat_messages"."status" in ('pending', 'streaming', 'completed', 'cancelled', 'interrupted', 'failed')),
	CONSTRAINT "chat_messages_idempotency_fields_check" CHECK (("chat_messages"."role" = 'student' and "chat_messages"."client_message_id" is not null and "chat_messages"."request_hash" is not null) or ("chat_messages"."role" = 'assistant' and "chat_messages"."client_message_id" is null and "chat_messages"."request_hash" is null)),
	CONSTRAINT "chat_messages_terminal_timestamps_check" CHECK (("chat_messages"."status" in ('completed', 'failed', 'cancelled', 'interrupted') and "chat_messages"."completed_at" is not null) or ("chat_messages"."status" in ('pending', 'streaming') and "chat_messages"."completed_at" is null)),
	CONSTRAINT "chat_messages_cancelled_timestamp_check" CHECK (("chat_messages"."status" = 'cancelled' and "chat_messages"."cancelled_at" is not null and "chat_messages"."cancel_requested_at" is not null) or ("chat_messages"."status" <> 'cancelled' and "chat_messages"."cancelled_at" is null))
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"operation_kind" text NOT NULL,
	"assistant_message_id" uuid,
	"turn_id" uuid,
	"phase" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"trace_id" text NOT NULL,
	"task_alias" text NOT NULL,
	"model_alias" text NOT NULL,
	"prompt_version" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"provider" text,
	"provider_model_id" text,
	"model_revision" text,
	"provider_response_id" text,
	"system_fingerprint" text,
	"finish_reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_hit_tokens" integer,
	"reasoning_tokens" integer,
	"latency_ms" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_runs_teaching_turn_shape_check" CHECK ("model_runs"."operation_kind" = 'teaching_turn' and "model_runs"."assistant_message_id" is not null and "model_runs"."turn_id" is not null and "model_runs"."operation_id" = "model_runs"."turn_id" and "model_runs"."phase" in ('answer', 'synthesis')),
	CONSTRAINT "model_runs_status_check" CHECK ("model_runs"."status" in ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
	CONSTRAINT "model_runs_attempt_check" CHECK ("model_runs"."attempt" >= 1),
	CONSTRAINT "model_runs_usage_check" CHECK (coalesce("model_runs"."input_tokens", 0) >= 0 and coalesce("model_runs"."output_tokens", 0) >= 0 and coalesce("model_runs"."cache_hit_tokens", 0) >= 0 and coalesce("model_runs"."reasoning_tokens", 0) >= 0 and coalesce("model_runs"."latency_ms", 0) >= 0),
	CONSTRAINT "model_runs_lifecycle_timestamps_check" CHECK (("model_runs"."status" = 'pending' and "model_runs"."started_at" is null and "model_runs"."completed_at" is null) or ("model_runs"."status" = 'running' and "model_runs"."started_at" is not null and "model_runs"."completed_at" is null) or ("model_runs"."status" in ('succeeded', 'failed', 'cancelled', 'interrupted') and "model_runs"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
UPDATE "lesson_sessions"
SET "last_activity_at" = COALESCE("updated_at", "created_at");--> statement-breakpoint
WITH ranked_sessions AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY
				"student_id",
				"grade_band",
				"course_slug",
				coalesce("knowledge_node_id", '')
			ORDER BY "created_at" DESC, "id" DESC
		) AS "scope_rank"
	FROM "lesson_sessions"
)
UPDATE "lesson_sessions" AS target
SET
	"status" = CASE WHEN ranked_sessions."scope_rank" = 1 THEN 'active' ELSE 'archived' END,
	"archived_at" = CASE
		WHEN ranked_sessions."scope_rank" = 1 THEN NULL
		ELSE COALESCE(target."updated_at", target."created_at")
	END
FROM ranked_sessions
WHERE target."id" = ranked_sessions."id";--> statement-breakpoint
ALTER TABLE "lesson_sessions" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "lesson_sessions" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_sessions" ALTER COLUMN "last_activity_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "lesson_sessions" ALTER COLUMN "last_activity_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_assistant_message_id_chat_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_session_client_message_unique" ON "chat_messages" USING btree ("session_id","client_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_session_turn_role_unique" ON "chat_messages" USING btree ("session_id","turn_id","role");--> statement-breakpoint
CREATE INDEX "chat_messages_history_cursor_idx" ON "chat_messages" USING btree ("session_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_runs_operation_phase_attempt_unique" ON "model_runs" USING btree ("operation_kind","operation_id","phase","attempt");--> statement-breakpoint
CREATE INDEX "model_runs_session_turn_idx" ON "model_runs" USING btree ("session_id","turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_sessions_active_scope_unique" ON "lesson_sessions" USING btree ("student_id","grade_band","course_slug",coalesce("knowledge_node_id", '')) WHERE "lesson_sessions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "lesson_sessions_recent_scope_idx" ON "lesson_sessions" USING btree ("student_id","grade_band","course_slug","knowledge_node_id","last_activity_at","id");--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_status_check" CHECK ("lesson_sessions"."status" in ('active', 'archived'));--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_archive_timestamp_check" CHECK (("lesson_sessions"."status" = 'active' and "lesson_sessions"."archived_at" is null) or ("lesson_sessions"."status" = 'archived' and "lesson_sessions"."archived_at" is not null));
