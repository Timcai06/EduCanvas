ALTER TABLE "tool_effects" ADD COLUMN "reconciliation_verifier_id" text;
--> statement-breakpoint
ALTER TABLE "tool_effects" DROP CONSTRAINT "tool_effects_text_check";
--> statement-breakpoint
ALTER TABLE "tool_effects" ADD CONSTRAINT "tool_effects_text_check" CHECK ("tool_effects"."effect_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' and "tool_effects"."semantics_hash" ~ '^[a-f0-9]{64}$' and ("tool_effects"."reconciliation_verifier_id" is null or "tool_effects"."reconciliation_verifier_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$') and ("tool_effects"."code" is null or "tool_effects"."code" ~ '^[a-z][a-z0-9._:-]{0,127}$') and ("tool_effects"."receipt_hash" is null or "tool_effects"."receipt_hash" ~ '^[a-f0-9]{64}$'));
--> statement-breakpoint
CREATE TABLE "tool_effect_reconciliations" (
	"effect_id" uuid PRIMARY KEY NOT NULL,
	"resolution" text NOT NULL,
	"source" text NOT NULL,
	"resolver_id" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"receipt_hash" text,
	"code" text,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_effect_reconciliations_resolution_check" CHECK ("tool_effect_reconciliations"."resolution" in ('confirmed_committed', 'confirmed_not_committed')),
	CONSTRAINT "tool_effect_reconciliations_source_check" CHECK ("tool_effect_reconciliations"."source" in ('manual', 'adapter')),
	CONSTRAINT "tool_effect_reconciliations_text_check" CHECK ("tool_effect_reconciliations"."resolver_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' and "tool_effect_reconciliations"."evidence_hash" ~ '^[a-f0-9]{64}$' and ("tool_effect_reconciliations"."receipt_hash" is null or "tool_effect_reconciliations"."receipt_hash" ~ '^[a-f0-9]{64}$') and ("tool_effect_reconciliations"."code" is null or "tool_effect_reconciliations"."code" ~ '^[a-z][a-z0-9._:-]{0,127}$')),
	CONSTRAINT "tool_effect_reconciliations_shape_check" CHECK (("tool_effect_reconciliations"."resolution" = 'confirmed_committed' and "tool_effect_reconciliations"."code" is null) or ("tool_effect_reconciliations"."resolution" = 'confirmed_not_committed' and "tool_effect_reconciliations"."receipt_hash" is null and "tool_effect_reconciliations"."code" is not null))
);
--> statement-breakpoint
ALTER TABLE "tool_effect_reconciliations" ADD CONSTRAINT "tool_effect_reconciliations_effect_id_tool_effects_id_fk" FOREIGN KEY ("effect_id") REFERENCES "public"."tool_effects"("id") ON DELETE cascade ON UPDATE no action;
