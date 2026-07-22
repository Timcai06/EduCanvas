CREATE TABLE "mcp_tool_intents" (
	"resume_ref" text PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"tool_call_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"server_id" text NOT NULL,
	"remote_tool_name" text NOT NULL,
	"model_tool_name" text NOT NULL,
	"capability" text NOT NULL,
	"risk" text NOT NULL,
	"effect" text NOT NULL,
	"semantics_hash" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"key_version" text,
	"nonce" text,
	"ciphertext" text,
	"auth_tag" text,
	"payload_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatch_started_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "mcp_tool_intents_identity_check" CHECK ("mcp_tool_intents"."resume_ref" ~ '^mcp\.intent:[a-f0-9]{64}$' and char_length("mcp_tool_intents"."server_id") between 1 and 64 and char_length("mcp_tool_intents"."remote_tool_name") between 1 and 128 and char_length("mcp_tool_intents"."model_tool_name") between 1 and 64 and char_length("mcp_tool_intents"."capability") between 1 and 64),
	CONSTRAINT "mcp_tool_intents_policy_check" CHECK ("mcp_tool_intents"."risk" in ('l2', 'l3') and "mcp_tool_intents"."effect" = 'write' and "mcp_tool_intents"."capability" = 'external.mcp.invoke' and "mcp_tool_intents"."semantics_hash" ~ '^[a-f0-9]{64}$' and "mcp_tool_intents"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mcp_tool_intents_status_check" CHECK ("mcp_tool_intents"."status" in ('prepared', 'dispatching', 'completed', 'failed', 'outcome_unknown')),
	CONSTRAINT "mcp_tool_intents_cipher_check" CHECK ((("mcp_tool_intents"."status" = 'prepared' and "mcp_tool_intents"."key_version" = 'v1' and "mcp_tool_intents"."nonce" is not null and "mcp_tool_intents"."ciphertext" is not null and "mcp_tool_intents"."auth_tag" is not null) or ("mcp_tool_intents"."status" <> 'prepared' and "mcp_tool_intents"."key_version" is null and "mcp_tool_intents"."nonce" is null and "mcp_tool_intents"."ciphertext" is null and "mcp_tool_intents"."auth_tag" is null)) and ("mcp_tool_intents"."nonce" is null or char_length("mcp_tool_intents"."nonce") between 16 and 24) and ("mcp_tool_intents"."auth_tag" is null or char_length("mcp_tool_intents"."auth_tag") between 20 and 32) and ("mcp_tool_intents"."ciphertext" is null or char_length("mcp_tool_intents"."ciphertext") between 1 and 350000)),
	CONSTRAINT "mcp_tool_intents_lifecycle_check" CHECK (("mcp_tool_intents"."status" = 'prepared' and "mcp_tool_intents"."dispatch_started_at" is null and "mcp_tool_intents"."settled_at" is null) or ("mcp_tool_intents"."status" = 'dispatching' and "mcp_tool_intents"."dispatch_started_at" is not null and "mcp_tool_intents"."settled_at" is null) or ("mcp_tool_intents"."status" in ('completed', 'failed', 'outcome_unknown') and "mcp_tool_intents"."settled_at" is not null)),
	CONSTRAINT "mcp_tool_intents_time_check" CHECK ("mcp_tool_intents"."expires_at" > "mcp_tool_intents"."prepared_at" and ("mcp_tool_intents"."dispatch_started_at" is null or "mcp_tool_intents"."dispatch_started_at" >= "mcp_tool_intents"."prepared_at") and ("mcp_tool_intents"."settled_at" is null or "mcp_tool_intents"."settled_at" >= "mcp_tool_intents"."prepared_at"))
);
--> statement-breakpoint
ALTER TABLE "mcp_tool_intents" ADD CONSTRAINT "mcp_tool_intents_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_intents" ADD CONSTRAINT "mcp_tool_intents_tool_call_id_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_intents" ADD CONSTRAINT "mcp_tool_intents_actor_user_id_platform_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_intents" ADD CONSTRAINT "mcp_tool_intents_agent_id_personal_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."personal_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tool_intents_tool_call_unique" ON "mcp_tool_intents" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "mcp_tool_intents_status_expiry_idx" ON "mcp_tool_intents" USING btree ("status","expires_at","prepared_at");
