-- 外键支撑索引审计（docs/04-data/fk-index-audit.md）。
--
-- 先删除 4 条与既有唯一索引列序完全相同或构成其左前缀的重复索引，再为 25 个
-- 「父表确实存在生产删除路径且子表无任何以外键列开头的索引」的关系补索引。
-- 判定依据是真实删除路径 + EXPLAIN，不按「字段看起来常用」批量添加。
--
-- 生产锁风险：`CREATE INDEX` 会持有 ShareLock 阻塞子表写入。当前各表规模下
-- 该窗口可以忽略；若某个部署的 model_runs / conversation_messages 已达千万级，
-- 应先在迁移窗口外用 `CREATE INDEX CONCURRENTLY` 建同名索引，再应用本迁移
-- （重名索引已存在时需先跳过对应语句）。迁移器在事务内运行，无法直接使用
-- CONCURRENTLY。
DROP INDEX "conversation_message_citations_message_idx";--> statement-breakpoint
DROP INDEX "gateway_operation_events_resume_idx";--> statement-breakpoint
DROP INDEX "notebook_asset_bindings_latest_idx";--> statement-breakpoint
DROP INDEX "session_source_bindings_latest_idx";--> statement-breakpoint
CREATE INDEX "agent_message_parts_asset_fk_idx" ON "agent_message_parts" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "agent_operations_notebook_fk_idx" ON "agent_operations" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "artifact_generation_jobs_operation_fk_idx" ON "artifact_generation_jobs" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "artifact_versions_created_by_operation_fk_idx" ON "artifact_versions" USING btree ("created_by_operation_id");--> statement-breakpoint
CREATE INDEX "assets_current_version_fk_idx" ON "assets" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "canvas_artifacts_platform_artifact_fk_idx" ON "canvas_artifacts" USING btree ("platform_artifact_id");--> statement-breakpoint
CREATE INDEX "conversation_message_citations_source_fk_idx" ON "conversation_message_citations" USING btree ("operation_source_id");--> statement-breakpoint
CREATE INDEX "delegated_grants_notebook_fk_idx" ON "delegated_grants" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "gateway_approvals_operation_fk_idx" ON "gateway_approvals" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "gateway_channel_thread_bindings_conversation_fk_idx" ON "gateway_channel_thread_bindings" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "gateway_channel_thread_bindings_notebook_fk_idx" ON "gateway_channel_thread_bindings" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "gateway_handoff_tokens_conversation_fk_idx" ON "gateway_handoff_tokens" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "gateway_node_invocations_operation_fk_idx" ON "gateway_node_invocations" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "lesson_sessions_conversation_fk_idx" ON "lesson_sessions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "message_citations_candidate_fk_idx" ON "message_citations" USING btree ("retrieval_candidate_id");--> statement-breakpoint
CREATE INDEX "model_runs_assistant_message_fk_idx" ON "model_runs" USING btree ("assistant_message_id");--> statement-breakpoint
CREATE INDEX "model_runs_conversation_message_fk_idx" ON "model_runs" USING btree ("conversation_message_id");--> statement-breakpoint
CREATE INDEX "notebook_asset_bindings_asset_fk_idx" ON "notebook_asset_bindings" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "retrieval_candidates_snapshot_fk_idx" ON "retrieval_candidates" USING btree ("turn_source_version_id");--> statement-breakpoint
CREATE INDEX "tool_approval_intents_operation_fk_idx" ON "tool_approval_intents" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "turn_context_snapshots_operation_fk_idx" ON "turn_context_snapshots" USING btree ("agent_operation_id");--> statement-breakpoint
CREATE INDEX "diagnostic_attempts_session_fk_idx" ON "diagnostic_attempts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "diagnostic_responses_objective_fk_idx" ON "diagnostic_responses" USING btree ("objective_id");--> statement-breakpoint
CREATE INDEX "learning_goals_notebook_fk_idx" ON "learning_goals" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "mcp_tool_intents_operation_fk_idx" ON "mcp_tool_intents" USING btree ("operation_id");