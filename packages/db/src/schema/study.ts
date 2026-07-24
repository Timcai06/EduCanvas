import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { lessonSessions, platformUsers, spaces } from '../schema';

/**
 * 学习者明确声明的最小画像。只保存年龄段、默认年级和有限教学偏好，
 * 不保存出生日期、生物特征、人格或模型推断标签。
 */
export const learnerProfiles = pgTable(
  'learner_profiles',
  {
    studentId: text('student_id')
      .primaryKey()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    ageBand: text('age_band').notNull(),
    defaultGradeBand: text('default_grade_band').notNull(),
    declarationSource: text('declaration_source').notNull(),
    declaredByUserId: text('declared_by_user_id')
      .notNull()
      // 声明人被删除时画像失去可审计来源，整行删除比留下孤立声明更安全。
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    preferences: jsonb('preferences').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'learner_profiles_age_band_check',
      sql`${table.ageBand} in ('under_13', '13_to_15', '16_to_17', 'adult', 'unknown')`,
    ),
    check(
      'learner_profiles_grade_band_check',
      sql`${table.defaultGradeBand} in ('primary_school', 'middle_school', 'high_school')`,
    ),
    check(
      'learner_profiles_source_check',
      sql`${table.declarationSource} in ('self_declared', 'guardian_declared', 'school_asserted')`,
    ),
    check(
      'learner_profiles_shape_check',
      sql`jsonb_typeof(${table.preferences}) = 'object'
        and ${table.preferences} ?& array['explanationOrder', 'responseDepth', 'guidance', 'modality', 'feedbackStyle']::text[]
        and ${table.preferences} - array['explanationOrder', 'responseDepth', 'guidance', 'modality', 'feedbackStyle']::text[] = '{}'::jsonb
        and ${table.preferences}->>'explanationOrder' in ('example_first', 'concept_first')
        and ${table.preferences}->>'responseDepth' in ('concise', 'balanced', 'detailed')
        and ${table.preferences}->>'guidance' in ('step_by_step', 'independent_first')
        and ${table.preferences}->>'modality' in ('visual', 'text', 'practice', 'mixed')
        and ${table.preferences}->>'feedbackStyle' in ('gentle', 'direct', 'balanced')
        and ${table.version} >= 1`,
    ),
  ],
);

/**
 * Notebook 当前结构化学习目标。课程目录版本与用户目标文本一起冻结，
 * 防止后续目录更新静默改写已经完成的诊断。
 */
export const learningGoals = pgTable(
  'learning_goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notebookId: uuid('notebook_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    courseSlug: text('course_slug').notNull(),
    courseVersion: text('course_version').notNull(),
    gradeBand: text('grade_band').notNull(),
    topic: text('topic').notNull(),
    desiredOutcome: text('desired_outcome').notNull(),
    status: text('status').notNull().default('active'),
    version: integer('version').notNull().default(1),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('learning_goals_notebook_active_unique')
      .on(table.notebookId)
      .where(sql`${table.status} = 'active'`),
    index('learning_goals_student_recent_idx').on(
      table.studentId,
      table.status,
      table.updatedAt,
      table.id,
    ),
    check(
      'learning_goals_grade_band_check',
      sql`${table.gradeBand} in ('primary_school', 'middle_school', 'high_school')`,
    ),
    check(
      'learning_goals_status_check',
      sql`${table.status} in ('active', 'completed', 'archived')`,
    ),
    check(
      'learning_goals_text_check',
      sql`char_length(${table.courseSlug}) between 1 and 128 and char_length(${table.courseVersion}) between 1 and 64 and char_length(${table.topic}) between 1 and 120 and char_length(${table.desiredOutcome}) between 1 and 500`,
    ),
    check(
      'learning_goals_lifecycle_check',
      sql`(${table.status} = 'active' and ${table.completedAt} is null and ${table.archivedAt} is null) or (${table.status} = 'completed' and ${table.completedAt} is not null and ${table.archivedAt} is null) or (${table.status} = 'archived' and ${table.archivedAt} is not null)`,
    ),
    check('learning_goals_version_check', sql`${table.version} >= 1`),
  ],
);

/** 学习目标图的不可漂移节点；先修只引用同一 Goal 内的稳定 objective key。 */
export const learningObjectives = pgTable(
  'learning_objectives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => learningGoals.id, { onDelete: 'cascade' }),
    objectiveKey: text('objective_key').notNull(),
    knowledgeNodeId: text('knowledge_node_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    sequence: integer('sequence').notNull(),
    prerequisiteObjectiveKeys: text('prerequisite_objective_keys')
      .array()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('learning_objectives_goal_key_unique').on(
      table.goalId,
      table.objectiveKey,
    ),
    uniqueIndex('learning_objectives_goal_node_unique').on(
      table.goalId,
      table.knowledgeNodeId,
    ),
    uniqueIndex('learning_objectives_goal_sequence_unique').on(
      table.goalId,
      table.sequence,
    ),
    check(
      'learning_objectives_text_check',
      sql`char_length(${table.objectiveKey}) between 1 and 128 and char_length(${table.knowledgeNodeId}) between 1 and 128 and char_length(${table.title}) between 1 and 80 and char_length(${table.description}) between 1 and 300`,
    ),
    check(
      'learning_objectives_shape_check',
      sql`${table.sequence} between 1 and 12 and cardinality(${table.prerequisiteObjectiveKeys}) <= 4`,
    ),
  ],
);

/**
 * 一次已提交诊断的不可变头记录。answerFingerprint 用于识别同一客户端 attempt ID
 * 是否携带了不同答案；只保存 SHA-256，不保存正确答案或原始题面。
 */
export const diagnosticAttempts = pgTable(
  'diagnostic_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientAttemptId: uuid('client_attempt_id').notNull(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => learningGoals.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lessonSessions.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    definitionVersion: text('definition_version').notNull(),
    answerFingerprint: text('answer_fingerprint').notNull(),
    attemptedItems: integer('attempted_items').notNull(),
    correctItems: integer('correct_items').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('diagnostic_attempts_client_id_unique').on(
      table.clientAttemptId,
    ),
    index('diagnostic_attempts_goal_recent_idx').on(
      table.goalId,
      table.submittedAt,
      table.id,
    ),
    check(
      'diagnostic_attempts_shape_check',
      sql`${table.attemptedItems} between 3 and 10 and ${table.correctItems} between 0 and ${table.attemptedItems} and char_length(${table.definitionVersion}) between 1 and 128 and ${table.answerFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

/** 诊断逐题事实；只记录学生选择与服务端判分结果，答案键仍只存在于受信课程目录。 */
export const diagnosticResponses = pgTable(
  'diagnostic_responses',
  {
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => diagnosticAttempts.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => learningObjectives.id, { onDelete: 'restrict' }),
    selectedOptionId: text('selected_option_id').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    gradingVersion: text('grading_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.attemptId, table.questionId] }),
    check(
      'diagnostic_responses_text_check',
      sql`char_length(${table.questionId}) between 1 and 128 and char_length(${table.selectedOptionId}) between 1 and 128 and char_length(${table.gradingVersion}) between 1 and 128`,
    ),
  ],
);
