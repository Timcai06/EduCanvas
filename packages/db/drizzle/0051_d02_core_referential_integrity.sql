-- D02 preflight is deliberately fail-closed. Only the single audited local-development
-- orphan may be repaired here; any other orphan requires an explicit disposition before
-- this migration is allowed to add the foreign keys.
DO $$
DECLARE
  unexpected_asset_orphans bigint;
  lesson_session_orphans bigint;
  budget_outcome_orphans bigint;
BEGIN
  SELECT count(*) INTO unexpected_asset_orphans
  FROM "assets" a
  LEFT JOIN "spaces" s ON s."id" = a."space_id"
  WHERE s."id" IS NULL
    AND NOT (
      a."id" = 'f488d009-7753-46e7-9367-c83d5036e265'::uuid
      AND a."space_id" = 'eac85d6a-7e4c-44ce-a8d7-4abd9f06d081'::uuid
    );

  SELECT count(*) INTO lesson_session_orphans
  FROM "lesson_sessions" ls
  LEFT JOIN "platform_users" u ON u."id" = ls."student_id"
  WHERE u."id" IS NULL;

  SELECT count(*) INTO budget_outcome_orphans
  FROM "turn_usage_budget_outcomes" outcome
  LEFT JOIN "agent_operations" operation
    ON operation."id" = outcome."operation_id"
  WHERE operation."id" IS NULL;

  IF unexpected_asset_orphans > 0
    OR lesson_session_orphans > 0
    OR budget_outcome_orphans > 0 THEN
    RAISE EXCEPTION
      'D02 referential-integrity preflight failed: unexpected_asset_orphans=%, lesson_session_orphans=%, budget_outcome_orphans=%',
      unexpected_asset_orphans,
      lesson_session_orphans,
      budget_outcome_orphans
      USING ERRCODE = '23503';
  END IF;
END $$;
--> statement-breakpoint
-- Queue physical deletion before removing the one audited orphan and its descendants.
-- The outbox intentionally has no FK to source rows so the deletion intent survives.
INSERT INTO "object_deletion_outbox" (
  "object_kind", "storage_key", "source_type", "source_id"
)
SELECT 'asset', version."storage_key", 'asset_version', version."id"
FROM "asset_versions" version
WHERE version."asset_id" = 'f488d009-7753-46e7-9367-c83d5036e265'::uuid
ON CONFLICT ("object_kind", "storage_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "object_deletion_outbox" (
  "object_kind", "storage_key", "source_type", "source_id"
)
SELECT 'asset', representation."derived_storage_key", 'asset_representation', representation."id"
FROM "asset_representations" representation
JOIN "asset_versions" version
  ON version."id" = representation."asset_version_id"
WHERE version."asset_id" = 'f488d009-7753-46e7-9367-c83d5036e265'::uuid
  AND representation."derived_storage_key" IS NOT NULL
ON CONFLICT ("object_kind", "storage_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "object_deletion_outbox" (
  "object_kind", "storage_key", "source_type", "source_id"
)
SELECT 'asset', keyframe."storage_key", 'asset_video_keyframe', keyframe."id"
FROM "asset_video_keyframes" keyframe
JOIN "asset_versions" version
  ON version."id" = keyframe."asset_version_id"
WHERE version."asset_id" = 'f488d009-7753-46e7-9367-c83d5036e265'::uuid
ON CONFLICT ("object_kind", "storage_key") DO NOTHING;
--> statement-breakpoint
DELETE FROM "assets"
WHERE "id" = 'f488d009-7753-46e7-9367-c83d5036e265'::uuid
  AND "space_id" = 'eac85d6a-7e4c-44ce-a8d7-4abd9f06d081'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM "spaces" s WHERE s."id" = "assets"."space_id"
  );
--> statement-breakpoint
CREATE INDEX "assets_space_fk_idx" ON "assets" USING btree ("space_id");
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_space_id_spaces_id_fk"
  FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id")
  ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_student_id_platform_users_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "public"."platform_users"("id")
  ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "turn_usage_budget_outcomes" ADD CONSTRAINT "turn_usage_budget_outcomes_operation_id_agent_operations_id_fk"
  FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id")
  ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "assets" VALIDATE CONSTRAINT "assets_space_id_spaces_id_fk";
--> statement-breakpoint
ALTER TABLE "lesson_sessions" VALIDATE CONSTRAINT "lesson_sessions_student_id_platform_users_id_fk";
--> statement-breakpoint
ALTER TABLE "turn_usage_budget_outcomes" VALIDATE CONSTRAINT "turn_usage_budget_outcomes_operation_id_agent_operations_id_fk";
