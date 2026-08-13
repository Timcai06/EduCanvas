CREATE TABLE "k12_conversation_message_projections" (
	"source_chat_message_id" uuid PRIMARY KEY NOT NULL,
	"conversation_message_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "k12_conversation_message_projections_conversation_message_id_unique" UNIQUE("conversation_message_id")
);
--> statement-breakpoint
CREATE INDEX "k12_conversation_message_projections_session_idx" ON "k12_conversation_message_projections" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "k12_conversation_message_projections_conversation_idx" ON "k12_conversation_message_projections" USING btree ("conversation_id");