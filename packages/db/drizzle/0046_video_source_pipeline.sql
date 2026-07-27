CREATE TABLE "asset_video_keyframes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"algorithm_version" text NOT NULL,
	"ordinal" integer NOT NULL,
	"timestamp_seconds" double precision NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text NOT NULL,
	"byte_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_video_keyframes_ordinal_check" CHECK ("asset_video_keyframes"."ordinal" >= 1),
	CONSTRAINT "asset_video_keyframes_timestamp_check" CHECK ("asset_video_keyframes"."timestamp_seconds" >= 0),
	CONSTRAINT "asset_video_keyframes_size_check" CHECK ("asset_video_keyframes"."byte_size" > 0 and "asset_video_keyframes"."byte_size" <= 2097152),
	CONSTRAINT "asset_video_keyframes_hash_check" CHECK ("asset_video_keyframes"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "asset_video_keyframes_storage_key_check" CHECK (char_length("asset_video_keyframes"."storage_key") between 1 and 1024 and "asset_video_keyframes"."storage_key" !~* '^https?://'),
	CONSTRAINT "asset_video_keyframes_shape_check" CHECK ("asset_video_keyframes"."algorithm_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' and "asset_video_keyframes"."mime_type" = 'image/jpeg')
);
--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" DROP CONSTRAINT "asset_processing_jobs_kind_check";--> statement-breakpoint
ALTER TABLE "asset_representations" DROP CONSTRAINT "asset_representations_kind_check";--> statement-breakpoint
ALTER TABLE "object_deletion_outbox" DROP CONSTRAINT "object_deletion_outbox_source_check";--> statement-breakpoint
ALTER TABLE "asset_video_keyframes" ADD CONSTRAINT "asset_video_keyframes_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_video_keyframes_version_algorithm_ordinal_unique" ON "asset_video_keyframes" USING btree ("asset_version_id","algorithm_version","ordinal");--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" ADD CONSTRAINT "asset_processing_jobs_kind_check" CHECK ("asset_processing_jobs"."kind" in ('extract_text', 'render_preview', 'generate_thumbnail', 'transcribe_audio', 'process_video'));--> statement-breakpoint
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_kind_check" CHECK ("asset_representations"."kind" in ('original', 'text', 'preview', 'thumbnail', 'transcription', 'keyframes'));--> statement-breakpoint
ALTER TABLE "object_deletion_outbox" ADD CONSTRAINT "object_deletion_outbox_source_check" CHECK ("object_deletion_outbox"."source_type" in ('asset_version', 'asset_representation', 'asset_video_keyframe', 'artifact_version', 'user_avatar'));