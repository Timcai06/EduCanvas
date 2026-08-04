/**
 * Experiment runtime streaming Port.
 *
 * Data schemas live in `experiment-runtime-contract.ts`; this compatibility
 * module keeps the public import path stable while isolating execution events.
 */

import { z } from 'zod';
import type { ModelAbortSignal } from './model-contracts';
import {
  experimentLogEntrySchema,
  experimentProvenanceSchema,
  experimentRunCancelledResultSchema,
  experimentRunFailedResultSchema,
  experimentRunSucceededResultSchema,
  type ExperimentRun,
} from './experiment-runtime-contract';

export * from './experiment-runtime-contract';

const terminalEventEnvelope = z.object({
  provenance: experimentProvenanceSchema,
});

function addTerminalConsistencyIssues(
  event: {
    type: 'succeeded' | 'failed' | 'cancelled';
    result: { runId: string; outputs: unknown[] };
    provenance: { runId: string; terminalStatus: string; outputs: unknown[] };
  },
  ctx: z.RefinementCtx,
): void {
  if (event.result.runId !== event.provenance.runId) {
    ctx.addIssue({
      code: 'custom',
      path: ['provenance', 'runId'],
      message: 'Terminal provenance must belong to the result run',
    });
  }
  if (event.provenance.terminalStatus !== event.type) {
    ctx.addIssue({
      code: 'custom',
      path: ['provenance', 'terminalStatus'],
      message: 'Terminal provenance status must match the terminal event',
    });
  }
  if (
    JSON.stringify(event.result.outputs) !==
    JSON.stringify(event.provenance.outputs)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['provenance', 'outputs'],
      message: 'Terminal provenance outputs must match the result outputs',
    });
  }
}

const succeededEventSchema = terminalEventEnvelope
  .extend({
    type: z.literal('succeeded'),
    result: experimentRunSucceededResultSchema,
  })
  .strict()
  .superRefine(addTerminalConsistencyIssues);

const failedEventSchema = terminalEventEnvelope
  .extend({
    type: z.literal('failed'),
    result: experimentRunFailedResultSchema,
  })
  .strict()
  .superRefine(addTerminalConsistencyIssues);

const cancelledEventSchema = terminalEventEnvelope
  .extend({
    type: z.literal('cancelled'),
    result: experimentRunCancelledResultSchema,
  })
  .strict()
  .superRefine(addTerminalConsistencyIssues);

/** Runtime-to-host stream. A terminal event carries its final result and provenance. */
export const experimentRunEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started') }).strict(),
  z
    .object({
      type: z.literal('output'),
      kind: z.enum(['stdout', 'stderr']),
      content: z.string().max(65536),
    })
    .strict(),
  z
    .object({
      type: z.literal('log'),
      entry: experimentLogEntrySchema,
    })
    .strict(),
  succeededEventSchema,
  failedEventSchema,
  cancelledEventSchema,
]);
export type ExperimentRunEvent = z.infer<typeof experimentRunEventSchema>;

export interface ExperimentRuntimePort {
  /**
   * Execute one immutable run. The adapter owns isolation and resource limits;
   * cancellation must be observed promptly and never creates an Agent loop.
   */
  execute(
    run: ExperimentRun,
    signal: ModelAbortSignal,
  ): AsyncIterable<ExperimentRunEvent>;
}

/** Rejects explicit network capability requests before they reach an adapter. */
export function rejectsNetworkCapability(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const value = input as Record<string, unknown>;
  const capabilities = value.capabilities as
    Record<string, unknown> | undefined;
  return (
    value.network === true ||
    value.enableNetwork === true ||
    capabilities?.network === true
  );
}

/** Rejects explicit GPU capability requests before they reach an adapter. */
export function rejectsGpuCapability(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const value = input as Record<string, unknown>;
  const capabilities = value.capabilities as
    Record<string, unknown> | undefined;
  return (
    value.gpu === true || value.enableGpu === true || capabilities?.gpu === true
  );
}

/** Rejects custom images and shell-like execution surfaces. */
export function rejectsCustomImageOrShell(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const value = input as Record<string, unknown>;
  return (
    typeof value.image === 'string' ||
    typeof value.dockerImage === 'string' ||
    typeof value.shell === 'string' ||
    typeof value.command === 'string'
  );
}
