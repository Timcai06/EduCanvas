CREATE TABLE "artifact_confirmation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"user_message_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"notebook_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"artifact_kind" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"confirmed_kind" text,
	"confirmation_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_confirmation_requests_scope_check" CHECK (char_length("artifact_confirmation_requests"."notebook_id"::text) = 36 and char_length("artifact_confirmation_requests"."conversation_id"::text) = 36 and char_length("artifact_confirmation_requests"."actor_user_id") between 1 and 128),
	CONSTRAINT "artifact_confirmation_requests_kind_check" CHECK ("artifact_confirmation_requests"."artifact_kind" in ('markdown_document', 'mind_map', 'slides', 'flashcards', 'picturebook', 'note', 'web_app') and ("artifact_confirmation_requests"."confirmed_kind" is null or "artifact_confirmation_requests"."confirmed_kind" in ('markdown_document', 'mind_map', 'slides', 'flashcards', 'picturebook', 'note', 'web_app'))),
	CONSTRAINT "artifact_confirmation_requests_status_check" CHECK ("artifact_confirmation_requests"."status" in ('pending', 'confirmed', 'cancelled') and (("artifact_confirmation_requests"."status" = 'pending' and "artifact_confirmation_requests"."confirmed_kind" is null and "artifact_confirmation_requests"."confirmation_message_id" is null) or ("artifact_confirmation_requests"."status" = 'confirmed' and "artifact_confirmation_requests"."confirmed_kind" is not null and "artifact_confirmation_requests"."confirmation_message_id" is not null) or ("artifact_confirmation_requests"."status" = 'cancelled' and "artifact_confirmation_requests"."confirmed_kind" is null and "artifact_confirmation_requests"."confirmation_message_id" is null))),
	CONSTRAINT "artifact_confirmation_requests_title_check" CHECK (char_length(btrim("artifact_confirmation_requests"."title")) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "artifact_confirmation_requests" ADD CONSTRAINT "artifact_confirmation_requests_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_confirmation_requests" ADD CONSTRAINT "artifact_confirmation_requests_user_message_id_conversation_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_confirmation_requests" ADD CONSTRAINT "artifact_confirmation_requests_actor_user_id_platform_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_confirmation_requests" ADD CONSTRAINT "artifact_confirmation_requests_notebook_id_spaces_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_confirmation_requests" ADD CONSTRAINT "artifact_confirmation_requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_confirmation_requests" ADD CONSTRAINT "artifact_confirmation_requests_conversation_notebook_fk" FOREIGN KEY ("conversation_id","notebook_id") REFERENCES "public"."conversations"("id","space_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_confirmation_requests_operation_unique" ON "artifact_confirmation_requests" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "artifact_confirmation_requests_conversation_status_idx" ON "artifact_confirmation_requests" USING btree ("conversation_id","status","created_at");