CREATE TABLE "agent_message_parts" (
	"message_id" uuid NOT NULL,
	"part_index" integer NOT NULL,
	"part_type" text NOT NULL,
	"text_content" text,
	"asset_id" uuid,
	"asset_version_id" uuid,
	"asset_usage" text,
	"artifact_id" text,
	"artifact_version_id" text,
	"artifact_kind" text,
	CONSTRAINT "agent_message_parts_message_id_part_index_pk" PRIMARY KEY("message_id","part_index"),
	CONSTRAINT "agent_message_parts_index_check" CHECK ("agent_message_parts"."part_index" >= 0 and "agent_message_parts"."part_index" < 32),
	CONSTRAINT "agent_message_parts_type_check" CHECK ("agent_message_parts"."part_type" in ('text', 'asset_ref', 'artifact_ref')),
	CONSTRAINT "agent_message_parts_shape_check" CHECK (("agent_message_parts"."part_type" = 'text' and "agent_message_parts"."text_content" is not null and "agent_message_parts"."asset_id" is null and "agent_message_parts"."asset_version_id" is null and "agent_message_parts"."asset_usage" is null and "agent_message_parts"."artifact_id" is null and "agent_message_parts"."artifact_version_id" is null and "agent_message_parts"."artifact_kind" is null) or ("agent_message_parts"."part_type" = 'asset_ref' and "agent_message_parts"."text_content" is null and "agent_message_parts"."asset_id" is not null and "agent_message_parts"."asset_version_id" is not null and "agent_message_parts"."asset_usage" in ('attachment', 'context') and "agent_message_parts"."artifact_id" is null and "agent_message_parts"."artifact_version_id" is null and "agent_message_parts"."artifact_kind" is null) or ("agent_message_parts"."part_type" = 'artifact_ref' and "agent_message_parts"."text_content" is null and "agent_message_parts"."asset_id" is null and "agent_message_parts"."asset_version_id" is null and "agent_message_parts"."asset_usage" is null and "agent_message_parts"."artifact_id" is not null and "agent_message_parts"."artifact_version_id" is not null and "agent_message_parts"."artifact_kind" in ('image', 'audio', 'video', 'slide', 'interactive', 'document')))
);
--> statement-breakpoint
CREATE TABLE "asset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"status" text NOT NULL,
	"storage_key" text NOT NULL,
	"extracted_text" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_versions_kind_check" CHECK ("asset_versions"."kind" in ('image', 'audio', 'video', 'document', 'data', 'link', 'other')),
	CONSTRAINT "asset_versions_status_check" CHECK ("asset_versions"."status" in ('processing', 'ready', 'failed', 'tombstoned')),
	CONSTRAINT "asset_versions_size_check" CHECK ("asset_versions"."byte_size" >= 0 and "asset_versions"."byte_size" <= 52428800),
	CONSTRAINT "asset_versions_hash_check" CHECK ("asset_versions"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "asset_versions_storage_key_check" CHECK (char_length("asset_versions"."storage_key") between 1 and 1024 and "asset_versions"."storage_key" !~* '^https?://'),
	CONSTRAINT "asset_versions_failure_shape_check" CHECK (("asset_versions"."status" = 'failed' and "asset_versions"."failure_code" is not null) or ("asset_versions"."status" <> 'failed' and "asset_versions"."failure_code" is null))
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_subject_id" text NOT NULL,
	"space_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"origin" text NOT NULL,
	"display_name" text NOT NULL,
	"mime_type" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_version_id" uuid,
	"tombstoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_scope_check" CHECK ("assets"."scope" in ('turn', 'space')),
	CONSTRAINT "assets_kind_check" CHECK ("assets"."kind" in ('image', 'audio', 'video', 'document', 'data', 'link', 'other')),
	CONSTRAINT "assets_origin_check" CHECK ("assets"."origin" in ('upload', 'url_import', 'generated', 'library')),
	CONSTRAINT "assets_status_check" CHECK ("assets"."status" in ('pending', 'processing', 'ready', 'failed', 'tombstoned')),
	CONSTRAINT "assets_status_shape_check" CHECK (("assets"."status" = 'ready' and "assets"."current_version_id" is not null and "assets"."tombstoned_at" is null) or ("assets"."status" in ('pending', 'processing', 'failed') and "assets"."current_version_id" is null and "assets"."tombstoned_at" is null) or ("assets"."status" = 'tombstoned' and "assets"."tombstoned_at" is not null)),
	CONSTRAINT "assets_text_shape_check" CHECK (char_length("assets"."owner_subject_id") between 1 and 160 and char_length("assets"."display_name") between 1 and 300 and ("assets"."mime_type" is null or char_length("assets"."mime_type") between 1 and 255))
);
--> statement-breakpoint
ALTER TABLE "agent_message_parts" ADD CONSTRAINT "agent_message_parts_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message_parts" ADD CONSTRAINT "agent_message_parts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message_parts" ADD CONSTRAINT "agent_message_parts_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_current_version_id_asset_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_message_parts_asset_version_idx" ON "agent_message_parts" USING btree ("asset_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_versions_asset_hash_unique" ON "asset_versions" USING btree ("asset_id","content_hash");--> statement-breakpoint
CREATE INDEX "asset_versions_asset_created_idx" ON "asset_versions" USING btree ("asset_id","created_at","id");--> statement-breakpoint
CREATE INDEX "assets_owner_space_status_idx" ON "assets" USING btree ("owner_subject_id","space_id","status","created_at","id");