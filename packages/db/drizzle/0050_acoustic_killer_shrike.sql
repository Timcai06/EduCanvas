CREATE TABLE "turn_usage_budget_outcomes" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"breach_reason" text,
	"estimated" boolean DEFAULT false NOT NULL,
	"estimated_cost_cents" integer NOT NULL,
	"model_calls" integer NOT NULL,
	"tool_calls" integer NOT NULL,
	"tool_results_truncated" integer NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"wall_clock_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_usage_budget_outcomes_reason_check" CHECK ("turn_usage_budget_outcomes"."breach_reason" is null or "turn_usage_budget_outcomes"."breach_reason" in ('max_input_tokens', 'max_output_tokens', 'max_model_calls', 'max_tool_calls', 'max_tool_result_tokens', 'max_wall_clock', 'max_estimated_cost')),
	CONSTRAINT "turn_usage_budget_outcomes_profile_check" CHECK (char_length("turn_usage_budget_outcomes"."profile_id") between 1 and 64 and "turn_usage_budget_outcomes"."profile_id" ~ '^[a-z][a-z0-9_.-]*$'),
	CONSTRAINT "turn_usage_budget_outcomes_counts_check" CHECK ("turn_usage_budget_outcomes"."estimated_cost_cents" >= 0 and "turn_usage_budget_outcomes"."model_calls" >= 0 and "turn_usage_budget_outcomes"."tool_calls" >= 0 and "turn_usage_budget_outcomes"."tool_results_truncated" >= 0 and "turn_usage_budget_outcomes"."input_tokens" >= 0 and "turn_usage_budget_outcomes"."output_tokens" >= 0 and "turn_usage_budget_outcomes"."wall_clock_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX "turn_usage_budget_outcomes_created_idx" ON "turn_usage_budget_outcomes" USING btree ("created_at");