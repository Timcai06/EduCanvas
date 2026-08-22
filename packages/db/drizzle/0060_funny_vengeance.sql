CREATE TABLE "research_checkpoints" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"protocol_version" text NOT NULL,
	"phase" text NOT NULL,
	"completed_queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidate_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_checkpoints_protocol_version_check" CHECK ("research_checkpoints"."protocol_version" = 'educanvas.research-checkpoint.v1'),
	CONSTRAINT "research_checkpoints_phase_check" CHECK ("research_checkpoints"."phase" in ('planning', 'searching', 'reading', 'synthesizing')),
	CONSTRAINT "research_checkpoints_completed_queries_check" CHECK (jsonb_typeof("research_checkpoints"."completed_queries") = 'array' and jsonb_array_length("research_checkpoints"."completed_queries") between 0 and 5),
	CONSTRAINT "research_checkpoints_candidate_urls_check" CHECK (jsonb_typeof("research_checkpoints"."candidate_urls") = 'array' and jsonb_array_length("research_checkpoints"."candidate_urls") between 0 and 15)
);
--> statement-breakpoint
ALTER TABLE "research_checkpoints" ADD CONSTRAINT "research_checkpoints_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;