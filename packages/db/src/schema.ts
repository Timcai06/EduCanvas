import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// 阶段一最小表集（docs/04-data/data-design.md 的子集）。
// users/courses 等完整实体在阶段二引入，当前 studentId 先用匿名标识。

/**
 * 教学状态机和审计的会话边界。阶段一尚未引入 users/courses 表，因此学生、年级和课程先用外部稳定标识；
 * 状态保留为 text 以允许状态机在早期演进而不频繁改枚举，取舍见 ADR-0003 与 docs/04-data/data-design.md。
 */
export const lessonSessions = pgTable('lesson_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: text('student_id').notNull(),
  // 年级段和课程目录尚在迭代，阶段一用 text 接受稳定外部标识，待正式实体表落地后再加外键。
  gradeBand: text('grade_band').notNull(),
  courseSlug: text('course_slug').notNull(),
  knowledgeNodeId: text('knowledge_node_id'),
  // 状态机仍处早期演进期，text 避免每次新增教学分支都先修改数据库枚举。
  // 不设默认值：初始状态必须由 runtime 显式决定（新学生 DIAGNOSE、有掌握记录可直入 EXPLAIN），
  // 让"跳过诊断"成为显式决策而非默认值副作用，见 ADR-0004。
  state: text('state').notNull(),
  interruptedState: text('interrupted_state'),
  // 可信事件序号通过原子UPDATE递增，不与会话状态version共用锁。
  eventSequence: integer('event_sequence').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 保存已经白名单校验的 Artifact 快照，供学习过程回放、问题审计和协议兼容使用。
 * `params` 使用 JSONB 是因为不同 Artifact 的联合参数结构不同，但写入前仍必须通过 canvas-protocol；见 ADR-0002。
 */
export const canvasArtifacts = pgTable(
  'canvas_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id),
    artifactId: text('artifact_id').notNull(),
    type: text('type').notNull(),
    schemaVersion: text('schema_version').notNull(),
    title: text('title').notNull(),
    // 这里只保存浏览器安全投影；答案必须进入canvas_artifact_grading_keys。
    params: jsonb('params').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('canvas_artifacts_session_artifact_unique').on(
      table.sessionId,
      table.artifactId,
    ),
  ],
);

/**
 * 与公开Canvas快照物理分离的私有判分键。Web页面和客户端注册表不得查询此表；
 * 只有服务端判分器可以按artifact记录主键读取并产生可信assessment_graded事件。
 */
export const canvasArtifactGradingKeys = pgTable(
  'canvas_artifact_grading_keys',
  {
    artifactRecordId: uuid('artifact_record_id')
      .primaryKey()
      .references(() => canvasArtifacts.id, { onDelete: 'cascade' }),
    gradingKey: jsonb('grading_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/**
 * 只追加的学习事实流，作为掌握度重算和教学决策的可追溯输入；业务代码不得原地改写历史事件。
 * `occurredAt` 不设数据库默认值，以保存客户端实际发生时间；`payload` 用 JSONB 承载事件专属字段，
 * `schemaVersion` 用于消费端兼容演进，口径见 docs/04-data/data-design.md。
 */
export const learningEvents = pgTable(
  'learning_events',
  {
    // 直接保存领域事件eventId，避免数据库ID与事件信封出现双重身份。
    id: uuid('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    studentId: text('student_id').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id),
    knowledgeNodeId: text('knowledge_node_id'),
    sequence: integer('sequence').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    source: text('source').notNull(),
    schemaVersion: text('schema_version').notNull(),
    causationId: text('causation_id').notNull(),
  },
  (table) => [
    uniqueIndex('learning_events_idempotency_key_unique').on(
      table.idempotencyKey,
    ),
    uniqueIndex('learning_events_session_sequence_unique').on(
      table.sessionId,
      table.sequence,
    ),
  ],
);

/**
 * 每个“学生 × 知识节点”只有一行可计算掌握状态，复合主键防止同一口径出现多份当前值。
 * 分数用 real 支持连续更新，次数字段保留可解释证据，JSONB 标签允许误区分类逐步扩展；
 * `version` 为并发更新的乐观锁预留，模型不得直接决定这些值，见 docs/04-data/data-design.md。
 */
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
  (table) => [
    primaryKey({ columns: [table.studentId, table.knowledgeNodeId] }),
  ],
);
