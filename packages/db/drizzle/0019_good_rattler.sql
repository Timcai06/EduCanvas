CREATE TABLE "delegated_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"grantee_user_id" text NOT NULL,
	"subject_user_id" text NOT NULL,
	"notebook_id" uuid,
	"scopes" text[] NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "delegated_grants_kind_check" CHECK ("delegated_grants"."kind" in ('education.teacher', 'education.guardian', 'platform.operator')),
	CONSTRAINT "delegated_grants_time_check" CHECK ("delegated_grants"."expires_at" > "delegated_grants"."granted_at" and ("delegated_grants"."revoked_at" is null or "delegated_grants"."revoked_at" >= "delegated_grants"."granted_at")),
	CONSTRAINT "delegated_grants_scopes_check" CHECK (cardinality("delegated_grants"."scopes") between 1 and 16)
);
--> statement-breakpoint
CREATE TABLE "gateway_channel_account_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adapter_id" text NOT NULL,
	"external_account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "gateway_channel_account_status_check" CHECK ("gateway_channel_account_bindings"."status" in ('pending', 'active', 'revoked')),
	CONSTRAINT "gateway_channel_account_text_check" CHECK (char_length("gateway_channel_account_bindings"."adapter_id") between 1 and 160 and char_length("gateway_channel_account_bindings"."external_account_id") between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "gateway_channel_thread_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_binding_id" uuid NOT NULL,
	"external_thread_id" text NOT NULL,
	"thread_kind" text NOT NULL,
	"notebook_id" uuid NOT NULL,
	"conversation_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "gateway_channel_thread_kind_check" CHECK ("gateway_channel_thread_bindings"."thread_kind" in ('private', 'group')),
	CONSTRAINT "gateway_channel_thread_status_check" CHECK ("gateway_channel_thread_bindings"."status" in ('pending', 'active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "gateway_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"envelope_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"external_message_id" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_deliveries_status_check" CHECK ("gateway_deliveries"."status" in ('pending', 'sent', 'acknowledged', 'failed', 'expired')),
	CONSTRAINT "gateway_deliveries_shape_check" CHECK ("gateway_deliveries"."attempt" between 1 and 100 and jsonb_typeof("gateway_deliveries"."target") = 'object' and (("gateway_deliveries"."status" = 'failed' and "gateway_deliveries"."failure_code" is not null) or ("gateway_deliveries"."status" <> 'failed' and "gateway_deliveries"."failure_code" is null)))
);
--> statement-breakpoint
CREATE TABLE "gateway_node_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"device_public_key" text NOT NULL,
	"approved_capabilities" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "gateway_node_pairings_status_check" CHECK ("gateway_node_pairings"."status" in ('pending', 'active', 'offline', 'revoked')),
	CONSTRAINT "gateway_node_pairings_text_check" CHECK (char_length("gateway_node_pairings"."display_name") between 1 and 120 and char_length("gateway_node_pairings"."device_public_key") between 32 and 8192),
	CONSTRAINT "gateway_node_pairings_capabilities_check" CHECK (jsonb_typeof("gateway_node_pairings"."approved_capabilities") = 'object')
);
--> statement-breakpoint
CREATE TABLE "gateway_operation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_operation_events_sequence_check" CHECK ("gateway_operation_events"."sequence" >= 0),
	CONSTRAINT "gateway_operation_events_payload_check" CHECK (jsonb_typeof("gateway_operation_events"."payload") = 'object' and "gateway_operation_events"."payload"->>'type' = "gateway_operation_events"."type")
);
--> statement-breakpoint
CREATE TABLE "notebook_memberships" (
	"notebook_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "notebook_memberships_notebook_id_user_id_pk" PRIMARY KEY("notebook_id","user_id"),
	CONSTRAINT "notebook_memberships_role_check" CHECK ("notebook_memberships"."role" in ('owner', 'editor', 'contributor', 'viewer')),
	CONSTRAINT "notebook_memberships_time_check" CHECK (("notebook_memberships"."expires_at" is null or "notebook_memberships"."expires_at" > "notebook_memberships"."granted_at") and ("notebook_memberships"."revoked_at" is null or "notebook_memberships"."revoked_at" >= "notebook_memberships"."granted_at"))
);
--> statement-breakpoint
CREATE TABLE "personal_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_agents_status_check" CHECK ("personal_agents"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "platform_users" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_users_id_check" CHECK (char_length("platform_users"."id") between 1 and 160),
	CONSTRAINT "platform_users_kind_check" CHECK ("platform_users"."kind" in ('registered', 'anonymous_compat')),
	CONSTRAINT "platform_users_status_check" CHECK ("platform_users"."status" in ('active', 'suspended', 'deleted'))
);
--> statement-breakpoint
DROP INDEX "agent_operations_conversation_idempotency_unique";--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN "gateway_envelope_id" text;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN "actor_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN "notebook_id" uuid;--> statement-breakpoint
INSERT INTO "platform_users" ("id", "kind", "status", "created_at", "updated_at")
SELECT "subject_id",
       CASE WHEN "subject_id" LIKE 'anon:v1:%' THEN 'anonymous_compat' ELSE 'registered' END,
       'active',
       now(),
       now()
FROM (
  SELECT "owner_subject_id" AS "subject_id" FROM "spaces"
  UNION
  SELECT "owner_subject_id" AS "subject_id" FROM "conversations"
  UNION
  SELECT "owner_subject_id" AS "subject_id" FROM "assets"
  UNION
  SELECT "student_id" AS "subject_id" FROM "lesson_sessions"
) AS "existing_subjects"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "personal_agents" ("user_id", "status", "created_at", "updated_at")
SELECT "id", 'active', now(), now()
FROM "platform_users"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "notebook_memberships" (
  "notebook_id",
  "user_id",
  "role",
  "granted_by_user_id",
  "granted_at"
)
SELECT "id", "owner_subject_id", 'owner', "owner_subject_id", "created_at"
FROM "spaces"
ON CONFLICT ("notebook_id", "user_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "delegated_grants" ADD CONSTRAINT "delegated_grants_grantee_user_id_platform_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_grants" ADD CONSTRAINT "delegated_grants_subject_user_id_platform_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_grants" ADD CONSTRAINT "delegated_grants_notebook_id_spaces_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_grants" ADD CONSTRAINT "delegated_grants_granted_by_user_id_platform_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_channel_account_bindings" ADD CONSTRAINT "gateway_channel_account_bindings_user_id_platform_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_channel_account_bindings" ADD CONSTRAINT "gateway_channel_account_bindings_agent_id_personal_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."personal_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_channel_thread_bindings" ADD CONSTRAINT "gateway_channel_thread_bindings_account_binding_id_gateway_channel_account_bindings_id_fk" FOREIGN KEY ("account_binding_id") REFERENCES "public"."gateway_channel_account_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_channel_thread_bindings" ADD CONSTRAINT "gateway_channel_thread_bindings_notebook_id_spaces_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_channel_thread_bindings" ADD CONSTRAINT "gateway_channel_thread_bindings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_deliveries" ADD CONSTRAINT "gateway_deliveries_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_node_pairings" ADD CONSTRAINT "gateway_node_pairings_user_id_platform_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_node_pairings" ADD CONSTRAINT "gateway_node_pairings_agent_id_personal_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."personal_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_operation_events" ADD CONSTRAINT "gateway_operation_events_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_memberships" ADD CONSTRAINT "notebook_memberships_notebook_id_spaces_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_memberships" ADD CONSTRAINT "notebook_memberships_user_id_platform_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_memberships" ADD CONSTRAINT "notebook_memberships_granted_by_user_id_platform_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_agents" ADD CONSTRAINT "personal_agents_user_id_platform_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delegated_grants_grantee_active_idx" ON "delegated_grants" USING btree ("grantee_user_id","expires_at","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_channel_account_external_unique" ON "gateway_channel_account_bindings" USING btree ("adapter_id","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_channel_thread_external_unique" ON "gateway_channel_thread_bindings" USING btree ("account_binding_id","external_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_deliveries_envelope_target_unique" ON "gateway_deliveries" USING btree ("envelope_id","target_kind");--> statement-breakpoint
CREATE INDEX "gateway_deliveries_operation_status_idx" ON "gateway_deliveries" USING btree ("operation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_node_pairings_node_unique" ON "gateway_node_pairings" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "gateway_node_pairings_user_status_idx" ON "gateway_node_pairings" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_operation_events_sequence_unique" ON "gateway_operation_events" USING btree ("operation_id","sequence");--> statement-breakpoint
CREATE INDEX "gateway_operation_events_resume_idx" ON "gateway_operation_events" USING btree ("operation_id","sequence");--> statement-breakpoint
CREATE INDEX "notebook_memberships_user_active_idx" ON "notebook_memberships" USING btree ("user_id","revoked_at","notebook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_agents_user_unique" ON "personal_agents" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_actor_user_id_platform_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_agent_id_personal_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."personal_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_notebook_id_spaces_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_operations_actor_conversation_idempotency_unique" ON "agent_operations" USING btree ("conversation_id",coalesce("actor_user_id", ''),"idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_operations_gateway_envelope_unique" ON "agent_operations" USING btree ("gateway_envelope_id") WHERE "agent_operations"."gateway_envelope_id" is not null;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_gateway_shape_check" CHECK (("agent_operations"."gateway_envelope_id" is null and "agent_operations"."request_fingerprint" is null and "agent_operations"."actor_user_id" is null and "agent_operations"."agent_id" is null and "agent_operations"."notebook_id" is null) or ("agent_operations"."gateway_envelope_id" is not null and char_length("agent_operations"."gateway_envelope_id") between 1 and 160 and "agent_operations"."request_fingerprint" ~ '^[a-f0-9]{64}$' and "agent_operations"."actor_user_id" is not null and "agent_operations"."agent_id" is not null and "agent_operations"."notebook_id" is not null));
