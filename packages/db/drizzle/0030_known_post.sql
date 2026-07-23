CREATE TABLE "tool_approval_intents" (
	"approval_id" text PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"protocol_version" text NOT NULL,
	"tool_call_id" uuid NOT NULL,
	"adapter_source" text NOT NULL,
	"resume_ref" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bound_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	CONSTRAINT "tool_approval_intents_status_check" CHECK ("tool_approval_intents"."status" in ('prepared', 'bound', 'abandoned')),
	CONSTRAINT "tool_approval_intents_text_check" CHECK ("tool_approval_intents"."protocol_version" = 'educanvas.tool-approval-intent.v1' and char_length("tool_approval_intents"."approval_id") between 1 and 256 and "tool_approval_intents"."approval_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' and "tool_approval_intents"."adapter_source" in ('local', 'teaching', 'mcp', 'node') and char_length("tool_approval_intents"."resume_ref") between 1 and 256 and "tool_approval_intents"."resume_ref" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
	CONSTRAINT "tool_approval_intents_lifecycle_check" CHECK (("tool_approval_intents"."status" = 'prepared' and "tool_approval_intents"."bound_at" is null and "tool_approval_intents"."abandoned_at" is null) or ("tool_approval_intents"."status" = 'bound' and "tool_approval_intents"."bound_at" is not null and "tool_approval_intents"."abandoned_at" is null) or ("tool_approval_intents"."status" = 'abandoned' and "tool_approval_intents"."bound_at" is null and "tool_approval_intents"."abandoned_at" is not null)),
	CONSTRAINT "tool_approval_intents_time_check" CHECK ("tool_approval_intents"."expires_at" > "tool_approval_intents"."prepared_at" and ("tool_approval_intents"."bound_at" is null or "tool_approval_intents"."bound_at" >= "tool_approval_intents"."prepared_at") and ("tool_approval_intents"."abandoned_at" is null or "tool_approval_intents"."abandoned_at" >= "tool_approval_intents"."prepared_at"))
);
--> statement-breakpoint
ALTER TABLE "tool_approval_intents" ADD CONSTRAINT "tool_approval_intents_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_approval_intents" ADD CONSTRAINT "tool_approval_intents_actor_user_id_platform_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_approval_intents" ADD CONSTRAINT "tool_approval_intents_tool_call_id_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_approval_intents_tool_call_unique" ON "tool_approval_intents" USING btree ("tool_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_approval_intents_adapter_resume_unique" ON "tool_approval_intents" USING btree ("adapter_source","resume_ref");--> statement-breakpoint
CREATE INDEX "tool_approval_intents_status_expiry_idx" ON "tool_approval_intents" USING btree ("status","expires_at","prepared_at");