CREATE TABLE "notebook_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"client_request_id" uuid NOT NULL,
	"title" text NOT NULL,
	"locator" jsonb NOT NULL,
	"origin" text DEFAULT 'user_grouped' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notebook_chapters_title_check" CHECK (char_length("notebook_chapters"."title") between 1 and 120),
	CONSTRAINT "notebook_chapters_origin_check" CHECK ("notebook_chapters"."origin" = 'user_grouped'),
	CONSTRAINT "notebook_chapters_locator_check" CHECK (jsonb_typeof("notebook_chapters"."locator") = 'object' and (
    ("notebook_chapters"."locator"->>'kind' = 'whole' and "notebook_chapters"."locator" - 'kind' = '{}'::jsonb) or
    ("notebook_chapters"."locator"->>'kind' in ('pages','text') and "notebook_chapters"."locator" ?& array['start','end']::text[] and "notebook_chapters"."locator" - array['kind','start','end']::text[] = '{}'::jsonb and jsonb_typeof("notebook_chapters"."locator"->'start') = 'number' and jsonb_typeof("notebook_chapters"."locator"->'end') = 'number' and ("notebook_chapters"."locator"->>'start')::numeric >= 0 and ("notebook_chapters"."locator"->>'end')::numeric >= ("notebook_chapters"."locator"->>'start')::numeric and ("notebook_chapters"."locator"->>'start')::numeric = trunc(("notebook_chapters"."locator"->>'start')::numeric) and ("notebook_chapters"."locator"->>'end')::numeric = trunc(("notebook_chapters"."locator"->>'end')::numeric))))
);
--> statement-breakpoint
CREATE TABLE "notebook_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"client_request_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"conversation_id" uuid,
	"chapter_id" uuid,
	"purpose" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notebook_plans_source_check" CHECK (("notebook_plans"."source_kind" = 'conversation' and "notebook_plans"."conversation_id" is not null and "notebook_plans"."chapter_id" is null and "notebook_plans"."purpose" is null) or ("notebook_plans"."source_kind" = 'chapter' and "notebook_plans"."chapter_id" is not null and "notebook_plans"."conversation_id" is null and "notebook_plans"."purpose" is null) or ("notebook_plans"."source_kind" = 'purpose' and "notebook_plans"."purpose" is not null and char_length("notebook_plans"."purpose") between 1 and 500 and "notebook_plans"."conversation_id" is null and "notebook_plans"."chapter_id" is null)),
	CONSTRAINT "notebook_plans_status_check" CHECK ("notebook_plans"."status" in ('active','completed','archived')),
	CONSTRAINT "notebook_plans_text_check" CHECK (char_length("notebook_plans"."title") between 1 and 120 and char_length("notebook_plans"."description") <= 5000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notebook_chapters_id_notebook_unique" ON "notebook_chapters" USING btree ("id","notebook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notebook_chapters_request_unique" ON "notebook_chapters" USING btree ("notebook_id","created_by_user_id","client_request_id");--> statement-breakpoint
CREATE INDEX "notebook_chapters_asset_version_fk_idx" ON "notebook_chapters" USING btree ("asset_version_id","asset_id");--> statement-breakpoint
CREATE INDEX "notebook_chapters_asset_notebook_fk_idx" ON "notebook_chapters" USING btree ("asset_id","notebook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notebook_plans_request_unique" ON "notebook_plans" USING btree ("notebook_id","created_by_user_id","client_request_id");--> statement-breakpoint
CREATE INDEX "notebook_plans_notebook_recent_idx" ON "notebook_plans" USING btree ("notebook_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notebook_plans_conversation_fk_idx" ON "notebook_plans" USING btree ("conversation_id","notebook_id");--> statement-breakpoint
CREATE INDEX "notebook_plans_chapter_fk_idx" ON "notebook_plans" USING btree ("chapter_id","notebook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_versions_id_asset_unique" ON "asset_versions" USING btree ("id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_id_space_unique" ON "assets" USING btree ("id","space_id");--> statement-breakpoint
ALTER TABLE "notebook_chapters" ADD CONSTRAINT "notebook_chapters_notebook_id_spaces_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_chapters" ADD CONSTRAINT "notebook_chapters_created_by_user_id_platform_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_chapters" ADD CONSTRAINT "notebook_chapters_asset_notebook_fk" FOREIGN KEY ("asset_id","notebook_id") REFERENCES "public"."assets"("id","space_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_chapters" ADD CONSTRAINT "notebook_chapters_version_asset_fk" FOREIGN KEY ("asset_version_id","asset_id") REFERENCES "public"."asset_versions"("id","asset_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_plans" ADD CONSTRAINT "notebook_plans_notebook_id_spaces_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_plans" ADD CONSTRAINT "notebook_plans_created_by_user_id_platform_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_plans" ADD CONSTRAINT "notebook_plans_conversation_notebook_fk" FOREIGN KEY ("conversation_id","notebook_id") REFERENCES "public"."conversations"("id","space_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_plans" ADD CONSTRAINT "notebook_plans_chapter_notebook_fk" FOREIGN KEY ("chapter_id","notebook_id") REFERENCES "public"."notebook_chapters"("id","notebook_id") ON DELETE cascade ON UPDATE no action;