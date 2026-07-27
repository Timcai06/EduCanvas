ALTER TABLE "asset_processing_jobs" DROP CONSTRAINT "asset_processing_jobs_kind_check";--> statement-breakpoint
ALTER TABLE "asset_representations" DROP CONSTRAINT "asset_representations_kind_check";--> statement-breakpoint
ALTER TABLE "asset_versions" ADD COLUMN "transcription_text" text;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD COLUMN "transcription_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" ADD CONSTRAINT "asset_processing_jobs_kind_check" CHECK ("asset_processing_jobs"."kind" in ('extract_text', 'render_preview', 'generate_thumbnail', 'transcribe_audio'));--> statement-breakpoint
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_kind_check" CHECK ("asset_representations"."kind" in ('original', 'text', 'preview', 'thumbnail', 'transcription'));