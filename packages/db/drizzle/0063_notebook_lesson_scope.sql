DROP INDEX "lesson_sessions_active_scope_unique";--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD COLUMN "notebook_id" uuid;--> statement-breakpoint
UPDATE "lesson_sessions" AS session SET "notebook_id" = conversation."space_id" FROM "conversations" AS conversation WHERE session."conversation_id" = conversation."id";--> statement-breakpoint

ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_notebook_id_spaces_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_conversation_notebook_fk" FOREIGN KEY ("conversation_id","notebook_id") REFERENCES "public"."conversations"("id","space_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_sessions_active_notebook_scope_unique" ON "lesson_sessions" USING btree ("notebook_id","student_id","grade_band","course_slug",coalesce("knowledge_node_id", '')) WHERE "lesson_sessions"."status" = 'active' and "lesson_sessions"."notebook_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_sessions_active_unbound_scope_unique" ON "lesson_sessions" USING btree ("student_id","grade_band","course_slug",coalesce("knowledge_node_id", '')) WHERE "lesson_sessions"."status" = 'active' and "lesson_sessions"."notebook_id" is null;--> statement-breakpoint
CREATE INDEX "lesson_sessions_notebook_fk_idx" ON "lesson_sessions" USING btree ("notebook_id");--> statement-breakpoint
ALTER TABLE "lesson_sessions" ADD CONSTRAINT "lesson_sessions_notebook_pair_check" CHECK (("lesson_sessions"."conversation_id" is null and "lesson_sessions"."notebook_id" is null) or ("lesson_sessions"."conversation_id" is not null and "lesson_sessions"."notebook_id" is not null));
--> statement-breakpoint
CREATE FUNCTION enforce_lesson_session_notebook_scope() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.notebook_id IS NOT NULL AND (NEW.notebook_id IS DISTINCT FROM OLD.notebook_id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id) THEN
    RAISE EXCEPTION 'lesson session notebook scope is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.conversation_id IS NOT NULL AND NEW.notebook_id IS NULL THEN
    SELECT space_id INTO NEW.notebook_id FROM conversations WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER lesson_sessions_notebook_scope BEFORE INSERT OR UPDATE ON lesson_sessions FOR EACH ROW EXECUTE FUNCTION enforce_lesson_session_notebook_scope();
