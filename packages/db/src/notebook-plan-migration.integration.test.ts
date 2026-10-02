import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { expect, it } from 'vitest';
import * as schema from './schema';
import {
  run,
  createTemporaryDatabase,
  migrationsFolder,
  priorBundle,
} from './notebook-plan.integration-support';

run('Notebook source plans N-1 migration', () => {
  it('upgrades 0061 without changing historic course, Goal, Session, or active Goal uniqueness', async () => {
    const fixture = await createTemporaryDatabase(
      'educanvas_20261002_plan_n1_integration',
    );
    const bundle = await priorBundle();
    const targetBundle = await priorBundle(62);
    try {
      await migrate(fixture.database, { migrationsFolder: bundle });
      const userId = 'plan:n1-owner';
      const notebookId = randomUUID();
      const conversationId = randomUUID();
      const sessionId = randomUUID();
      const goalId = randomUUID();
      await fixture.connection`insert into platform_users(id,kind) values (${userId},'registered')`;
      await fixture.connection`insert into spaces(id,owner_subject_id,kind,title) values (${notebookId},${userId},'course','Original course')`;
      await fixture.connection`insert into notebook_memberships(notebook_id,user_id,role,granted_by_user_id) values (${notebookId},${userId},'owner',${userId})`;
      await fixture.connection`insert into conversations(id,space_id,owner_subject_id,agent_profile_id,title) values (${conversationId},${notebookId},${userId},'k12.teacher','Original conversation')`;
      await fixture.connection`insert into lesson_sessions(id,conversation_id,student_id,grade_band,course_slug,knowledge_node_id,state) values (${sessionId},${conversationId},${userId},'middle_school','original','original-node','EXPLAIN')`;
      await fixture.connection`insert into learning_goals(id,notebook_id,student_id,course_slug,course_version,grade_band,topic,desired_outcome) values (${goalId},${notebookId},${userId},'original','1','middle_school','Original goal','Original outcome')`;
      const before =
        await fixture.connection`select row_to_json(s) as space,row_to_json(c) as conversation,row_to_json(l) as session,row_to_json(g) as goal from spaces s join conversations c on c.space_id=s.id join lesson_sessions l on l.conversation_id=c.id join learning_goals g on g.notebook_id=s.id where s.id=${notebookId}`;
      await migrate(fixture.database, { migrationsFolder: targetBundle });
      const after =
        await fixture.connection`select row_to_json(s) as space,row_to_json(c) as conversation,row_to_json(l) as session,row_to_json(g) as goal from spaces s join conversations c on c.space_id=s.id join lesson_sessions l on l.conversation_id=c.id join learning_goals g on g.notebook_id=s.id where s.id=${notebookId}`;
      expect(after).toEqual(before);
      expect(
        await fixture.database.select().from(schema.notebookPlans),
      ).toHaveLength(0);
      expect(
        await fixture.database.select().from(schema.notebookChapters),
      ).toHaveLength(0);
      await expect(
        fixture.connection`insert into learning_goals(notebook_id,student_id,course_slug,course_version,grade_band,topic,desired_outcome) values (${notebookId},${userId},'second','1','middle_school','Second','Second')`,
      ).rejects.toThrow();
    } finally {
      await rm(bundle, { recursive: true, force: true });
      await rm(targetBundle, { recursive: true, force: true });
      await fixture.dispose();
    }
  });
  it('upgrades 0062 to Notebook Session scope using only proven historical ownership', async () => {
    const fixture = await createTemporaryDatabase(
      'educanvas_20261002_plan_n1_integration',
    );
    const bundle = await priorBundle(62);
    try {
      await migrate(fixture.database, { migrationsFolder: bundle });
      const userId = 'plan:n1-scoped-owner';
      const notebookId = randomUUID();
      const conversationId = randomUUID();
      const sessionId = randomUUID();
      const unboundId = randomUUID();
      await fixture.connection`insert into platform_users(id,kind) values (${userId},'registered')`;
      await fixture.connection`insert into spaces(id,owner_subject_id,kind,title) values (${notebookId},${userId},'course','Historical course')`;
      await fixture.connection`insert into conversations(id,space_id,owner_subject_id,agent_profile_id,title) values (${conversationId},${notebookId},${userId},'k12.teacher','Historical conversation')`;
      await fixture.connection`insert into lesson_sessions(id,conversation_id,student_id,grade_band,course_slug,knowledge_node_id,state) values (${sessionId},${conversationId},${userId},'middle_school','historical','node','EXPLAIN')`;
      await fixture.connection`insert into lesson_sessions(id,student_id,grade_band,course_slug,knowledge_node_id,state) values (${unboundId},${userId},'middle_school','unbound','node','DIAGNOSE')`;
      await fixture.connection`insert into learning_goals(notebook_id,student_id,course_slug,course_version,grade_band,topic,desired_outcome) values (${notebookId},${userId},'historical','1','middle_school','Historical goal','Preserve')`;
      const beforeSessions =
        await fixture.connection`select to_jsonb(l) as session from lesson_sessions l order by id`;
      const beforeGoals =
        await fixture.connection`select to_jsonb(g) as goal from learning_goals g`;
      const beforeSpaces =
        await fixture.connection`select to_jsonb(s) as space from spaces s`;
      await migrate(fixture.database, { migrationsFolder });
      expect(
        await fixture.connection`select to_jsonb(l) - 'notebook_id' as session from lesson_sessions l order by id`,
      ).toEqual(beforeSessions);
      expect(
        await fixture.connection`select to_jsonb(g) as goal from learning_goals g`,
      ).toEqual(beforeGoals);
      expect(
        await fixture.connection`select to_jsonb(s) as space from spaces s`,
      ).toEqual(beforeSpaces);
      expect(
        (
          await fixture.connection`select notebook_id from lesson_sessions where id=${sessionId}`
        )[0]?.notebook_id,
      ).toBe(notebookId);
      expect(
        (
          await fixture.connection`select notebook_id from lesson_sessions where id=${unboundId}`
        )[0]?.notebook_id,
      ).toBeNull();
      await expect(
        fixture.connection`insert into lesson_sessions(conversation_id,student_id,grade_band,course_slug,knowledge_node_id,state) values (${conversationId},${userId},'middle_school','historical','node','DIAGNOSE')`,
      ).rejects.toThrow();
      await expect(
        fixture.connection`insert into lesson_sessions(student_id,grade_band,course_slug,knowledge_node_id,state) values (${userId},'middle_school','unbound','node','DIAGNOSE')`,
      ).rejects.toThrow();
      const otherNotebookId = randomUUID();
      const otherConversationId = randomUUID();
      await fixture.connection`insert into spaces(id,owner_subject_id,kind,title) values (${otherNotebookId},${userId},'course','Other course notebook')`;
      await fixture.connection`insert into conversations(id,space_id,owner_subject_id,agent_profile_id) values (${otherConversationId},${otherNotebookId},${userId},'k12.teacher')`;
      await fixture.connection`insert into lesson_sessions(conversation_id,student_id,grade_band,course_slug,knowledge_node_id,state) values (${otherConversationId},${userId},'middle_school','historical','node','DIAGNOSE')`;
      expect(
        (
          await fixture.connection`select notebook_id from lesson_sessions where conversation_id=${otherConversationId}`
        )[0]?.notebook_id,
      ).toBe(otherNotebookId);
      await expect(
        fixture.connection`insert into lesson_sessions(conversation_id,notebook_id,student_id,grade_band,course_slug,knowledge_node_id,state) values (${otherConversationId},${notebookId},${userId},'middle_school','other','node','DIAGNOSE')`,
      ).rejects.toThrow();
      await expect(
        fixture.connection`update lesson_sessions set conversation_id=${otherConversationId},notebook_id=${otherNotebookId} where id=${sessionId}`,
      ).rejects.toThrow();
    } finally {
      await rm(bundle, { recursive: true, force: true });
      await fixture.dispose();
    }
  });
});
