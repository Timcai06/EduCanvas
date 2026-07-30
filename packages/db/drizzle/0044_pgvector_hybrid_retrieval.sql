-- drizzle-kit 不会为自定义列类型生成扩展声明；vector 列与 hnsw 索引都依赖它，
-- 因此显式前置。IF NOT EXISTS 使重复迁移与已装扩展的库都保持幂等。
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "knowledge_chunk_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_model_version" text NOT NULL,
	"dimensions" integer NOT NULL,
	"instruction" text NOT NULL,
	"chunking_version" text NOT NULL,
	"chunk_content_hash" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_chunk_embeddings_dimensions_check" CHECK ("knowledge_chunk_embeddings"."dimensions" = 1536),
	CONSTRAINT "knowledge_chunk_embeddings_hash_check" CHECK ("knowledge_chunk_embeddings"."chunk_content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "knowledge_chunk_embeddings_identity_shape_check" CHECK ("knowledge_chunk_embeddings"."embedding_model" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$' and "knowledge_chunk_embeddings"."embedding_model_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' and "knowledge_chunk_embeddings"."instruction" ~ '^[a-z]+:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' and "knowledge_chunk_embeddings"."chunking_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
);
--> statement-breakpoint
CREATE TABLE "knowledge_embedding_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_model_version" text NOT NULL,
	"instruction" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"embedded_chunk_count" integer DEFAULT 0 NOT NULL,
	"total_chunk_count" integer NOT NULL,
	"failure_code" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_embedding_runs_status_check" CHECK ("knowledge_embedding_runs"."status" in ('queued', 'running', 'ready', 'failed')),
	CONSTRAINT "knowledge_embedding_runs_count_check" CHECK ("knowledge_embedding_runs"."total_chunk_count" >= 0 and "knowledge_embedding_runs"."embedded_chunk_count" between 0 and "knowledge_embedding_runs"."total_chunk_count"),
	CONSTRAINT "knowledge_embedding_runs_failure_shape_check" CHECK (("knowledge_embedding_runs"."status" = 'failed' and "knowledge_embedding_runs"."failure_code" ~ '^[a-z][a-z0-9_]{0,127}$') or ("knowledge_embedding_runs"."status" <> 'failed' and "knowledge_embedding_runs"."failure_code" is null)),
	CONSTRAINT "knowledge_embedding_runs_lifecycle_shape_check" CHECK (("knowledge_embedding_runs"."status" = 'queued' and "knowledge_embedding_runs"."started_at" is null and "knowledge_embedding_runs"."completed_at" is null) or ("knowledge_embedding_runs"."status" = 'running' and "knowledge_embedding_runs"."started_at" is not null and "knowledge_embedding_runs"."completed_at" is null) or ("knowledge_embedding_runs"."status" in ('ready', 'failed') and "knowledge_embedding_runs"."started_at" is not null and "knowledge_embedding_runs"."completed_at" is not null)),
	CONSTRAINT "knowledge_embedding_runs_identity_shape_check" CHECK ("knowledge_embedding_runs"."embedding_model" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$' and "knowledge_embedding_runs"."embedding_model_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' and "knowledge_embedding_runs"."instruction" ~ '^[a-z]+:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunk_embeddings" ADD CONSTRAINT "knowledge_chunk_embeddings_chunk_document_fk" FOREIGN KEY ("chunk_id","document_id") REFERENCES "public"."knowledge_chunks"("id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_embedding_runs" ADD CONSTRAINT "knowledge_embedding_runs_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunk_embeddings_identity_unique" ON "knowledge_chunk_embeddings" USING btree ("chunk_id","embedding_model","embedding_model_version","instruction");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_embeddings_document_idx" ON "knowledge_chunk_embeddings" USING btree ("document_id","embedding_model","embedding_model_version");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_embeddings_hnsw_idx" ON "knowledge_chunk_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_embedding_runs_identity_unique" ON "knowledge_embedding_runs" USING btree ("document_id","embedding_model","embedding_model_version","instruction");--> statement-breakpoint
CREATE INDEX "knowledge_embedding_runs_status_updated_idx" ON "knowledge_embedding_runs" USING btree ("status","updated_at","id");