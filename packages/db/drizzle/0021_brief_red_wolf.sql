CREATE TABLE "gateway_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"capability" text NOT NULL,
	"risk" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "gateway_approvals_risk_check" CHECK ("gateway_approvals"."risk" in ('l2', 'l3')),
	CONSTRAINT "gateway_approvals_status_check" CHECK ("gateway_approvals"."status" in ('pending', 'approved', 'denied', 'expired', 'revoked')),
	CONSTRAINT "gateway_approvals_time_check" CHECK ("gateway_approvals"."expires_at" > "gateway_approvals"."requested_at"),
	CONSTRAINT "gateway_approvals_decision_check" CHECK (("gateway_approvals"."status" = 'pending' and "gateway_approvals"."decided_by_user_id" is null and "gateway_approvals"."decided_at" is null) or ("gateway_approvals"."status" <> 'pending' and "gateway_approvals"."decided_by_user_id" is not null and "gateway_approvals"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "gateway_approvals" ADD CONSTRAINT "gateway_approvals_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_approvals" ADD CONSTRAINT "gateway_approvals_actor_user_id_platform_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_approvals" ADD CONSTRAINT "gateway_approvals_decided_by_user_id_platform_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_approvals_actor_status_idx" ON "gateway_approvals" USING btree ("actor_user_id","status","expires_at");