CREATE TABLE "web_runtime_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"runtime_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"artifact_content_hash" text NOT NULL,
	"requester_subject_id" text NOT NULL,
	"bootstrap_token_hash" text,
	"bootstrap_expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"terminal_authority" text DEFAULT 'client_observed' NOT NULL,
	"failure_code" text,
	"bootstrap_claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_runtime_runs_hash_check" CHECK ("web_runtime_runs"."artifact_content_hash" ~ '^[a-f0-9]{64}$' and ("web_runtime_runs"."bootstrap_token_hash" is null or "web_runtime_runs"."bootstrap_token_hash" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "web_runtime_runs_status_check" CHECK ("web_runtime_runs"."status" in ('running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "web_runtime_runs_authority_check" CHECK ("web_runtime_runs"."terminal_authority" = 'client_observed'),
	CONSTRAINT "web_runtime_runs_terminal_check" CHECK (("web_runtime_runs"."status" = 'running' and "web_runtime_runs"."completed_at" is null and "web_runtime_runs"."failure_code" is null) or ("web_runtime_runs"."status" = 'succeeded' and "web_runtime_runs"."completed_at" is not null and "web_runtime_runs"."failure_code" is null) or ("web_runtime_runs"."status" = 'cancelled' and "web_runtime_runs"."completed_at" is not null and "web_runtime_runs"."failure_code" is null) or ("web_runtime_runs"."status" = 'failed' and "web_runtime_runs"."completed_at" is not null and "web_runtime_runs"."failure_code" in ('runtime_timeout', 'runtime_crashed', 'resource_quota_exceeded', 'execution_failed', 'cancel_race_rejected')))
);
--> statement-breakpoint
ALTER TABLE "web_runtime_runs" ADD CONSTRAINT "web_runtime_runs_notebook_id_spaces_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_runtime_runs" ADD CONSTRAINT "web_runtime_runs_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_runtime_runs" ADD CONSTRAINT "web_runtime_runs_requester_subject_id_platform_users_id_fk" FOREIGN KEY ("requester_subject_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_runtime_runs" ADD CONSTRAINT "web_runtime_runs_artifact_version_scope_fk" FOREIGN KEY ("artifact_version_id","artifact_id") REFERENCES "public"."artifact_versions"("id","artifact_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "web_runtime_runs_request_unique" ON "web_runtime_runs" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "web_runtime_runs_runtime_unique" ON "web_runtime_runs" USING btree ("runtime_id");--> statement-breakpoint
CREATE INDEX "web_runtime_runs_notebook_created_idx" ON "web_runtime_runs" USING btree ("notebook_id","created_at","id");--> statement-breakpoint
CREATE INDEX "web_runtime_runs_requester_created_idx" ON "web_runtime_runs" USING btree ("requester_subject_id","created_at","id");--> statement-breakpoint
CREATE INDEX "web_runtime_runs_artifact_version_fk_idx" ON "web_runtime_runs" USING btree ("artifact_version_id","artifact_id");--> statement-breakpoint
CREATE INDEX "web_runtime_runs_artifact_fk_idx" ON "web_runtime_runs" USING btree ("artifact_id");