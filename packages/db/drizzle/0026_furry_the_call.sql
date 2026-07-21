ALTER TABLE "tool_calls" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ALTER COLUMN "turn_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ALTER COLUMN "teaching_state" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "agent_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_agent_operation_id_agent_operations_id_fk" FOREIGN KEY ("agent_operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_calls_agent_operation_idx" ON "tool_calls" USING btree ("agent_operation_id","created_at","id");--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_scope_check" CHECK (("tool_calls"."session_id" is not null and "tool_calls"."turn_id" is not null and "tool_calls"."teaching_state" is not null and "tool_calls"."agent_operation_id" is null) or ("tool_calls"."session_id" is null and "tool_calls"."turn_id" is null and "tool_calls"."teaching_state" is null and "tool_calls"."agent_operation_id" is not null));