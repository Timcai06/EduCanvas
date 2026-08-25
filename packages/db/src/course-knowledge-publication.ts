import type { StudyCourseDefinition } from '@educanvas/teaching-core';
import { sql } from 'drizzle-orm';
import { getDb } from './client';
import type { BootstrapStudyPlanInput } from './study-repository-contracts';

export const KNOWLEDGE_INGEST_DOCUMENT_TASK =
  'knowledge:ingest_document' as const;

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type CourseKnowledgePublication = NonNullable<
  BootstrapStudyPlanInput['knowledgePublication']
>;

function assertBoundedText(
  value: unknown,
  field: string,
  maxLength: number,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maxLength
  ) {
    throw new Error(`课程资料${field}不合法`);
  }
}

function validatePublication(
  value: CourseKnowledgePublication,
): CourseKnowledgePublication {
  const allowedKeys = new Set([
    'sourceKey',
    'title',
    'contentHash',
    'objectKey',
    'parserVersion',
    'chunks',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error('课程资料包含未声明字段');
  }
  assertBoundedText(value.sourceKey, 'sourceKey', 128);
  assertBoundedText(value.title, 'title', 300);
  assertBoundedText(value.contentHash, 'contentHash', 64);
  if (!/^[a-f0-9]{64}$/.test(value.contentHash)) {
    throw new Error('课程资料contentHash不合法');
  }
  assertBoundedText(value.objectKey, 'objectKey', 1_024);
  if (/^https?:\/\//i.test(value.objectKey)) {
    throw new Error('课程资料objectKey不能是公开URL');
  }
  assertBoundedText(value.parserVersion, 'parserVersion', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.parserVersion)) {
    throw new Error('课程资料parserVersion不合法');
  }
  if (value.chunks.length < 1 || value.chunks.length > 100) {
    throw new Error('课程资料chunks数量不合法');
  }
  for (const chunk of value.chunks) {
    if (
      Object.keys(chunk).some((key) => key !== 'content' && key !== 'heading')
    ) {
      throw new Error('课程资料chunk包含未声明字段');
    }
    assertBoundedText(chunk.content, 'chunk.content', 20_000);
    if (chunk.heading != null) {
      assertBoundedText(chunk.heading, 'chunk.heading', 500);
    }
  }
  return value;
}

/** Goal 事务内只排队；Source、文档和会话绑定由幂等 Worker 收敛。 */
export async function enqueueCourseKnowledgePublication(
  transaction: DatabaseTransaction,
  input: BootstrapStudyPlanInput,
  course: StudyCourseDefinition,
): Promise<void> {
  if (!input.knowledgePublication) return;
  const publication = validatePublication(input.knowledgePublication);
  const payload = {
    source: {
      gradeBand: course.gradeBand,
      courseSlug: course.courseSlug,
      sourceKey: publication.sourceKey,
      title: publication.title,
      sourceType: 'text',
    },
    document: {
      contentHash: publication.contentHash,
      objectKey: publication.objectKey,
      parserVersion: publication.parserVersion,
      outcome: { status: 'ready', chunks: publication.chunks },
    },
    binding: {
      trustedStudentId: input.trustedStudentId,
      sessionId: input.sessionId,
      mutationId: `course-source:${publication.contentHash.slice(0, 32)}`,
    },
  } as const;
  await transaction.execute(sql`
    select graphile_worker.add_job(
      ${KNOWLEDGE_INGEST_DOCUMENT_TASK},
      payload := ${JSON.stringify(payload)}::json,
      job_key := ${`course-knowledge:${input.sessionId}:${publication.contentHash}`},
      max_attempts := 10
    )
  `);
}
