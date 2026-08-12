ALTER TABLE "turn_context_snapshots" ADD COLUMN "selected_asset_representations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_representations" ADD COLUMN "quality" text DEFAULT 'unavailable' NOT NULL;--> statement-breakpoint
/* 先 backfill 再约束：现有 text/ready 行按原文件 MIME 区分质量。
   text/plain、text/markdown 是直接 UTF-8 解码（structured，ADR-0026 决定 2）；
   pdf/docx 走 unpdf/mammoth 纯文本抽取（degraded_plain_text）。 */
UPDATE "asset_representations" AS r
SET "quality" = CASE
  WHEN r."status" = 'processing' THEN 'processing'
  WHEN r."status" = 'failed' THEN 'failed'
  WHEN r."status" = 'unavailable' THEN 'unavailable'
  WHEN r."status" = 'ready' AND r."kind" = 'text'
       AND v."mime_type" IN ('text/plain', 'text/markdown') THEN 'structured'
  WHEN r."status" = 'ready' AND r."kind" = 'text' THEN 'degraded_plain_text'
  ELSE 'unavailable'
END
FROM "asset_versions" v
WHERE v."id" = r."asset_version_id";--> statement-breakpoint
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_quality_check" CHECK ("asset_representations"."quality" in ('processing', 'structured', 'degraded_plain_text', 'failed', 'unavailable'));--> statement-breakpoint
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_quality_shape_check" CHECK (("asset_representations"."status" = 'processing' and "asset_representations"."quality" = 'processing') or ("asset_representations"."status" = 'failed' and "asset_representations"."quality" = 'failed') or ("asset_representations"."status" = 'unavailable' and "asset_representations"."quality" = 'unavailable') or ("asset_representations"."status" = 'ready' and "asset_representations"."kind" = 'text' and "asset_representations"."quality" in ('structured', 'degraded_plain_text')) or ("asset_representations"."status" = 'ready' and "asset_representations"."kind" <> 'text' and "asset_representations"."quality" = 'unavailable'));