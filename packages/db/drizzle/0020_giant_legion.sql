CREATE TABLE "gateway_node_invocations" (
	"request_id" text PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"nonce" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"result" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_node_invocations_capability_check" CHECK ("gateway_node_invocations"."capability" in ('device.status', 'filesystem.read_allowlisted')),
	CONSTRAINT "gateway_node_invocations_status_check" CHECK ("gateway_node_invocations"."status" in ('pending', 'completed', 'failed', 'rejected', 'expired')),
	CONSTRAINT "gateway_node_invocations_time_check" CHECK ("gateway_node_invocations"."expires_at" > "gateway_node_invocations"."issued_at")
);
--> statement-breakpoint
ALTER TABLE "gateway_node_invocations" ADD CONSTRAINT "gateway_node_invocations_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_node_invocations" ADD CONSTRAINT "gateway_node_invocations_node_fk" FOREIGN KEY ("node_id") REFERENCES "public"."gateway_node_pairings"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_node_invocations_node_nonce_unique" ON "gateway_node_invocations" USING btree ("node_id","nonce");--> statement-breakpoint
CREATE INDEX "gateway_node_invocations_poll_idx" ON "gateway_node_invocations" USING btree ("node_id","status","issued_at");