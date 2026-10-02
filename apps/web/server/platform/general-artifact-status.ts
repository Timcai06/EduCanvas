import type { PlatformArtifactGenerationReceipt } from '@educanvas/db';
import { z } from 'zod';

const artifactStatusReceiptFields = {
  jobId: z.uuid(),
  artifactId: z.uuid(),
  progress: z.number().int().min(0).max(100).nullable(),
  artifactStatus: z.enum(['proposed', 'active', 'archived']),
  kind: z.string().min(1),
  title: z.string().trim().min(1).max(120),
};

export const getCanvasArtifactStatusInputSchema = z
  .object({ artifactId: z.uuid() })
  .strict();

export const getCanvasArtifactStatusOutputSchema = z.discriminatedUnion(
  'status',
  [
    z.object({ artifactId: z.uuid(), status: z.literal('not_found') }).strict(),
    z
      .object({
        ...artifactStatusReceiptFields,
        status: z.literal('succeeded'),
        committedVersion: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        ...artifactStatusReceiptFields,
        status: z.enum([
          'proposed',
          'running',
          'failed',
          'cancelled',
          'inconsistent',
        ]),
        committedVersion: z.number().int().positive().nullable(),
      })
      .strict(),
  ],
);

export function toCanvasArtifactStatusOutput(
  artifactId: string,
  receipt: PlatformArtifactGenerationReceipt | null,
): z.infer<typeof getCanvasArtifactStatusOutputSchema> {
  if (!receipt) return { artifactId, status: 'not_found' };

  const committedVersion = receipt.committedVersion?.version ?? null;
  const base = {
    jobId: receipt.jobId,
    artifactId: receipt.artifactId,
    progress: receipt.progress,
    artifactStatus: receipt.artifactStatus,
    kind: receipt.kind,
    title: receipt.title,
  };
  const incomplete = (
    status: 'proposed' | 'running' | 'failed' | 'cancelled' | 'inconsistent',
    version: number | null,
  ) => ({ ...base, status, committedVersion: version });

  switch (receipt.jobStatus) {
    case 'queued':
      return incomplete(
        committedVersion === null ? 'proposed' : 'inconsistent',
        committedVersion,
      );
    case 'running':
      return incomplete(
        committedVersion === null ? 'running' : 'inconsistent',
        committedVersion,
      );
    case 'succeeded':
      return committedVersion === null
        ? incomplete('inconsistent', null)
        : { ...base, status: 'succeeded', committedVersion };
    case 'failed':
      return incomplete(
        committedVersion === null ? 'failed' : 'inconsistent',
        committedVersion,
      );
    case 'cancelled':
      return incomplete(
        committedVersion === null ? 'cancelled' : 'inconsistent',
        committedVersion,
      );
    default:
      return incomplete('inconsistent', committedVersion);
  }
}
