ALTER TABLE "agent_message_parts" DROP CONSTRAINT "agent_message_parts_shape_check";--> statement-breakpoint
ALTER TABLE "agent_operations" DROP CONSTRAINT "agent_operations_kind_check";--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" DROP CONSTRAINT "asset_processing_jobs_kind_check";--> statement-breakpoint
ALTER TABLE "asset_representations" DROP CONSTRAINT "asset_representations_kind_check";--> statement-breakpoint
ALTER TABLE "asset_versions" DROP CONSTRAINT "asset_versions_kind_check";--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_kind_check";--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_origin_check";--> statement-breakpoint
ALTER TABLE "gateway_node_invocations" DROP CONSTRAINT "gateway_node_invocations_capability_check";--> statement-breakpoint
ALTER TABLE "knowledge_sources" DROP CONSTRAINT "knowledge_sources_type_check";--> statement-breakpoint
ALTER TABLE "object_deletion_outbox" DROP CONSTRAINT "object_deletion_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "object_deletion_outbox" DROP CONSTRAINT "object_deletion_outbox_source_check";--> statement-breakpoint
ALTER TABLE "operation_sources" DROP CONSTRAINT "operation_sources_kind_check";--> statement-breakpoint
ALTER TABLE "tool_effect_reconciliations" DROP CONSTRAINT "tool_effect_reconciliations_source_check";--> statement-breakpoint
ALTER TABLE "agent_message_parts" ADD CONSTRAINT "agent_message_parts_shape_check" CHECK (("agent_message_parts"."part_type" = 'text' and "agent_message_parts"."text_content" is not null and "agent_message_parts"."asset_id" is null and "agent_message_parts"."asset_version_id" is null and "agent_message_parts"."asset_usage" is null and "agent_message_parts"."artifact_id" is null and "agent_message_parts"."artifact_version_id" is null and "agent_message_parts"."artifact_kind" is null) or ("agent_message_parts"."part_type" = 'asset_ref' and "agent_message_parts"."text_content" is null and "agent_message_parts"."asset_id" is not null and "agent_message_parts"."asset_version_id" is not null and "agent_message_parts"."asset_usage" in ('attachment', 'context') and "agent_message_parts"."artifact_id" is null and "agent_message_parts"."artifact_version_id" is null and "agent_message_parts"."artifact_kind" is null) or ("agent_message_parts"."part_type" = 'artifact_ref' and "agent_message_parts"."text_content" is null and "agent_message_parts"."asset_id" is null and "agent_message_parts"."asset_version_id" is null and "agent_message_parts"."asset_usage" is null and "agent_message_parts"."artifact_id" is not null and "agent_message_parts"."artifact_version_id" is not null and "agent_message_parts"."artifact_kind" ~ '^[a-z][a-z0-9_]{0,63}$'));--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_kind_check" CHECK ("agent_operations"."kind" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "asset_processing_jobs" ADD CONSTRAINT "asset_processing_jobs_kind_check" CHECK ("asset_processing_jobs"."kind" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "asset_representations" ADD CONSTRAINT "asset_representations_kind_check" CHECK ("asset_representations"."kind" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_kind_check" CHECK ("asset_versions"."kind" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_kind_check" CHECK ("assets"."kind" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_origin_check" CHECK ("assets"."origin" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "gateway_node_invocations" ADD CONSTRAINT "gateway_node_invocations_capability_check" CHECK ("gateway_node_invocations"."capability" ~ '^[a-z][a-z0-9._]{0,63}$');--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_type_check" CHECK ("knowledge_sources"."source_type" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "object_deletion_outbox" ADD CONSTRAINT "object_deletion_outbox_kind_check" CHECK ("object_deletion_outbox"."object_kind" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "object_deletion_outbox" ADD CONSTRAINT "object_deletion_outbox_source_check" CHECK ("object_deletion_outbox"."source_type" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "operation_sources" ADD CONSTRAINT "operation_sources_kind_check" CHECK ("operation_sources"."kind" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "tool_effect_reconciliations" ADD CONSTRAINT "tool_effect_reconciliations_source_check" CHECK ("tool_effect_reconciliations"."source" ~ '^[a-z][a-z0-9_]{0,63}$');