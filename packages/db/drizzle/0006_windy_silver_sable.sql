CREATE TABLE "turn_safety_decisions" (
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"policy_version" text NOT NULL,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"detector_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_safety_decisions_turn_phase_policy_category_pk" PRIMARY KEY("turn_id","phase","policy_version","category"),
	CONSTRAINT "turn_safety_decisions_phase_check" CHECK ("turn_safety_decisions"."phase" in ('input', 'output')),
	CONSTRAINT "turn_safety_decisions_category_check" CHECK ("turn_safety_decisions"."category" in ('normal', 'pii', 'prompt_injection', 'self_harm', 'abuse', 'sexual_content', 'violence', 'dangerous_behavior')),
	CONSTRAINT "turn_safety_decisions_action_check" CHECK ("turn_safety_decisions"."action" in ('allow', 'block', 'escalate')),
	CONSTRAINT "turn_safety_decisions_policy_version_check" CHECK ("turn_safety_decisions"."policy_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
	CONSTRAINT "turn_safety_decisions_detector_version_check" CHECK ("turn_safety_decisions"."detector_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
);
--> statement-breakpoint
ALTER TABLE "turn_safety_decisions" ADD CONSTRAINT "turn_safety_decisions_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "turn_safety_decisions_session_turn_created_idx" ON "turn_safety_decisions" USING btree ("session_id","turn_id","created_at");--> statement-breakpoint
CREATE INDEX "turn_safety_decisions_category_action_created_idx" ON "turn_safety_decisions" USING btree ("category","action","created_at");