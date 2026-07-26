ALTER TABLE "artifact_versions" DROP CONSTRAINT "artifact_versions_generation_job_id_artifact_generation_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_messages" DROP CONSTRAINT "conversation_messages_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_conversation_notebook_fk" FOREIGN KEY ("conversation_id","notebook_id") REFERENCES "public"."conversations"("id","space_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_generation_job_scope_fk" FOREIGN KEY ("artifact_id","generation_job_id") REFERENCES "public"."artifact_generation_jobs"("artifact_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_operation_scope_fk" FOREIGN KEY ("conversation_id","operation_id") REFERENCES "public"."agent_operations"("conversation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_operations_conversation_id_unique" ON "agent_operations" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_generation_jobs_artifact_id_unique" ON "artifact_generation_jobs" USING btree ("artifact_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_id_space_unique" ON "conversations" USING btree ("id","space_id");