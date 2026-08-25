import {
  DrizzleKnowledgeRetrievalRepository,
  DrizzleKnowledgeSourceRepository,
  type IngestKnowledgeDocumentInput,
} from '@educanvas/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';
import { KNOWLEDGE_EMBED_DOCUMENT_TASK } from './embed-knowledge-document.js';

const KNOWLEDGE_INGEST_DOCUMENT_TASK = 'knowledge:ingest_document' as const;

const sourceSchema = z
  .object({
    gradeBand: z.string().min(1).max(64),
    courseSlug: z.string().min(1).max(128),
    sourceKey: z.string().min(1).max(128),
    title: z.string().min(1).max(300),
    sourceType: z.enum(['text', 'pdf']),
  })
  .strict();

const chunkSchema = z
  .object({
    content: z.string().min(1).max(20_000),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    heading: z.string().min(1).max(500).nullable().optional(),
    pageStart: z.number().int().min(1).nullable().optional(),
    pageEnd: z.number().int().min(1).nullable().optional(),
  })
  .strict()
  .refine(
    (chunk) => (chunk.pageStart == null) === (chunk.pageEnd == null),
    'pageStart与pageEnd必须同时提供',
  )
  .refine(
    (chunk) =>
      chunk.pageStart == null ||
      chunk.pageEnd == null ||
      chunk.pageEnd >= chunk.pageStart,
    'pageEnd不能早于pageStart',
  );

const documentSchema = z
  .object({
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    objectKey: z
      .string()
      .min(1)
      .max(1_024)
      .refine(
        (value) => !/^https?:\/\//i.test(value),
        'objectKey不能是公开URL',
      ),
    parserVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    outcome: z.discriminatedUnion('status', [
      z
        .object({
          status: z.literal('ready'),
          chunks: z.array(chunkSchema).min(1).max(10_000),
        })
        .strict(),
      z
        .object({
          status: z.literal('parse_failed'),
          failureCode: z.string().min(1).max(128),
        })
        .strict(),
    ]),
  })
  .strict();

const ingestPayloadSchema = z
  .object({
    source: sourceSchema,
    document: documentSchema,
    binding: z
      .object({
        trustedStudentId: z.string().min(1).max(256),
        sessionId: z.uuid(),
        mutationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
      })
      .strict()
      .optional(),
  })
  .strict();

interface KnowledgeSourceRepository {
  createOrGetSource(input: z.infer<typeof sourceSchema>): Promise<{
    source: { id: string };
  }>;
  ingestDocument(input: IngestKnowledgeDocumentInput): Promise<{
    replayed: boolean;
    document: {
      id: string;
      version: number;
      parserVersion: string;
      parseStatus: string;
    };
  }>;
}

interface KnowledgeBindingRepository {
  setSessionSourceBinding(input: {
    trustedStudentId: string;
    sessionId: string;
    sourceId: string;
    enabled: boolean;
    mutationId: string;
  }): Promise<unknown>;
}

export function createIngestKnowledgeDocumentTask(
  repository: KnowledgeSourceRepository = new DrizzleKnowledgeSourceRepository(),
  bindings: KnowledgeBindingRepository = new DrizzleKnowledgeRetrievalRepository(),
): Task {
  return async (payload, helpers) => {
    const parsed = ingestPayloadSchema.parse(payload);
    const { source } = await repository.createOrGetSource(parsed.source);
    const result = await repository.ingestDocument({
      sourceId: source.id,
      ...parsed.document,
    });
    if (parsed.binding && result.document.parseStatus === 'ready') {
      await bindings.setSessionSourceBinding({
        ...parsed.binding,
        sourceId: source.id,
        enabled: true,
      });
    }
    helpers.logger.info(
      `课程资料摄取完成,source=${source.id},document=${result.document.id},version=${result.document.version},replayed=${result.replayed}`,
    );

    /* 向量化是派生步骤：ready 文档才值得嵌入，且 job_key 按文档冻结，
       重复摄取同一版本不会重复排队。摄取本身不因向量化失败而失败——
       没有向量只是让混合检索退回纯 FTS。 */
    if (result.document.parseStatus === 'ready') {
      await helpers.addJob(
        KNOWLEDGE_EMBED_DOCUMENT_TASK,
        {
          documentId: result.document.id,
          chunkingVersion: result.document.parserVersion,
        },
        /* 单次最多处理 8×64 个 chunk；文档上限 10,000，因此 25 次足以覆盖
           最大合法文档并仍给瞬时 Provider 错误留出退避空间。 */
        { jobKey: `knowledge-embed:${result.document.id}`, maxAttempts: 25 },
      );
    }
  };
}

export const ingestKnowledgeDocument = createIngestKnowledgeDocumentTask();
export { KNOWLEDGE_INGEST_DOCUMENT_TASK };
