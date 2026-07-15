CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content_hash" text NOT NULL,
	"content" text NOT NULL,
	"heading" text,
	"page_start" integer,
	"page_end" integer,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("heading", '') || ' ' || "content")) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_chunks_index_check" CHECK ("knowledge_chunks"."chunk_index" >= 0),
	CONSTRAINT "knowledge_chunks_hash_check" CHECK ("knowledge_chunks"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "knowledge_chunks_content_check" CHECK (char_length("knowledge_chunks"."content") between 1 and 20000 and ("knowledge_chunks"."heading" is null or char_length("knowledge_chunks"."heading") between 1 and 500)),
	CONSTRAINT "knowledge_chunks_page_check" CHECK (("knowledge_chunks"."page_start" is null and "knowledge_chunks"."page_end" is null) or ("knowledge_chunks"."page_start" >= 1 and "knowledge_chunks"."page_end" >= "knowledge_chunks"."page_start"))
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"object_key" text NOT NULL,
	"parser_version" text NOT NULL,
	"parse_status" text NOT NULL,
	"failure_code" text,
	"parsed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_documents_version_check" CHECK ("knowledge_documents"."version" >= 1),
	CONSTRAINT "knowledge_documents_hash_check" CHECK ("knowledge_documents"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "knowledge_documents_object_key_check" CHECK (char_length("knowledge_documents"."object_key") between 1 and 1024 and "knowledge_documents"."object_key" !~* '^https?://'),
	CONSTRAINT "knowledge_documents_parser_version_check" CHECK ("knowledge_documents"."parser_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
	CONSTRAINT "knowledge_documents_status_check" CHECK ("knowledge_documents"."parse_status" in ('ready', 'parse_failed', 'superseded', 'tombstoned')),
	CONSTRAINT "knowledge_documents_failure_shape_check" CHECK (("knowledge_documents"."parse_status" = 'parse_failed' and "knowledge_documents"."failure_code" is not null and char_length("knowledge_documents"."failure_code") between 1 and 128) or ("knowledge_documents"."parse_status" <> 'parse_failed' and "knowledge_documents"."failure_code" is null))
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grade_band" text NOT NULL,
	"course_slug" text NOT NULL,
	"source_key" text NOT NULL,
	"title" text NOT NULL,
	"source_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"tombstoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_sources_type_check" CHECK ("knowledge_sources"."source_type" in ('text', 'pdf')),
	CONSTRAINT "knowledge_sources_status_check" CHECK ("knowledge_sources"."status" in ('active', 'tombstoned')),
	CONSTRAINT "knowledge_sources_tombstone_check" CHECK (("knowledge_sources"."status" = 'active' and "knowledge_sources"."tombstoned_at" is null) or ("knowledge_sources"."status" = 'tombstoned' and "knowledge_sources"."tombstoned_at" is not null)),
	CONSTRAINT "knowledge_sources_text_shape_check" CHECK (char_length("knowledge_sources"."grade_band") between 1 and 64 and char_length("knowledge_sources"."course_slug") between 1 and 128 and char_length("knowledge_sources"."source_key") between 1 and 128 and char_length("knowledge_sources"."title") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "message_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"assistant_message_id" uuid NOT NULL,
	"retrieval_candidate_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_citations_ordinal_check" CHECK ("message_citations"."ordinal" >= 1)
);
--> statement-breakpoint
CREATE TABLE "retrieval_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"turn_source_version_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"retriever" text NOT NULL,
	"retriever_version" text NOT NULL,
	"rank" integer NOT NULL,
	"score" double precision NOT NULL,
	"query_hash" text NOT NULL,
	"trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retrieval_candidates_rank_check" CHECK ("retrieval_candidates"."rank" >= 1),
	CONSTRAINT "retrieval_candidates_score_check" CHECK ("retrieval_candidates"."score" >= 0 and "retrieval_candidates"."score" <= 1),
	CONSTRAINT "retrieval_candidates_query_hash_check" CHECK ("retrieval_candidates"."query_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "retrieval_candidates_version_check" CHECK ("retrieval_candidates"."retriever" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' and "retrieval_candidates"."retriever_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
);
--> statement-breakpoint
CREATE TABLE "session_source_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"mutation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_source_bindings_sequence_check" CHECK ("session_source_bindings"."sequence" >= 1),
	CONSTRAINT "session_source_bindings_mutation_check" CHECK ("session_source_bindings"."mutation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
);
--> statement-breakpoint
CREATE TABLE "turn_source_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_source_versions_document_version_check" CHECK ("turn_source_versions"."document_version" >= 1),
	CONSTRAINT "turn_source_versions_hash_check" CHECK ("turn_source_versions"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_assistant_message_id_chat_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_retrieval_candidate_id_retrieval_candidates_id_fk" FOREIGN KEY ("retrieval_candidate_id") REFERENCES "public"."retrieval_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_candidates" ADD CONSTRAINT "retrieval_candidates_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_candidates" ADD CONSTRAINT "retrieval_candidates_turn_source_version_id_turn_source_versions_id_fk" FOREIGN KEY ("turn_source_version_id") REFERENCES "public"."turn_source_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_candidates" ADD CONSTRAINT "retrieval_candidates_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_source_bindings" ADD CONSTRAINT "session_source_bindings_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_source_bindings" ADD CONSTRAINT "session_source_bindings_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_source_versions" ADD CONSTRAINT "turn_source_versions_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_source_versions" ADD CONSTRAINT "turn_source_versions_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_source_versions" ADD CONSTRAINT "turn_source_versions_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_document_index_unique" ON "knowledge_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_document_idx" ON "knowledge_chunks" USING btree ("document_id","id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_fts_idx" ON "knowledge_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_source_hash_unique" ON "knowledge_documents" USING btree ("source_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_source_version_unique" ON "knowledge_documents" USING btree ("source_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_one_ready_per_source" ON "knowledge_documents" USING btree ("source_id") WHERE "knowledge_documents"."parse_status" = 'ready';--> statement-breakpoint
CREATE INDEX "knowledge_documents_source_status_version_idx" ON "knowledge_documents" USING btree ("source_id","parse_status","version");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_course_key_unique" ON "knowledge_sources" USING btree ("grade_band","course_slug","source_key");--> statement-breakpoint
CREATE INDEX "knowledge_sources_course_status_idx" ON "knowledge_sources" USING btree ("grade_band","course_slug","status","id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_citations_message_ordinal_unique" ON "message_citations" USING btree ("assistant_message_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "message_citations_message_candidate_unique" ON "message_citations" USING btree ("assistant_message_id","retrieval_candidate_id");--> statement-breakpoint
CREATE INDEX "message_citations_session_turn_idx" ON "message_citations" USING btree ("session_id","turn_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_candidates_query_rank_unique" ON "retrieval_candidates" USING btree ("turn_id","query_hash","retriever","retriever_version","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_candidates_query_chunk_unique" ON "retrieval_candidates" USING btree ("turn_id","query_hash","retriever","retriever_version","chunk_id");--> statement-breakpoint
CREATE INDEX "retrieval_candidates_session_turn_rank_idx" ON "retrieval_candidates" USING btree ("session_id","turn_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "session_source_bindings_session_mutation_unique" ON "session_source_bindings" USING btree ("session_id","mutation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_source_bindings_session_source_sequence_unique" ON "session_source_bindings" USING btree ("session_id","source_id","sequence");--> statement-breakpoint
CREATE INDEX "session_source_bindings_latest_idx" ON "session_source_bindings" USING btree ("session_id","source_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "turn_source_versions_turn_source_unique" ON "turn_source_versions" USING btree ("turn_id","source_id");--> statement-breakpoint
CREATE INDEX "turn_source_versions_session_turn_idx" ON "turn_source_versions" USING btree ("session_id","turn_id","id");
--> statement-breakpoint
CREATE FUNCTION prevent_knowledge_source_metadata_mutation() RETURNS trigger AS $$
BEGIN
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.grade_band IS DISTINCT FROM OLD.grade_band
		OR NEW.course_slug IS DISTINCT FROM OLD.course_slug
		OR NEW.source_key IS DISTINCT FROM OLD.source_key
		OR NEW.title IS DISTINCT FROM OLD.title
		OR NEW.source_type IS DISTINCT FROM OLD.source_type
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'knowledge source metadata is immutable' USING ERRCODE = '23514';
	END IF;
	IF OLD.status = 'tombstoned' AND NEW IS DISTINCT FROM OLD THEN
		RAISE EXCEPTION 'tombstoned knowledge source is immutable' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER knowledge_sources_immutable_metadata
BEFORE UPDATE ON knowledge_sources
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_source_metadata_mutation();
--> statement-breakpoint
CREATE FUNCTION prevent_knowledge_document_mutation() RETURNS trigger AS $$
BEGIN
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.source_id IS DISTINCT FROM OLD.source_id
		OR NEW.version IS DISTINCT FROM OLD.version
		OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
		OR NEW.object_key IS DISTINCT FROM OLD.object_key
		OR NEW.parser_version IS DISTINCT FROM OLD.parser_version
		OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
		OR NEW.parsed_at IS DISTINCT FROM OLD.parsed_at
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'knowledge document version is immutable' USING ERRCODE = '23514';
	END IF;
	IF NEW.parse_status IS DISTINCT FROM OLD.parse_status
		AND NOT (
			OLD.parse_status = 'ready'
			AND NEW.parse_status IN ('superseded', 'tombstoned')
		) THEN
		RAISE EXCEPTION 'invalid knowledge document status transition' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER knowledge_documents_immutable_version
BEFORE UPDATE ON knowledge_documents
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_document_mutation();
--> statement-breakpoint
CREATE FUNCTION prevent_knowledge_chunk_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'knowledge chunks are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER knowledge_chunks_immutable
BEFORE UPDATE OR DELETE ON knowledge_chunks
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_chunk_mutation();
--> statement-breakpoint
CREATE FUNCTION prevent_knowledge_fact_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'knowledge snapshot facts are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER session_source_bindings_append_only
BEFORE UPDATE ON session_source_bindings
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_fact_update();
--> statement-breakpoint
CREATE TRIGGER turn_source_versions_append_only
BEFORE UPDATE ON turn_source_versions
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_fact_update();
--> statement-breakpoint
CREATE TRIGGER retrieval_candidates_append_only
BEFORE UPDATE ON retrieval_candidates
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_fact_update();
--> statement-breakpoint
CREATE TRIGGER message_citations_append_only
BEFORE UPDATE ON message_citations
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_fact_update();
