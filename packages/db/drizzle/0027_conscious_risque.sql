CREATE TABLE "tool_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_operation_id" uuid NOT NULL,
	"tool_call_id" uuid NOT NULL,
	"effect_key" text NOT NULL,
	"semantics_hash" text NOT NULL,
	"status" text DEFAULT 'intended' NOT NULL,
	"code" text,
	"receipt_hash" text,
	"intended_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "tool_effects_text_check" CHECK ("tool_effects"."effect_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' and "tool_effects"."semantics_hash" ~ '^[a-f0-9]{64}$' and ("tool_effects"."code" is null or "tool_effects"."code" ~ '^[a-z][a-z0-9._:-]{0,127}$') and ("tool_effects"."receipt_hash" is null or "tool_effects"."receipt_hash" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "tool_effects_status_check" CHECK ("tool_effects"."status" in ('intended', 'committed', 'failed', 'outcome_unknown')),
	CONSTRAINT "tool_effects_lifecycle_check" CHECK (("tool_effects"."status" = 'intended' and "tool_effects"."code" is null and "tool_effects"."receipt_hash" is null and "tool_effects"."settled_at" is null) or ("tool_effects"."status" = 'committed' and "tool_effects"."code" is null and "tool_effects"."settled_at" is not null) or ("tool_effects"."status" in ('failed', 'outcome_unknown') and "tool_effects"."code" is not null and "tool_effects"."receipt_hash" is null and "tool_effects"."settled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "tool_effects" ADD CONSTRAINT "tool_effects_agent_operation_id_agent_operations_id_fk" FOREIGN KEY ("agent_operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_effects" ADD CONSTRAINT "tool_effects_tool_call_id_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_effects_operation_key_unique" ON "tool_effects" USING btree ("agent_operation_id","effect_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_effects_tool_call_unique" ON "tool_effects" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "tool_effects_status_idx" ON "tool_effects" USING btree ("status","intended_at","id");