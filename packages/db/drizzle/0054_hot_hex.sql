CREATE TABLE "resource_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_version_id" uuid,
	"owner_subject_id" text NOT NULL,
	"author_pen" text NOT NULL,
	"kind" text NOT NULL,
	"geometry" jsonb NOT NULL,
	"body" text,
	"source" text NOT NULL,
	"operation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_annotations_resource_kind_check" CHECK ("resource_annotations"."resource_kind" in ('asset', 'artifact')),
	CONSTRAINT "resource_annotations_author_pen_check" CHECK ("resource_annotations"."author_pen" in ('dai', 'zhusha')),
	CONSTRAINT "resource_annotations_kind_check" CHECK ("resource_annotations"."kind" in ('circle', 'underline', 'strike', 'note', 'seal')),
	CONSTRAINT "resource_annotations_source_check" CHECK ("resource_annotations"."source" in ('voice', 'canvas', 'chat')),
	CONSTRAINT "resource_annotations_geometry_check" CHECK (jsonb_typeof("resource_annotations"."geometry") = 'object'),
	CONSTRAINT "resource_annotations_body_check" CHECK (("resource_annotations"."kind" = 'note' and "resource_annotations"."body" is not null and char_length("resource_annotations"."body") between 1 and 2000)
        or ("resource_annotations"."kind" <> 'note' and ("resource_annotations"."body" is null or char_length("resource_annotations"."body") <= 2000))),
	CONSTRAINT "resource_annotations_owner_check" CHECK (char_length("resource_annotations"."owner_subject_id") between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "resource_annotations" ADD CONSTRAINT "resource_annotations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_annotations_space_fk_idx" ON "resource_annotations" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "resource_annotations_resource_idx" ON "resource_annotations" USING btree ("resource_kind","resource_id");--> statement-breakpoint
CREATE INDEX "resource_annotations_owner_space_idx" ON "resource_annotations" USING btree ("owner_subject_id","space_id");