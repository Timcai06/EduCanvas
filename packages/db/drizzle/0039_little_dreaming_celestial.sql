CREATE TABLE "notebook_asset_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"mutation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notebook_asset_bindings_sequence_check" CHECK ("notebook_asset_bindings"."sequence" >= 1),
	CONSTRAINT "notebook_asset_bindings_text_shape_check" CHECK (char_length("notebook_asset_bindings"."subject_id") between 1 and 160 and char_length("notebook_asset_bindings"."mutation_id") between 1 and 128)
);
--> statement-breakpoint
ALTER TABLE "notebook_asset_bindings" ADD CONSTRAINT "notebook_asset_bindings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notebook_asset_bindings_subject_mutation_unique" ON "notebook_asset_bindings" USING btree ("subject_id","mutation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notebook_asset_bindings_subject_asset_sequence_unique" ON "notebook_asset_bindings" USING btree ("subject_id","asset_id","sequence");--> statement-breakpoint
CREATE INDEX "notebook_asset_bindings_latest_idx" ON "notebook_asset_bindings" USING btree ("subject_id","asset_id","sequence");