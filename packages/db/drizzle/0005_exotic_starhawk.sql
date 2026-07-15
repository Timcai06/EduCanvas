CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"answer_model_run_id" uuid NOT NULL,
	"provider_tool_call_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"trace_id" text NOT NULL,
	"tool_name" text,
	"teaching_state" text NOT NULL,
	"exposure" text,
	"effect" text,
	"argument_summary" jsonb NOT NULL,
	"result_summary" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"code" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_calls_status_check" CHECK ("tool_calls"."status" in ('pending', 'running', 'succeeded', 'rejected', 'failed', 'outcome_unknown')),
	CONSTRAINT "tool_calls_exposure_check" CHECK ("tool_calls"."exposure" is null or "tool_calls"."exposure" in ('model', 'runtime')),
	CONSTRAINT "tool_calls_effect_check" CHECK ("tool_calls"."effect" is null or "tool_calls"."effect" in ('read', 'write')),
	CONSTRAINT "tool_calls_lifecycle_check" CHECK (("tool_calls"."status" = 'pending' and "tool_calls"."started_at" is null and "tool_calls"."completed_at" is null) or ("tool_calls"."status" = 'running' and "tool_calls"."started_at" is not null and "tool_calls"."completed_at" is null) or ("tool_calls"."status" in ('succeeded', 'rejected', 'failed', 'outcome_unknown') and "tool_calls"."completed_at" is not null)),
	CONSTRAINT "tool_calls_result_shape_check" CHECK (("tool_calls"."status" = 'succeeded' and "tool_calls"."result_summary" is not null and "tool_calls"."code" is null) or ("tool_calls"."status" in ('rejected', 'failed', 'outcome_unknown') and "tool_calls"."result_summary" is null and "tool_calls"."code" is not null) or ("tool_calls"."status" in ('pending', 'running') and "tool_calls"."result_summary" is null and "tool_calls"."code" is null)),
	CONSTRAINT "tool_calls_duration_check" CHECK ("tool_calls"."duration_ms" is null or "tool_calls"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "lease_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
UPDATE "chat_messages"
SET
	"status" = 'interrupted',
	"failure_code" = COALESCE("failure_code", 'lease_missing_after_upgrade'),
	"completed_at" = COALESCE("completed_at", now()),
	"lease_id" = NULL,
	"lease_expires_at" = NULL
WHERE "role" = 'assistant'
	AND "status" IN ('pending', 'streaming');--> statement-breakpoint
UPDATE "model_runs"
SET
	"status" = 'interrupted',
	"error_code" = COALESCE("error_code", 'lease_missing_after_upgrade'),
	"completed_at" = COALESCE("completed_at", now())
WHERE "status" IN ('pending', 'running')
	AND EXISTS (
		SELECT 1
		FROM "chat_messages"
		WHERE "chat_messages"."id" = "model_runs"."assistant_message_id"
			AND "chat_messages"."status" = 'interrupted'
	);--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_answer_model_run_id_model_runs_id_fk" FOREIGN KEY ("answer_model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_calls_execution_id_unique" ON "tool_calls" USING btree ("execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_calls_model_provider_call_unique" ON "tool_calls" USING btree ("answer_model_run_id","provider_tool_call_id");--> statement-breakpoint
CREATE INDEX "tool_calls_session_turn_idx" ON "tool_calls" USING btree ("session_id","turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_one_active_assistant_per_session" ON "chat_messages" USING btree ("session_id") WHERE "chat_messages"."role" = 'assistant' and "chat_messages"."status" in ('pending', 'streaming');--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_lease_shape_check" CHECK (("chat_messages"."role" = 'student' and "chat_messages"."lease_id" is null and "chat_messages"."lease_expires_at" is null and "chat_messages"."heartbeat_at" is null) or ("chat_messages"."role" = 'assistant' and "chat_messages"."status" in ('pending', 'streaming') and "chat_messages"."lease_id" is not null and "chat_messages"."lease_expires_at" is not null and "chat_messages"."heartbeat_at" is not null) or ("chat_messages"."role" = 'assistant' and "chat_messages"."status" in ('completed', 'cancelled', 'interrupted', 'failed') and "chat_messages"."lease_id" is null and "chat_messages"."lease_expires_at" is null));
