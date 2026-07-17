CREATE TABLE "canvas_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"artifact_id" text NOT NULL,
	"type" text NOT NULL,
	"schema_version" text NOT NULL,
	"title" text NOT NULL,
	"params" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"knowledge_node_id" text,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"schema_version" text DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" text NOT NULL,
	"grade_band" text NOT NULL,
	"course_slug" text NOT NULL,
	"state" text DEFAULT 'EXPLAIN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mastery_states" (
	"student_id" text NOT NULL,
	"knowledge_node_id" text NOT NULL,
	"mastery_score" real DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"hint_count" integer DEFAULT 0 NOT NULL,
	"misconception_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_practiced_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mastery_states_student_id_knowledge_node_id_pk" PRIMARY KEY("student_id","knowledge_node_id")
);
--> statement-breakpoint
ALTER TABLE "canvas_artifacts" ADD CONSTRAINT "canvas_artifacts_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE no action ON UPDATE no action;