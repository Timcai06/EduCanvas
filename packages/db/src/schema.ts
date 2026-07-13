import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// 阶段一最小表集（doc/04-data/data-design.md 的子集）。
// users/courses 等完整实体在阶段二引入，当前 studentId 先用匿名标识。

/** 一次学习会话：一个学生在一门课程上的一次连续学习过程 */
export const lessonSessions = pgTable('lesson_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: text('student_id').notNull(),
  gradeBand: text('grade_band').notNull(), // primary | junior | senior
  courseSlug: text('course_slug').notNull(), // 阶段一固定为 cat-vs-dog
  state: text('state').notNull().default('EXPLAIN'), // 教学状态机当前状态
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 会话中产生的 Canvas Artifact，params 为已通过白名单校验的参数 */
export const canvasArtifacts = pgTable('canvas_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => lessonSessions.id),
  artifactId: text('artifact_id').notNull(),
  type: text('type').notNull(),
  schemaVersion: text('schema_version').notNull(),
  title: text('title').notNull(),
  params: jsonb('params').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 学习事件，只追加，不更新不删除 */
export const learningEvents = pgTable('learning_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: text('student_id').notNull(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => lessonSessions.id),
  knowledgeNodeId: text('knowledge_node_id'),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  schemaVersion: text('schema_version').notNull().default('1'),
});

/** 掌握度：结构化字段，不由模型凭感觉决定（doc/04-data/data-design.md） */
export const masteryStates = pgTable(
  'mastery_states',
  {
    studentId: text('student_id').notNull(),
    knowledgeNodeId: text('knowledge_node_id').notNull(),
    masteryScore: real('mastery_score').notNull().default(0),
    attemptCount: integer('attempt_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    hintCount: integer('hint_count').notNull().default(0),
    misconceptionTags: jsonb('misconception_tags').notNull().default([]),
    lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true }),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.studentId, table.knowledgeNodeId] })],
);
