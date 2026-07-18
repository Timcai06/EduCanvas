CREATE TABLE "conversation_message_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assistant_message_id" uuid NOT NULL,
	"operation_source_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"locator_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_sources_kind_check" CHECK ("operation_sources"."kind" = 'web'),
	CONSTRAINT "operation_sources_ordinal_check" CHECK ("operation_sources"."ordinal" between 1 and 99),
	CONSTRAINT "operation_sources_public_shape_check" CHECK (char_length("operation_sources"."label") between 1 and 400 and char_length("operation_sources"."locator_url") between 8 and 2048 and "operation_sources"."locator_url" ~* '^https?://')
);
--> statement-breakpoint
ALTER TABLE "conversation_message_citations" ADD CONSTRAINT "conversation_citations_message_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_citations" ADD CONSTRAINT "conversation_citations_source_fk" FOREIGN KEY ("operation_source_id") REFERENCES "public"."operation_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_sources" ADD CONSTRAINT "operation_sources_operation_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_sources" ADD CONSTRAINT "operation_sources_asset_version_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_citations_message_source_unique" ON "conversation_message_citations" USING btree ("assistant_message_id","operation_source_id");--> statement-breakpoint
CREATE INDEX "conversation_message_citations_message_idx" ON "conversation_message_citations" USING btree ("assistant_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_sources_operation_ordinal_unique" ON "operation_sources" USING btree ("operation_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_sources_operation_url_unique" ON "operation_sources" USING btree ("operation_id","locator_url");--> statement-breakpoint
CREATE INDEX "operation_sources_asset_version_idx" ON "operation_sources" USING btree ("asset_version_id");