CREATE TABLE "operation_continuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"protocol_version" text NOT NULL,
	"kind" text NOT NULL,
	"step" text NOT NULL,
	"approval_id" text NOT NULL,
	"tool_call_id" uuid NOT NULL,
	"adapter_source" text NOT NULL,
	"resume_ref" text NOT NULL,
	"status" text DEFAULT 'waiting_approval' NOT NULL,
	"lease_generation" integer DEFAULT 0 NOT NULL,
	"lease_owner_id" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "operation_continuations_kind_check" CHECK ("operation_continuations"."sequence" between 1 and 1000 and "operation_continuations"."kind" = 'tool_approval' and "operation_continuations"."step" = 'tool.invoke'),
	CONSTRAINT "operation_continuations_status_check" CHECK ("operation_continuations"."status" in ('waiting_approval', 'ready', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "operation_continuations_text_check" CHECK ("operation_continuations"."protocol_version" = 'educanvas.operation-continuation.v1' and char_length("operation_continuations"."approval_id") between 1 and 256 and "operation_continuations"."approval_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' and "operation_continuations"."adapter_source" in ('local', 'teaching', 'mcp', 'node') and char_length("operation_continuations"."resume_ref") between 1 and 256 and "operation_continuations"."resume_ref" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' and ("operation_continuations"."lease_owner_id" is null or (char_length("operation_continuations"."lease_owner_id") between 1 and 256 and "operation_continuations"."lease_owner_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')) and ("operation_continuations"."failure_code" is null or "operation_continuations"."failure_code" ~ '^[a-z][a-z0-9._:-]{0,127}$')),
	CONSTRAINT "operation_continuations_lease_check" CHECK ("operation_continuations"."lease_generation" between 0 and 1000000 and (("operation_continuations"."status" = 'running' and "operation_continuations"."lease_generation" >= 1 and "operation_continuations"."lease_owner_id" is not null and "operation_continuations"."lease_expires_at" is not null and "operation_continuations"."heartbeat_at" is not null) or ("operation_continuations"."status" <> 'running' and "operation_continuations"."lease_owner_id" is null and "operation_continuations"."lease_expires_at" is null and "operation_continuations"."heartbeat_at" is null))),
	CONSTRAINT "operation_continuations_terminal_check" CHECK ((("operation_continuations"."status" in ('completed', 'failed', 'cancelled')) = ("operation_continuations"."completed_at" is not null)) and (("operation_continuations"."status" = 'failed') = ("operation_continuations"."failure_code" is not null))),
	CONSTRAINT "operation_continuations_time_check" CHECK ("operation_continuations"."updated_at" >= "operation_continuations"."created_at" and ("operation_continuations"."completed_at" is null or "operation_continuations"."completed_at" >= "operation_continuations"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "operation_continuations" ADD CONSTRAINT "operation_continuations_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_continuations" ADD CONSTRAINT "operation_continuations_tool_call_id_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_continuations_operation_sequence_unique" ON "operation_continuations" USING btree ("operation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_continuations_active_operation_unique" ON "operation_continuations" USING btree ("operation_id") WHERE "operation_continuations"."status" in ('waiting_approval', 'ready', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "operation_continuations_approval_unique" ON "operation_continuations" USING btree ("approval_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_continuations_tool_call_unique" ON "operation_continuations" USING btree ("tool_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_continuations_adapter_resume_unique" ON "operation_continuations" USING btree ("adapter_source","resume_ref");--> statement-breakpoint
CREATE INDEX "operation_continuations_claim_idx" ON "operation_continuations" USING btree ("status","lease_expires_at","updated_at");