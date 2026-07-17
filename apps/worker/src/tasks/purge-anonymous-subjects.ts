import { DrizzleAnonymousDataLifecycleService } from '@educanvas/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';

const cronMetadataSchema = z
  .object({
    ts: z.string().min(1),
    backfilled: z.boolean().optional(),
  })
  .strict();

const purgePayloadSchema = z
  .object({
    limit: z.number().int().min(1).max(1_000).default(100),
    _cron: cronMetadataSchema.optional(),
  })
  .strict();

interface AnonymousDataLifecycleService {
  purgeExpiredSubjects(input: { limit: number }): Promise<{
    evaluatedSubjects: number;
    deletedSubjects: number;
    skippedSubjects: number;
  }>;
}

export function createPurgeAnonymousSubjectsTask(
  service: AnonymousDataLifecycleService = new DrizzleAnonymousDataLifecycleService(),
): Task {
  return async (payload, helpers) => {
    const { limit } = purgePayloadSchema.parse(payload);
    const result = await service.purgeExpiredSubjects({ limit });
    helpers.logger.info(
      `匿名主体清理完成,evaluated=${result.evaluatedSubjects},deleted=${result.deletedSubjects},skipped=${result.skippedSubjects}`,
    );
  };
}

export const purgeAnonymousSubjects = createPurgeAnonymousSubjectsTask();
