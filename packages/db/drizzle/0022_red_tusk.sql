CREATE TABLE "gateway_handoff_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_digest" text NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "gateway_handoff_tokens_digest_check" CHECK ("gateway_handoff_tokens"."token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "gateway_handoff_tokens_time_check" CHECK ("gateway_handoff_tokens"."expires_at" > "gateway_handoff_tokens"."issued_at" and ("gateway_handoff_tokens"."consumed_at" is null or "gateway_handoff_tokens"."consumed_at" >= "gateway_handoff_tokens"."issued_at"))
);
--> statement-breakpoint
ALTER TABLE "gateway_handoff_tokens" ADD CONSTRAINT "gateway_handoff_tokens_user_id_platform_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_handoff_tokens" ADD CONSTRAINT "gateway_handoff_tokens_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_handoff_tokens_digest_unique" ON "gateway_handoff_tokens" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "gateway_handoff_tokens_user_expiry_idx" ON "gateway_handoff_tokens" USING btree ("user_id","expires_at");