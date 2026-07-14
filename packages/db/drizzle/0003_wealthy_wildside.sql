ALTER TABLE "lesson_sessions" ADD COLUMN "event_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "lesson_sessions"
SET "event_sequence" = COALESCE(
	(
		SELECT max("learning_events"."sequence")
		FROM "learning_events"
		WHERE "learning_events"."session_id" = "lesson_sessions"."id"
	),
	0
);
