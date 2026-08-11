CREATE TABLE "notebook_surface_positions" (
	"space_id" uuid NOT NULL,
	"owner_subject_id" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"zone" text NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"z" integer NOT NULL,
	"rest_state" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notebook_surface_positions_space_id_owner_subject_id_resource_kind_resource_id_pk" PRIMARY KEY("space_id","owner_subject_id","resource_kind","resource_id"),
	CONSTRAINT "notebook_surface_positions_resource_kind_check" CHECK ("notebook_surface_positions"."resource_kind" in ('source', 'artifact')),
	CONSTRAINT "notebook_surface_positions_zone_check" CHECK ("notebook_surface_positions"."zone" in ('center', 'periphery', 'margin')),
	CONSTRAINT "notebook_surface_positions_rest_state_check" CHECK ("notebook_surface_positions"."rest_state" in ('open', 'folded', 'pinned')),
	CONSTRAINT "notebook_surface_positions_coordinates_check" CHECK ("notebook_surface_positions"."x" between 0 and 1 and "notebook_surface_positions"."y" between 0 and 1 and "notebook_surface_positions"."z" between 0 and 100),
	CONSTRAINT "notebook_surface_positions_owner_check" CHECK (char_length("notebook_surface_positions"."owner_subject_id") between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "notebook_surface_positions" ADD CONSTRAINT "notebook_surface_positions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notebook_surface_positions_owner_updated_idx" ON "notebook_surface_positions" USING btree ("owner_subject_id","space_id","updated_at");