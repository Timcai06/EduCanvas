CREATE TABLE "turn_context_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"builder_version" text NOT NULL,
	"included_message_ids" jsonb NOT NULL,
	"selected_asset_version_ids" jsonb NOT NULL,
	"omitted_message_count" integer NOT NULL,
	"character_count" integer NOT NULL,
	"context_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_context_snapshots_counts_check" CHECK ("turn_context_snapshots"."omitted_message_count" >= 0 and "turn_context_snapshots"."character_count" >= 0 and "turn_context_snapshots"."character_count" <= 128000),
	CONSTRAINT "turn_context_snapshots_hash_check" CHECK ("turn_context_snapshots"."context_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "turn_context_snapshots_version_check" CHECK (char_length("turn_context_snapshots"."builder_version") between 1 and 128)
);
--> statement-breakpoint
ALTER TABLE "turn_context_snapshots" ADD CONSTRAINT "turn_context_snapshots_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "turn_context_snapshots_session_turn_unique" ON "turn_context_snapshots" USING btree ("session_id","turn_id");--> statement-breakpoint
CREATE INDEX "turn_context_snapshots_session_created_idx" ON "turn_context_snapshots" USING btree ("session_id","created_at","id");