CREATE TABLE "diagnostic_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_attempt_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"definition_version" text NOT NULL,
	"answer_fingerprint" text NOT NULL,
	"attempted_items" integer NOT NULL,
	"correct_items" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_attempts_shape_check" CHECK ("diagnostic_attempts"."attempted_items" between 3 and 10 and "diagnostic_attempts"."correct_items" between 0 and "diagnostic_attempts"."attempted_items" and char_length("diagnostic_attempts"."definition_version") between 1 and 128 and "diagnostic_attempts"."answer_fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "diagnostic_responses" (
	"attempt_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"objective_id" uuid NOT NULL,
	"selected_option_id" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"grading_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_responses_attempt_id_question_id_pk" PRIMARY KEY("attempt_id","question_id"),
	CONSTRAINT "diagnostic_responses_text_check" CHECK (char_length("diagnostic_responses"."question_id") between 1 and 128 and char_length("diagnostic_responses"."selected_option_id") between 1 and 128 and char_length("diagnostic_responses"."grading_version") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "learner_profiles" (
	"student_id" text PRIMARY KEY NOT NULL,
	"age_band" text NOT NULL,
	"default_grade_band" text NOT NULL,
	"declaration_source" text NOT NULL,
	"declared_by_user_id" text NOT NULL,
	"preferences" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_profiles_age_band_check" CHECK ("learner_profiles"."age_band" in ('under_13', '13_to_15', '16_to_17', 'adult', 'unknown')),
	CONSTRAINT "learner_profiles_grade_band_check" CHECK ("learner_profiles"."default_grade_band" in ('primary_school', 'middle_school', 'high_school')),
	CONSTRAINT "learner_profiles_source_check" CHECK ("learner_profiles"."declaration_source" in ('self_declared', 'guardian_declared', 'school_asserted')),
	CONSTRAINT "learner_profiles_shape_check" CHECK (jsonb_typeof("learner_profiles"."preferences") = 'object'
        and "learner_profiles"."preferences" ?& array['explanationOrder', 'responseDepth', 'guidance', 'modality', 'feedbackStyle']::text[]
        and "learner_profiles"."preferences" - array['explanationOrder', 'responseDepth', 'guidance', 'modality', 'feedbackStyle']::text[] = '{}'::jsonb
        and "learner_profiles"."preferences"->>'explanationOrder' in ('example_first', 'concept_first')
        and "learner_profiles"."preferences"->>'responseDepth' in ('concise', 'balanced', 'detailed')
        and "learner_profiles"."preferences"->>'guidance' in ('step_by_step', 'independent_first')
        and "learner_profiles"."preferences"->>'modality' in ('visual', 'text', 'practice', 'mixed')
        and "learner_profiles"."preferences"->>'feedbackStyle' in ('gentle', 'direct', 'balanced')
        and "learner_profiles"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "learning_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"course_slug" text NOT NULL,
	"course_version" text NOT NULL,
	"grade_band" text NOT NULL,
	"topic" text NOT NULL,
	"desired_outcome" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_goals_grade_band_check" CHECK ("learning_goals"."grade_band" in ('primary_school', 'middle_school', 'high_school')),
	CONSTRAINT "learning_goals_status_check" CHECK ("learning_goals"."status" in ('active', 'completed', 'archived')),
	CONSTRAINT "learning_goals_text_check" CHECK (char_length("learning_goals"."course_slug") between 1 and 128 and char_length("learning_goals"."course_version") between 1 and 64 and char_length("learning_goals"."topic") between 1 and 120 and char_length("learning_goals"."desired_outcome") between 1 and 500),
	CONSTRAINT "learning_goals_lifecycle_check" CHECK (("learning_goals"."status" = 'active' and "learning_goals"."completed_at" is null and "learning_goals"."archived_at" is null) or ("learning_goals"."status" = 'completed' and "learning_goals"."completed_at" is not null and "learning_goals"."archived_at" is null) or ("learning_goals"."status" = 'archived' and "learning_goals"."archived_at" is not null)),
	CONSTRAINT "learning_goals_version_check" CHECK ("learning_goals"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "learning_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"objective_key" text NOT NULL,
	"knowledge_node_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"sequence" integer NOT NULL,
	"prerequisite_objective_keys" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_objectives_text_check" CHECK (char_length("learning_objectives"."objective_key") between 1 and 128 and char_length("learning_objectives"."knowledge_node_id") between 1 and 128 and char_length("learning_objectives"."title") between 1 and 80 and char_length("learning_objectives"."description") between 1 and 300),
	CONSTRAINT "learning_objectives_shape_check" CHECK ("learning_objectives"."sequence" between 1 and 12 and cardinality("learning_objectives"."prerequisite_objective_keys") <= 4)
);
--> statement-breakpoint
ALTER TABLE "diagnostic_attempts" ADD CONSTRAINT "diagnostic_attempts_goal_id_learning_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_attempts" ADD CONSTRAINT "diagnostic_attempts_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_attempts" ADD CONSTRAINT "diagnostic_attempts_student_id_platform_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_responses" ADD CONSTRAINT "diagnostic_responses_attempt_id_diagnostic_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."diagnostic_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_responses" ADD CONSTRAINT "diagnostic_responses_objective_id_learning_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."learning_objectives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_student_id_platform_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_declared_by_user_id_platform_users_id_fk" FOREIGN KEY ("declared_by_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_goals" ADD CONSTRAINT "learning_goals_notebook_id_spaces_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_goals" ADD CONSTRAINT "learning_goals_student_id_platform_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_objectives" ADD CONSTRAINT "learning_objectives_goal_id_learning_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnostic_attempts_client_id_unique" ON "diagnostic_attempts" USING btree ("client_attempt_id");--> statement-breakpoint
CREATE INDEX "diagnostic_attempts_goal_recent_idx" ON "diagnostic_attempts" USING btree ("goal_id","submitted_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_goals_notebook_active_unique" ON "learning_goals" USING btree ("notebook_id") WHERE "learning_goals"."status" = 'active';--> statement-breakpoint
CREATE INDEX "learning_goals_student_recent_idx" ON "learning_goals" USING btree ("student_id","status","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_objectives_goal_key_unique" ON "learning_objectives" USING btree ("goal_id","objective_key");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_objectives_goal_node_unique" ON "learning_objectives" USING btree ("goal_id","knowledge_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_objectives_goal_sequence_unique" ON "learning_objectives" USING btree ("goal_id","sequence");