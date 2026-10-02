import { z } from 'zod';
import {
  notebookScopedFetch,
  type NotebookRequestContext,
} from '@/features/workspace/general/notebook-request-context';

const codeExerciseRunResultSchema = z
  .object({
    status: z.enum(['succeeded', 'failed', 'cancelled']),
    stdout: z.string().max(16_384),
    stderr: z.string().max(16_384),
    failureCode: z.string().max(64).nullable(),
  })
  .strict();

export interface CodeExerciseRunResult {
  status: 'succeeded' | 'failed' | 'cancelled';
  stdout: string;
  stderr: string;
  failureCode: string | null;
}

export async function runCodeExercise(
  input: {
    artifactId: string;
    source: string;
  },
  requestContext?: NotebookRequestContext | null,
): Promise<CodeExerciseRunResult> {
  const response = await notebookScopedFetch(
    '/api/v1/learn/code-runs',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    requestContext,
  );
  if (!response.ok) throw new Error('code_run_failed');
  return codeExerciseRunResultSchema.parse(await response.json());
}
