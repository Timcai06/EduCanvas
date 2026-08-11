ALTER TABLE "turn_context_snapshots" ADD COLUMN "selected_asset_representations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
/* ADR-0026 第 5 节：历史 Turn 未冻结表示身份（默认 '[]'），只影响未来写入；
   应用层 prepareTurnContextMaterial 会校验与版本 ID 同序同数。 */
