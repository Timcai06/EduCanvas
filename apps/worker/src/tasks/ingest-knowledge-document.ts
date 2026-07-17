import {
  DrizzleKnowledgeSourceRepository,
  type IngestKnowledgeDocumentInput,
} from '@educanvas/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';

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
  .object({ source: sourceSchema, document: documentSchema })
  .strict();

interface KnowledgeSourceRepository {
  createOrGetSource(input: z.infer<typeof sourceSchema>): Promise<{
    source: { id: string };
  }>;
  ingestDocument(input: IngestKnowledgeDocumentInput): Promise<{
    replayed: boolean;
    document: { id: string; version: number };
  }>;
}

export function createIngestKnowledgeDocumentTask(
  repository: KnowledgeSourceRepository = new DrizzleKnowledgeSourceRepository(),
): Task {
  return async (payload, helpers) => {
    const parsed = ingestPayloadSchema.parse(payload);
    const { source } = await repository.createOrGetSource(parsed.source);
    const result = await repository.ingestDocument({
      sourceId: source.id,
      ...parsed.document,
    });
    helpers.logger.info(
      `课程资料摄取完成,source=${source.id},document=${result.document.id},version=${result.document.version},replayed=${result.replayed}`,
    );
  };
}

export const ingestKnowledgeDocument = createIngestKnowledgeDocumentTask();
