CREATE TABLE "canvas_artifact_grading_keys" (
	"artifact_record_id" uuid PRIMARY KEY NOT NULL,
	"grading_key" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learning_events" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "learning_events" ALTER COLUMN "schema_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "learning_events" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "learning_events" ADD COLUMN "sequence" integer;--> statement-breakpoint
ALTER TABLE "learning_events" ADD COLUMN "recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learning_events" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "learning_events" ADD COLUMN "causation_id" text;--> statement-breakpoint
UPDATE "learning_events"
SET
	"idempotency_key" = 'migration:' || "id"::text,
	"recorded_at" = "occurred_at",
	"source" = 'migration',
	"causation_id" = 'migration:' || "id"::text;--> statement-breakpoint
WITH "ranked_events" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "session_id"
			ORDER BY "occurred_at", "id"
		)::integer AS "assigned_sequence"
	FROM "learning_events"
)
UPDATE "learning_events"
SET "sequence" = "ranked_events"."assigned_sequence"
FROM "ranked_events"
WHERE "learning_events"."id" = "ranked_events"."id";--> statement-breakpoint
ALTER TABLE "learning_events" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_events" ALTER COLUMN "sequence" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_events" ALTER COLUMN "recorded_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_events" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_events" ALTER COLUMN "causation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD COLUMN "knowledge_node_id" text;--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD COLUMN "interrupted_state" text;--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "canvas_artifact_grading_keys" ADD CONSTRAINT "canvas_artifact_grading_keys_artifact_record_id_canvas_artifacts_id_fk" FOREIGN KEY ("artifact_record_id") REFERENCES "public"."canvas_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_artifacts_session_artifact_unique" ON "canvas_artifacts" USING btree ("session_id","artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_events_idempotency_key_unique" ON "learning_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_events_session_sequence_unique" ON "learning_events" USING btree ("session_id","sequence");
