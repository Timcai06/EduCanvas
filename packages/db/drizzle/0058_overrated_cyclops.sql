CREATE TABLE "asset_web_snapshots" (
	"asset_version_id" uuid PRIMARY KEY NOT NULL,
	"requested_url" text NOT NULL,
	"final_url" text NOT NULL,
	"response_content_type" text NOT NULL,
	"page_title" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_web_snapshots_url_shape_check" CHECK (char_length("asset_web_snapshots"."requested_url") between 1 and 2048 and char_length("asset_web_snapshots"."final_url") between 1 and 2048 and "asset_web_snapshots"."requested_url" ~* '^https?://' and "asset_web_snapshots"."final_url" ~* '^https?://'),
	CONSTRAINT "asset_web_snapshots_text_shape_check" CHECK (char_length("asset_web_snapshots"."response_content_type") between 1 and 255 and ("asset_web_snapshots"."page_title" is null or char_length("asset_web_snapshots"."page_title") between 1 and 300))
);
--> statement-breakpoint
ALTER TABLE "asset_web_snapshots" ADD CONSTRAINT "asset_web_snapshots_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_web_snapshots_fetched_idx" ON "asset_web_snapshots" USING btree ("fetched_at");