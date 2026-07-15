CREATE TABLE "turn_source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" DROP CONSTRAINT "knowledge_chunks_page_check";--> statement-breakpoint
ALTER TABLE "retrieval_candidates" DROP CONSTRAINT "retrieval_candidates_turn_source_version_id_turn_source_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval_candidates" DROP CONSTRAINT "retrieval_candidates_chunk_id_knowledge_chunks_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval_candidates" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "turn_source_snapshots" ADD CONSTRAINT "turn_source_snapshots_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "turn_source_snapshots_session_turn_unique" ON "turn_source_snapshots" USING btree ("session_id","turn_id");--> statement-breakpoint
INSERT INTO "turn_source_snapshots" ("session_id", "turn_id", "created_at")
SELECT "session_id", "turn_id", min("created_at")
FROM "turn_source_versions"
GROUP BY "session_id", "turn_id"
ON CONFLICT ("session_id", "turn_id") DO NOTHING;--> statement-breakpoint
DELETE FROM "retrieval_candidates" AS candidate
USING "turn_source_versions" AS snapshot, "knowledge_chunks" AS chunk
WHERE candidate."turn_source_version_id" = snapshot."id"
	AND candidate."chunk_id" = chunk."id"
	AND snapshot."document_id" IS DISTINCT FROM chunk."document_id";--> statement-breakpoint
UPDATE "retrieval_candidates" AS candidate
SET "document_id" = snapshot."document_id"
FROM "turn_source_versions" AS snapshot
WHERE candidate."turn_source_version_id" = snapshot."id";--> statement-breakpoint
ALTER TABLE "retrieval_candidates" ALTER COLUMN "document_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_id_document_unique" ON "knowledge_chunks" USING btree ("id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "turn_source_versions_id_document_unique" ON "turn_source_versions" USING btree ("id","document_id");--> statement-breakpoint
ALTER TABLE "retrieval_candidates" ADD CONSTRAINT "retrieval_candidates_snapshot_document_fk" FOREIGN KEY ("turn_source_version_id","document_id") REFERENCES "public"."turn_source_versions"("id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_candidates" ADD CONSTRAINT "retrieval_candidates_chunk_document_fk" FOREIGN KEY ("chunk_id","document_id") REFERENCES "public"."knowledge_chunks"("id","document_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" DISABLE TRIGGER "knowledge_chunks_immutable";--> statement-breakpoint
UPDATE "knowledge_chunks"
SET "page_start" = NULL, "page_end" = NULL
WHERE ("page_start" IS NULL) <> ("page_end" IS NULL);--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ENABLE TRIGGER "knowledge_chunks_immutable";--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_page_check" CHECK (("knowledge_chunks"."page_start" is null and "knowledge_chunks"."page_end" is null) or ("knowledge_chunks"."page_start" is not null and "knowledge_chunks"."page_end" is not null and "knowledge_chunks"."page_start" >= 1 and "knowledge_chunks"."page_end" >= "knowledge_chunks"."page_start"));--> statement-breakpoint
CREATE FUNCTION prevent_turn_source_snapshot_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'turn source snapshot completion facts are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER turn_source_snapshots_append_only
BEFORE UPDATE ON turn_source_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_turn_source_snapshot_update();
