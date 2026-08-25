ALTER TABLE "learner_profiles" DROP CONSTRAINT "learner_profiles_grade_band_check";--> statement-breakpoint
ALTER TABLE "learning_goals" DROP CONSTRAINT "learning_goals_grade_band_check";--> statement-breakpoint
UPDATE "learner_profiles" SET "default_grade_band" = 'primary_high' WHERE "default_grade_band" = 'primary_school';--> statement-breakpoint
UPDATE "learning_goals" SET "grade_band" = 'primary_high' WHERE "grade_band" = 'primary_school';--> statement-breakpoint
UPDATE "lesson_sessions" SET "grade_band" = 'primary_high' WHERE "grade_band" = 'primary_school';--> statement-breakpoint
ALTER TABLE "knowledge_sources" DISABLE TRIGGER "knowledge_sources_immutable_metadata";--> statement-breakpoint
UPDATE "knowledge_sources" SET "grade_band" = 'primary_high' WHERE "grade_band" = 'primary_school';--> statement-breakpoint
ALTER TABLE "knowledge_sources" ENABLE TRIGGER "knowledge_sources_immutable_metadata";--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_grade_band_check" CHECK ("learner_profiles"."default_grade_band" in ('primary_low', 'primary_high', 'middle_school', 'high_school'));--> statement-breakpoint
ALTER TABLE "learning_goals" ADD CONSTRAINT "learning_goals_grade_band_check" CHECK ("learning_goals"."grade_band" in ('primary_low', 'primary_high', 'middle_school', 'high_school'));
